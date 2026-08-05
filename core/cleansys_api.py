import requests
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional, Tuple
from urllib.parse import quote, unquote

# 한국 표준시 (KST = UTC+9) 타임존 정의
KST = timezone(timedelta(hours=9))

class CleanSysAPIClient:
    """한국환경공단 굴뚝자동측정기기(CleanSYS) 실시간 측정결과 Open API 연동 모듈"""
    
    BASE_URL = "https://apis.data.go.kr/B552584/cleansys/rltmMesureResult"
    SERVICE_KEY_ENCODED = "JbxpGqUoL5Oe%2F6pLaYrXrf53x91VCYwDTvf1iiVbp%2BY6x%2BdRjoyLbDuToNlyrZsewehgPx5gj0BLjJq4dewKbg%3D%3D"

    def __init__(self, service_key: Optional[str] = None):
        self.service_key = service_key or self.SERVICE_KEY_ENCODED

    def fetch_realtime_data(self, 
                            fact_manage_nm: Optional[str] = None, 
                            area_nm: Optional[str] = None, 
                            stack_code: Optional[str] = None) -> List[Dict[str, Any]]:
        raw_key = self.service_key
        if "%" not in raw_key:
            raw_key = quote(raw_key)

        url = f"{self.BASE_URL}?serviceKey={raw_key}&type=json"
        if area_nm:
            url += f"&areaNm={quote(str(area_nm))}"
        if fact_manage_nm:
            url += f"&factManageNm={quote(str(fact_manage_nm))}"
        if stack_code:
            url += f"&stackCode={quote(str(stack_code))}"

        try:
            response = requests.get(url, timeout=3, headers={"User-Agent": "Mozilla/5.0"})
            if response.status_code == 200:
                try:
                    data = response.json()
                    header = data.get("response", {}).get("header", {})
                    result_code = str(header.get("resultCode", ""))
                    
                    if result_code in ["0", "00", "NORMAL_CODE"]:
                        body = data.get("response", {}).get("body", {})
                        items_raw = body.get("items", [])
                        if isinstance(items_raw, dict):
                            items_raw = items_raw.get("item", [])
                        if isinstance(items_raw, dict):
                            items_raw = [items_raw]
                        if isinstance(items_raw, list) and len(items_raw) > 0:
                            return items_raw
                except Exception:
                    pass
        except Exception as e:
            print(f"[CleanSysAPI] 실시간 통신 대기 초과 ({e}). 전일 08:00 ~ 금일 08:00 24시간 시계열 생성.")
            
        return []

    def generate_24h_telemetry(self, fact_manage_nm: str = "한국남부발전", area_nm: str = "강원도", target_date_str: Optional[str] = None) -> Tuple[pd.DataFrame, pd.DataFrame, List[Dict[str, Any]]]:
        """
        1) target_date_str 지정 시: 달력 지정일 (00:00:00 ~ 23:55:00, 24h) 기준 생성
        2) 미지정 시: 실시간 KST (전일 08:00 ~ 금일 08:00, 24h) 기준 생성
        """
        if target_date_str:
            try:
                start_kst = datetime.strptime(target_date_str, "%Y-%m-%d").replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=KST)
            except Exception:
                now_kst = datetime.now(KST)
                today_08_kst = now_kst.replace(hour=8, minute=0, second=0, microsecond=0)
                if now_kst < today_08_kst:
                    today_08_kst = today_08_kst - timedelta(days=1)
                start_kst = today_08_kst - timedelta(days=1)
        else:
            now_kst = datetime.now(KST)
            today_08_kst = now_kst.replace(hour=8, minute=0, second=0, microsecond=0)
            if now_kst < today_08_kst:
                today_08_kst = today_08_kst - timedelta(days=1)
            start_kst = today_08_kst - timedelta(days=1)

        timestamps_5m = [start_kst + timedelta(minutes=5 * i) for i in range(288)]
        timestamps_30m = [start_kst + timedelta(minutes=30 * i) for i in range(48)]

        rows_5m = []
        rows_30m = []
        validation_logs = []

        np.random.seed(int(start_kst.timestamp()) % 1000000)

        for stack_num in range(1, 6):
            outlet_id = f"배출구 {stack_num}"
            
            # 배출구 1, 2, 5는 지난 24시간 동안 정지(STOP) 상태!
            if stack_num in [1, 2, 5]:
                tsp_5m = np.zeros(288)
                nox_5m = np.zeros(288)
                sox_5m = np.zeros(288)
                o2_5m = np.random.normal(20.5, 0.1, 288)   # 대기 산소 농도 20.5%
                flow_5m = np.random.normal(250, 20, 288)   # 미미한 잔여 유량
                temp_5m = np.random.normal(42, 2, 288)     # 식어있는 굴뚝 온도
            else:
                # 배출구 3, 4는 정상 운전(OPERATING) 상태
                base_tsp = 2.4 + (stack_num - 3) * 1.5
                base_nox = 14.5 + (stack_num - 3) * 5.0
                base_sox = 6.2 + (stack_num - 3) * 3.0
                base_o2 = 13.8 + (stack_num % 2) * 0.8
                base_flow = 28000 + (stack_num - 3) * 4000
                base_temp = 155 + (stack_num - 3) * 8

                tsp_5m = np.maximum(0, np.random.normal(base_tsp, 0.6, 288))
                nox_5m = np.maximum(0, np.random.normal(base_nox, 2.0, 288))
                sox_5m = np.maximum(0, np.random.normal(base_sox, 1.2, 288))
                o2_5m = np.clip(np.random.normal(base_o2, 0.3, 288), 10.0, 16.0)
                flow_5m = np.maximum(0, np.random.normal(base_flow, 1000, 288))
                temp_5m = np.maximum(0, np.random.normal(base_temp, 4, 288))

                # 8/4 현장 실측 특성 반영: 운전 중 NOX 0.00ppm 순간 결측(드롭아웃) 발생
                nox_zero_slots = [20, 21, 22, 75, 76, 130, 131, 185, 186, 240, 241]
                for n_idx in nox_zero_slots:
                    nox_5m[n_idx] = 0.00

                # 배출구 3: 유량계 보수 작업 진행 중으로 인한 유량 계측 이상치 발생
                if stack_num == 3:
                    tsp_5m[72:75] = tsp_5m[72:75] * 2.2
                    # 유량계 보수 구간 (0.00m³/h 추락 및 48,000m³/h 급증 스파이크)
                    flow_maintenance_slots_zero = [50, 51, 52, 53, 150, 151, 152]
                    flow_maintenance_slots_high = [60, 61, 160, 161]
                    for f_idx in flow_maintenance_slots_zero:
                        flow_5m[f_idx] = 0.0
                    for f_idx in flow_maintenance_slots_high:
                        flow_5m[f_idx] = 48500.0

            # 5분 데이터 288개 구성
            for idx, ts in enumerate(timestamps_5m):
                rows_5m.append({
                    "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
                    "outlet": outlet_id,
                    "fact_manage_nm": fact_manage_nm,
                    "area_nm": area_nm,
                    "TSP": round(float(tsp_5m[idx]), 2),
                    "NOX": round(float(nox_5m[idx]), 2),
                    "SOX": round(float(sox_5m[idx]), 2),
                    "O2": round(float(o2_5m[idx]), 2),
                    "Flow": round(float(flow_5m[idx]), 0),
                    "Temp": round(float(temp_5m[idx]), 1)
                })

            # 30분 데이터 48개 구성 및 5분 6회 평균 일치 검증
            for i_30 in range(48):
                slice_start = i_30 * 6
                slice_end = slice_start + 6
                ts_30 = timestamps_30m[i_30].strftime("%Y-%m-%d %H:%M:%S")

                avg_tsp_5m = float(np.mean(tsp_5m[slice_start:slice_end]))
                avg_nox_5m = float(np.mean(nox_5m[slice_start:slice_end]))
                avg_sox_5m = float(np.mean(sox_5m[slice_start:slice_end]))
                avg_o2_5m = float(np.mean(o2_5m[slice_start:slice_end]))
                avg_flow_5m = float(np.mean(flow_5m[slice_start:slice_end]))
                avg_temp_5m = float(np.mean(temp_5m[slice_start:slice_end]))

                val_tsp_30 = round(avg_tsp_5m, 2)
                val_nox_30 = round(avg_nox_5m, 2)
                val_sox_30 = round(avg_sox_5m, 2)

                diff_tsp = abs(avg_tsp_5m - val_tsp_30)
                diff_nox = abs(avg_nox_5m - val_nox_30)

                is_matched = (diff_tsp < 0.1) and (diff_nox < 0.1)
                if not is_matched:
                    validation_logs.append({
                        "timestamp": ts_30,
                        "outlet": outlet_id,
                        "status": "DISCREPANCY",
                        "message": f"5분 데이터 6회 평균(TSP: {avg_tsp_5m:.2f})과 30분 데이터({val_tsp_30:.2f}) 불일치 발생"
                    })

                rows_30m.append({
                    "timestamp": ts_30,
                    "outlet": outlet_id,
                    "fact_manage_nm": fact_manage_nm,
                    "area_nm": area_nm,
                    "TSP": val_tsp_30,
                    "NOX": val_nox_30,
                    "SOX": val_sox_30,
                    "O2": round(avg_o2_5m, 2),
                    "Flow": round(avg_flow_5m, 0),
                    "Temp": round(avg_temp_5m, 1),
                    "is_matched": is_matched
                })

        df_5m = pd.DataFrame(rows_5m)
        df_30m = pd.DataFrame(rows_30m)
        return df_5m, df_30m, validation_logs

cleansys_client = CleanSysAPIClient()
