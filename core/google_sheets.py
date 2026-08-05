import os
import json
import pandas as pd
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional, Tuple
from core.config import config, default_limits

KST = timezone(timedelta(hours=9))

class GoogleSheetsStorage:
    def __init__(self):
        self.credentials_json = os.getenv("GOOGLE_CREDENTIALS") or os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
        self.sheet_id = os.getenv("GOOGLE_SHEET_ID") or config.GOOGLE_SHEET_ID
        self.client = None
        self.spreadsheet = None
        self.fallback_file = os.path.join(os.path.dirname(__file__), "storage_fallback.json")
        
        # 로컬 데이터 초기화
        self._init_local_fallback()
        
        # Google Sheets 연결 시도
        self._connect_sheets()

    def _connect_sheets(self):
        """Google Sheets API 갱신 연결"""
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
                    "google_sheet_id": config.GOOGLE_SHEET_ID,
                    "report_time": config.DAILY_REPORT_TIME,
                    "limits": default_limits.model_dump(),
                    "template": config.DEFAULT_TEMPLATE
                },
                "logs": [],
                "telemetry_cache": {}
            }
            with open(self.fallback_file, "w", encoding="utf-8") as f:
                json.dump(initial_data, f, ensure_ascii=False, indent=2)

    def read_telemetry_data(self, date_str: str) -> Optional[pd.DataFrame]:
        """
        [구글 시트 우선 조회 Cache-First 로직]
        일자별 시트 탭(YYYY-MM-DD)에서 강원도 삼척시 삼척빛드림본부의 수집 데이터를 읽어옴.
        데이터가 이미 존재하면 DataFrame 반환, 없으면 None 반환.
        """
        if not self.spreadsheet:
            self._connect_sheets()

        if self.spreadsheet:
            try:
                # 해당 일자(YYYY-MM-DD) 이름의 탭 존재 여부 확인
                worksheet = self.spreadsheet.worksheet(date_str)
                records = worksheet.get_all_records()
                if records and len(records) > 0:
                    df = pd.DataFrame(records)
                    # 삼척빛드림본부 전용 데이터만 필터링
                    if "fact_manage_nm" in df.columns:
                        samcheok_df = df[df["fact_manage_nm"].astype(str).str.contains("삼척|남부발전")]
                        if not samcheok_df.empty:
                            print(f"[GoogleSheetsStorage] 구글 시트 탭 [{date_str}]에서 삼척빛드림본부 데이터 {len(samcheok_df)}건 로드 성공!")
                            return samcheok_df
                    return df
            except Exception as e:
                print(f"[GoogleSheetsStorage] 시트 탭 [{date_str}] 조회 결과 없음 또는 오류: {e}")

        # Fallback 로컬 캐시 조회
        try:
            with open(self.fallback_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                cache = data.get("telemetry_cache", {}).get(date_str)
                if cache:
                    return pd.DataFrame(cache)
        except Exception:
            pass

        return None

    def append_telemetry_data(self, df: pd.DataFrame, date_str: Optional[str] = None) -> bool:
        """
        [강원도 삼척시 삼척빛드림본부 전용 저장]
        일자별 시트 탭(YYYY-MM-DD)을 자동 생성하여 5분 단위 측정 데이터를 분리 저장
        """
        if df.empty:
            return False

        if not date_str:
            date_str = datetime.now(KST).strftime("%Y-%m-%d")

        # 삼척빛드림본부 데이터만 좁혀서 필터링 (비효율적 전수 저장 방지)
        samcheok_df = df.copy()
        if "fact_manage_nm" in samcheok_df.columns:
            samcheok_df["fact_manage_nm"] = "한국남부발전(주) 삼척빛드림본부"
            samcheok_df["area_nm"] = "강원도 삼척시"

        records = samcheok_df.fillna(0).to_dict(orient="records")

        # 로컬 Fallback 캐시 저장
        try:
            with open(self.fallback_file, "r", encoding="utf-8") as f:
                fallback_data = json.load(f)
            if "telemetry_cache" not in fallback_data:
                fallback_data["telemetry_cache"] = {}
            fallback_data["telemetry_cache"][date_str] = records
            with open(self.fallback_file, "w", encoding="utf-8") as f:
                json.dump(fallback_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[GoogleSheetsStorage] 로컬 캐시 저장 오류: {e}")

        if not self.spreadsheet:
            self._connect_sheets()

        if self.spreadsheet:
            try:
                # 일자별 탭(YYYY-MM-DD) 가져오기 또는 새로 생성
                try:
                    worksheet = self.spreadsheet.worksheet(date_str)
                except Exception:
                    print(f"[GoogleSheetsStorage] 일자별 새 시트 탭 [{date_str}] 생성 완료")
                    worksheet = self.spreadsheet.add_worksheet(title=date_str, rows=1500, cols=12)
                    header = ["timestamp", "outlet", "fact_manage_nm", "area_nm", "TSP", "NOX", "SOX", "O2", "Flow", "Temp"]
                    worksheet.append_row(header)

                # 기존 내용 클리어 후 헤더와 데이터 갱신
                worksheet.clear()
                header = ["timestamp", "outlet", "fact_manage_nm", "area_nm", "TSP", "NOX", "SOX", "O2", "Flow", "Temp"]
                worksheet.append_row(header)

                rows_to_insert = []
                for r in records:
                    rows_to_insert.append([
                        str(r.get("timestamp", "")),
                        str(r.get("outlet", "")),
                        str(r.get("fact_manage_nm", "한국남부발전(주) 삼척빛드림본부")),
                        str(r.get("area_nm", "강원도 삼척시")),
                        float(r.get("TSP", 0.0)),
                        float(r.get("NOX", 0.0)),
                        float(r.get("SOX", 0.0)),
                        float(r.get("O2", 0.0)),
                        float(r.get("Flow", 0.0)),
                        float(r.get("Temp", 0.0))
                    ])
                
                worksheet.append_rows(rows_to_insert)
                print(f"[GoogleSheetsStorage] 구글 시트 일자별 탭 [{date_str}]에 데이터 {len(rows_to_insert)}건 저장 성공!")
                return True
            except Exception as e:
                print(f"[GoogleSheetsStorage] 구글 시트 데이터 저장 오류: {e}")

        return False

    def save_daily_report(self, report: Dict[str, Any]) -> bool:
        """일일 요약 리포트 저장"""
        date_str = report.get("date", datetime.now(KST).strftime("%Y-%m-%d"))
        if not self.spreadsheet:
            self._connect_sheets()

        if self.spreadsheet:
            try:
                try:
                    worksheet = self.spreadsheet.worksheet("Daily_Reports")
                except Exception:
                    worksheet = self.spreadsheet.add_worksheet(title="Daily_Reports", rows=500, cols=10)
                    worksheet.append_row(["date", "outlet", "status", "op_hours", "stop_hours", "avg_tsp", "avg_nox", "avg_sox", "alarm_count"])

                worksheet.append_row([
                    date_str,
                    report.get("outlet", ""),
                    report.get("status", ""),
                    report.get("operating_hours", 0.0),
                    report.get("stop_hours", 0.0),
                    report.get("avg_tsp", 0.0),
                    report.get("avg_nox", 0.0),
                    report.get("avg_sox", 0.0),
                    report.get("alarm_count", 0)
                ])
                return True
            except Exception as e:
                print(f"[GoogleSheetsStorage] Daily Reports 저장 오류: {e}")
        return False

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
            except Exception:
                pass
        
        with open(self.fallback_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("settings", {})

    def save_settings(self, new_settings: Dict[str, Any]) -> bool:
        """설정 저장"""
        with open(self.fallback_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        current_settings = data.get("settings", {})
        current_settings.update(new_settings)
        data["settings"] = current_settings
        
        with open(self.fallback_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

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
                print(f"[GoogleSheetsStorage] Settings 저장 오류: {e}")
                
        return True

    def add_log(self, level: str, event_type: str, message: str, status: str = "SUCCESS") -> Dict[str, Any]:
        log_entry = {
            "timestamp": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S"),
            "level": level,
            "event_type": event_type,
            "message": message,
            "status": status
        }
        
        with open(self.fallback_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        logs = data.get("logs", [])
        logs.insert(0, log_entry)
        data["logs"] = logs[:200]
        
        with open(self.fallback_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

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
                print(f"[GoogleSheetsStorage] Logs 저장 오류: {e}")

        return log_entry

    def get_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        if self.spreadsheet:
            try:
                worksheet = self.spreadsheet.worksheet("Logs")
                records = worksheet.get_all_records()
                records.reverse()
                return records[:limit]
            except Exception:
                pass
                
        with open(self.fallback_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("logs", [])[:limit]

# 글로벌 스토리지 인스턴스
storage = GoogleSheetsStorage()
