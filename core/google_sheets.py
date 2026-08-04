import os
import json
from datetime import datetime
from typing import Dict, Any, List, Optional
from core.config import config, default_limits

class GoogleSheetsStorage:
    def __init__(self):
        self.credentials_json = os.getenv("GOOGLE_CREDENTIALS") or os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
        self.sheet_id = os.getenv("GOOGLE_SHEET_ID")
        self.client = None
        self.spreadsheet = None
        self.fallback_file = os.path.join(os.path.dirname(__file__), "storage_fallback.json")
        
        # 로컬 데이터 초기화
        self._init_local_fallback()
        
        # Google Sheets 시도
        if self.credentials_json and self.sheet_id:
            try:
                import gspread
                from google.oauth2.service_account import Credentials
                
                scopes = [
                    "https://www.googleapis.com/auth/spreadsheets",
                    "https://www.googleapis.com/auth/drive"
                ]
                
                if self.credentials_json.startswith("{"):
                    creds_info = json.loads(self.credentials_json)
                    creds = Credentials.from_service_account_info(creds_info, scopes=scopes)
                else:
                    creds = Credentials.from_service_account_file(self.credentials_json, scopes=scopes)
                    
                self.client = gspread.authorize(creds)
                self.spreadsheet = self.client.open_by_key(self.sheet_id)
                print("[GoogleSheetsStorage] Google Sheets API 연결 성공")
            except Exception as e:
                print(f"[GoogleSheetsStorage] WARNING: Google Sheets API 연결 실패 ({e}). 로컬 storage_fallback 사용.")
                self.client = None

    def _init_local_fallback(self):
        if not os.path.exists(self.fallback_file):
            initial_data = {
                "settings": {
                    "bot_token": config.TELEGRAM_BOT_TOKEN,
                    "chat_id": config.TELEGRAM_CHAT_ID,
                    "report_time": config.DAILY_REPORT_TIME,
                    "limits": default_limits.model_dump(),
                    "template": config.DEFAULT_TEMPLATE
                },
                "logs": []
            }
            with open(self.fallback_file, "w", encoding="utf-8") as f:
                json.dump(initial_data, f, ensure_ascii=False, indent=2)

    def _read_local(self) -> Dict[str, Any]:
        with open(self.fallback_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def get_settings(self) -> Dict[str, Any]:
        """설정 조회 (Google Sheets 또는 Fallback)"""
        if self.spreadsheet:
            try:
                worksheet = self.spreadsheet.worksheet("Settings")
                records = worksheet.get_all_records()
                settings = {}
                for r in records:
                    key = r.get("key")
                    val = r.get("value")
                    if key:
                        try:
                            settings[key] = json.loads(val)
                        except Exception:
                            settings[key] = val
                return settings
            except Exception as e:
                print(f"[GoogleSheetsStorage] Settings 조회 중 오류: {e}")
        
        # Fallback
        with open(self.fallback_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("settings", {})

    def save_settings(self, new_settings: Dict[str, Any]) -> bool:
        """설정 저장 (Google Sheets 및 Fallback 동시 반영)"""
        # 로컬 파일 업데이트
        with open(self.fallback_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        current_settings = data.get("settings", {})
        current_settings.update(new_settings)
        data["settings"] = current_settings
        
        with open(self.fallback_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        # Google Sheets 업데이트 시도
        if self.spreadsheet:
            try:
                try:
                    worksheet = self.spreadsheet.worksheet("Settings")
                except Exception:
                    worksheet = self.spreadsheet.add_worksheet(title="Settings", rows=50, cols=2)
                    worksheet.append_row(["key", "value"])

                cell_updates = []
                for k, v in current_settings.items():
                    val_str = json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)
                    cell_updates.append([k, val_str])
                    
                worksheet.clear()
                worksheet.append_row(["key", "value"])
                for row in cell_updates:
                    worksheet.append_row(row)
                return True
            except Exception as e:
                print(f"[GoogleSheetsStorage] Settings Sheets 저장 중 오류: {e}")
                
        return True

    def add_log(self, level: str, event_type: str, message: str, status: str = "SUCCESS") -> Dict[str, Any]:
        """알람/전송 로그 추가"""
        log_entry = {
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "level": level,
            "event_type": event_type,
            "message": message,
            "status": status
        }
        
        # 로컬 저장
        with open(self.fallback_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        logs = data.get("logs", [])
        logs.insert(0, log_entry) # 최신 로그 상단 배치
        data["logs"] = logs[:200] # 최대 200개 유지
        
        with open(self.fallback_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        # Google Sheets 저장 시도
        if self.spreadsheet:
            try:
                try:
                    worksheet = self.spreadsheet.worksheet("Logs")
                except Exception:
                    worksheet = self.spreadsheet.add_worksheet(title="Logs", rows=1000, cols=5)
                    worksheet.append_row(["timestamp", "level", "event_type", "message", "status"])

                worksheet.append_row([
                    log_entry["timestamp"],
                    log_entry["level"],
                    log_entry["event_type"],
                    log_entry["message"],
                    log_entry["status"]
                ])
            except Exception as e:
                print(f"[GoogleSheetsStorage] Logs Sheets 저장 오류: {e}")

        return log_entry

    def get_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        """로그 목록 조회"""
        if self.spreadsheet:
            try:
                worksheet = self.spreadsheet.worksheet("Logs")
                records = worksheet.get_all_records()
                records.reverse()
                return records[:limit]
            except Exception as e:
                print(f"[GoogleSheetsStorage] Logs 조회 오류: {e}")
                
        with open(self.fallback_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("logs", [])[:limit]

# 글로벌 스토리지 인스턴스
storage = GoogleSheetsStorage()
