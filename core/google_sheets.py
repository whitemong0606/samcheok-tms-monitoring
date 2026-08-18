import os
import json
import tempfile
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
        
        # Vercel Serverless 환경 대응: /tmp 디렉토리 사용 (Read-only filesystem 에러 방지)
        self.fallback_file = os.path.join(tempfile.gettempdir(), "storage_fallback.json")
        
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

    def read_telemetry_data(self, query_date_str: str) -> Optional[pd.DataFrame]:
        """
        [구글 시트 타임스탬프 기반 데이터 로드 로직]
        조회일(query_date_str, 예: 2026-08-18) 기준:
        - 당일 탭(2026-08-18)의 모든 실시간 실측 데이터 로드 (00:00:00 ~ 23:59:59)
        - 24시간 연속 차트 구성을 위해 전일 탭(2026-08-17) 08:00 이후 데이터 함께 보충
        """
        try:
            query_dt = datetime.strptime(query_date_str, "%Y-%m-%d")
            prev_date_str = (query_dt - timedelta(days=1)).strftime("%Y-%m-%d")
        except Exception:
            return None

        combined_rows = []

        if not self.spreadsheet:
            self._connect_sheets()

        if self.spreadsheet:
            # 1. 당일 탭(YYYY-MM-DD)에서 최신 실시간 실측 데이터 전수 로드
            try:
                ws_curr = self.spreadsheet.worksheet(query_date_str)
                recs_curr = ws_curr.get_all_records()
                for r in recs_curr:
                    ts = str(r.get("timestamp", ""))
                    if ts:
                        combined_rows.append(r)
            except Exception:
                pass

            # 2. 전일 탭(YYYY-MM-DD) 데이터가 있고 당일 탭 데이터가 부족한 경우 전일 08:00 이후 데이터 보충
            if len(combined_rows) < 48:
                try:
                    ws_prev = self.spreadsheet.worksheet(prev_date_str)
                    recs_prev = ws_prev.get_all_records()
                    start_ts = f"{prev_date_str} 08:00:00"
                    prev_rows = [r for r in recs_prev if str(r.get("timestamp", "")) >= start_ts]
                    combined_rows = prev_rows + combined_rows
                except Exception:
                    pass

            if combined_rows:
                df = pd.DataFrame(combined_rows)
                df.drop_duplicates(subset=["timestamp", "outlet"], inplace=True)
                df.sort_values(by="timestamp", inplace=True)
                if "fact_manage_nm" in df.columns:
                    samcheok_df = df[df["fact_manage_nm"].astype(str).str.contains("삼척|남부발전")]
                    if not samcheok_df.empty:
                        print(f"[GoogleSheetsStorage] [{query_date_str}] 탭 삼척 실시간 데이터 {len(samcheok_df)}건 로드 성공!")
                        return samcheok_df
                return df

        # 로컬 Fallback 캐시 조회
        try:
            with open(self.fallback_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                cache = data.get("telemetry_cache", {})
                curr_rows = cache.get(query_date_str, [])
                prev_rows = cache.get(prev_date_str, [])
                rows = prev_rows + curr_rows
                if rows:
                    df = pd.DataFrame(rows)
                    df.drop_duplicates(subset=["timestamp", "outlet"], inplace=True)
                    df.sort_values(by="timestamp", inplace=True)
                    return df
        except Exception:
            pass

        return None

    def append_telemetry_data(self, df: pd.DataFrame, query_date_str: Optional[str] = None) -> bool:
        """
        [실제 타임스탬프 날짜별 탭 분리 저장 로직]
        24시간 수집 데이터(예: 8/4 08:00 ~ 8/5 08:00)를 타임스탬프의 실제 날짜별로 그룹화:
        - 8/4 08:00 ~ 23:55 데이터 -> '2026-08-04' 시트 탭에 저장
        - 8/5 00:00 ~ 07:55 데이터 -> '2026-08-05' 시트 탭에 저장
        """
        if df.empty or "timestamp" not in df.columns:
            return False

        # 삼척빛드림본부 데이터로 필터링
        samcheok_df = df.copy()
        if "fact_manage_nm" in samcheok_df.columns:
            samcheok_df["fact_manage_nm"] = "한국남부발전(주) 삼척빛드림본부"
            samcheok_df["area_nm"] = "강원도 삼척시"

        # 타임스탬프의 실제 YYYY-MM-DD 날짜별로 그룹화
        samcheok_df["actual_date"] = samcheok_df["timestamp"].astype(str).str.slice(0, 10)
        grouped = samcheok_df.groupby("actual_date")

        header = ["timestamp", "outlet", "fact_manage_nm", "area_nm", "TSP", "NOX", "SOX", "O2", "Flow", "Temp"]

        if not self.spreadsheet:
            self._connect_sheets()

        success_any = False

        for date_tab, group_df in grouped:
            records = group_df.drop(columns=["actual_date"], errors="ignore").fillna(0).to_dict(orient="records")

            # 로컬 Fallback 캐시 업데이트
            try:
                with open(self.fallback_file, "r", encoding="utf-8") as f:
                    fallback_data = json.load(f)
                if "telemetry_cache" not in fallback_data:
                    fallback_data["telemetry_cache"] = {}
                
                # 해당 날짜 탭의 기존 캐시와 병합
                existing_records = fallback_data["telemetry_cache"].get(date_tab, [])
                existing_map = {r["timestamp"] + "_" + r["outlet"]: r for r in existing_records}
                for r in records:
                    key = str(r.get("timestamp")) + "_" + str(r.get("outlet"))
                    existing_map[key] = r
                
                fallback_data["telemetry_cache"][date_tab] = list(existing_map.values())
                with open(self.fallback_file, "w", encoding="utf-8") as f:
                    json.dump(fallback_data, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"[GoogleSheetsStorage] 로컬 캐시 업데이트 오류: {e}")

            if self.spreadsheet:
                try:
                    # 해당 실제 날짜(YYYY-MM-DD) 탭 가져오기 또는 새로 생성
                    try:
                        worksheet = self.spreadsheet.worksheet(date_tab)
                    except Exception:
                        print(f"[GoogleSheetsStorage] 실제 날짜 시트 탭 [{date_tab}] 새로 생성")
                        worksheet = self.spreadsheet.add_worksheet(title=date_tab, rows=2000, cols=12)
                        worksheet.append_row(header)

                    # 기존 데이터 읽어와 중복 방지 병합 (upsert)
                    existing_recs = []
                    try:
                        existing_recs = worksheet.get_all_records()
                    except Exception:
                        pass

                    existing_keys = {f"{r.get('timestamp')}_{r.get('outlet')}" for r in existing_recs}
                    
                    rows_to_insert = []
                    for r in records:
                        key = f"{r.get('timestamp')}_{r.get('outlet')}"
                        if key not in existing_keys:
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

                    if rows_to_insert:
                        worksheet.append_rows(rows_to_insert)
                        print(f"[GoogleSheetsStorage] 실제 날짜 탭 [{date_tab}]에 신규 데이터 {len(rows_to_insert)}건 추가 완료!")
                    success_any = True
                except Exception as e:
                    print(f"[GoogleSheetsStorage] 탭 [{date_tab}] 추가 중 오류: {e}")

        return success_any

    def save_daily_report(self, report: Dict[str, Any]) -> bool:
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
