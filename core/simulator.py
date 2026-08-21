import pandas as pd
import numpy as np
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional, Tuple
from core.analyzer import StackAnalyzer
from core.telegram_bot import telegram_bot
from core.cleansys_api import cleansys_client
from core.google_sheets import storage
from core.config import config

KST = timezone(timedelta(hours=9))

class StackSimulator:
    def __init__(self):
        self.analyzer = StackAnalyzer()

    def generate_outlet_mock(self, outlet_name: str, date_str: str, seed: int = 42) -> pd.DataFrame:
        """
        배출구별 특성에 맞춘 24시간 가상 굴뚝 원시 데이터 생성
        """
        start_dt = datetime.strptime(f"{date_str} 08:00:00", "%Y-%m-%d %H:%M:%S")
        timestamps = [start_dt + timedelta(minutes=5 * i) for i in range(288)]
        np.random.seed(seed)

        if outlet_name == "배출구 4":
            # 배출구 4: 가동정지 (O2 20.4%, 유량 0, 온도 25°C)
            o2_base = np.random.normal(20.4, 0.2, 288)
            flow_base = np.zeros(288)
            temp_base = np.random.normal(25.0, 2.0, 288)
            tsp_base = np.zeros(288)
            nox_base = np.zeros(288)
            sox_base = np.zeros(288)
        else:
            # 정상 운전 중 배출구 (각기 다른 정상 평균)
            base_means = {
                "배출구 1": {"o2": 14.5, "flow": 24800, "temp": 160.5, "tsp": 8.35, "nox": 25.5, "sox": 15.2},
                "배출구 2": {"o2": 14.1, "flow": 25100, "temp": 159.0, "tsp": 7.90, "nox": 23.5, "sox": 13.9},
                "배출구 3": {"o2": 14.3, "flow": 24500, "temp": 160.0, "tsp": 9.10, "nox": 26.2, "sox": 15.3},
                "배출구 5": {"o2": 14.0, "flow": 25300, "temp": 158.5, "tsp": 7.50, "nox": 22.8, "sox": 13.5}
            }
            m = base_means.get(outlet_name, base_means["배출구 1"])
            o2_base = np.random.normal(m["o2"], 0.4, 288)
            flow_base = np.random.normal(m["flow"], 800, 288)
            temp_base = np.random.normal(m["temp"], 4.0, 288)
            tsp_base = np.random.normal(m["tsp"], 1.0, 288)
            nox_base = np.random.normal(m["nox"], 2.5, 288)
            sox_base = np.random.normal(m["sox"], 1.8, 288)

        df = pd.DataFrame({
            "timestamp": [ts.strftime("%Y-%m-%d %H:%M:%S") for ts in timestamps],
            "outlet": outlet_name,
            "O2": np.round(np.clip(o2_base, 0, 21.0), 2),
            "Flow": np.round(np.maximum(0, flow_base), 0),
            "Temp": np.round(temp_base, 1),
            "TSP": np.round(np.maximum(0, tsp_base), 2),
            "NOX": np.round(np.maximum(0, nox_base), 2),
            "SOX": np.round(np.maximum(0, sox_base), 2)
        })

        if outlet_name == "배출구 1":
            df.loc[24:28, "Flow"] = df.loc[24:28, "Flow"] * 1.65
            df.loc[24:28, "Temp"] = df.loc[24:28, "Temp"] * 1.55
            df.loc[78:80, "TSP"] = 28.50
        elif outlet_name == "배출구 3":
            df.loc[96:112, "NOX"] = 32.40

        return df

    def generate_mock_telemetry(self, outlet_name: str = "배출구 1", date_str: str = None) -> pd.DataFrame:
        if not date_str:
            date_str = datetime.now().strftime("%Y-%m-%d")
        return self.generate_outlet_mock(outlet_name, date_str)

    def run_simulation_test(self, outlet_name: str = "ALL", real_df: Optional[pd.DataFrame] = None) -> Dict[str, Any]:
        """
        [100% 실측 데이터 기반 개인 텔레그램 테스트 발송]
        1. 구글 시트 / 캐시에 자동 수집된 24시간 실측 데이터(전일 08:00 ~ 금일 08:00) 로드
        2. 자동분석과 100% 동일한 StackAnalyzer를 통해 실제 운전상태/평균수치/실제 이상감지 판별
        3. 개인 관리자 Chat ID로만 발송 (팀원 그룹 채팅방 방해 없음)
        """
        now_dt = datetime.now(KST)
        prev_dt = now_dt - timedelta(days=1)
        today_str = now_dt.strftime("%Y-%m-%d")
        prev_str = prev_dt.strftime("%Y-%m-%d")
        default_period_str = f"{prev_str} 08:00 ~ {today_str} 08:00"

        outlets = config.OUTLETS
        df_target = None
        data_source = "MOCK"

        # 1. 전달받은 실데이터 확인 (수동 업로드 데이터 등)
        if real_df is not None and not real_df.empty:
            df_target = real_df
            data_source = "MANUAL_UPLOAD"

        # 2. 구글 시트에 누적 저장된 24시간 실측 30분 데이터 로드 (어제 + 오늘)
        if df_target is None or df_target.empty:
            try:
                dfs = []
                for d in [prev_str, today_str]:
                    day_df = storage.read_telemetry_data(d)
                    if day_df is not None and not day_df.empty:
                        dfs.append(day_df)
                if dfs:
                    df_target = pd.concat(dfs, ignore_index=True)
                    df_target.drop_duplicates(subset=["timestamp", "outlet"], inplace=True)
                    df_target.sort_values(by=["timestamp", "outlet"], inplace=True)
                    data_source = "GOOGLE_SHEETS_30M"
            except Exception as e:
                print(f"[Simulator] 구글 시트 데이터 로드 예외: {e}")

        # 3. CleanSYS 실시간 공단 API 조회 시도
        if df_target is None or df_target.empty:
            try:
                df_api = cleansys_client.get_raw_telemetry_dataframe("한국남부발전(주) 삼척빛드림본부", "강원도 삼척시")
                if df_api is not None and not df_api.empty:
                    df_target = df_api
                    data_source = "CLEANSYS_API"
            except Exception as e:
                print(f"[Simulator] CleanSYS API 로드 예외: {e}")

        is_real_data = (data_source in ["GOOGLE_SHEETS_30M", "CLEANSYS_API", "MANUAL_UPLOAD"] and df_target is not None and not df_target.empty)

        # 4. 분석 기간 결정 (실제 수집된 데이터의 시작 시각 ~ 종료 시각)
        if is_real_data and "timestamp" in df_target.columns:
            ts_series = df_target["timestamp"].astype(str)
            min_ts = ts_series.min()
            max_ts = ts_series.max()
            period_str = f"{min_ts} ~ {max_ts}"
        else:
            period_str = default_period_str

        # 5. 배출구 1~5 자동 분석과 100% 동일한 로직으로 리포트 생성 및 알람 판별
        reports_by_outlet = {}
        all_alarms = []
        total_rows = 0

        for idx, out in enumerate(outlets):
            if is_real_data and "outlet" in df_target.columns:
                out_df = df_target[df_target["outlet"] == out]
                if out_df.empty:
                    rep = {
                        "date": period_str,
                        "outlet": out,
                        "status": "⚪ 데이터 없음",
                        "operating_hours": 0.0,
                        "stop_hours": 0.0,
                        "avg_tsp": 0.0, "avg_nox": 0.0, "avg_sox": 0.0, "avg_o2": 0.0, "avg_flow": 0.0, "avg_temp": 0.0,
                        "alarm_count": 0, "alarm_summary": "• 데이터 미수집", "alarms": []
                    }
                else:
                    rep = self.analyzer.generate_daily_report(out_df, out, period_str)
                    total_rows += len(out_df)
            else:
                out_df = self.generate_outlet_mock(out, today_str, seed=42 + idx * 10)
                rep = self.analyzer.generate_daily_report(out_df, out, period_str)
                total_rows += len(out_df)

            reports_by_outlet[out] = rep
            if rep.get("alarms"):
                all_alarms.extend(rep["alarms"])

        comprehensive_report = {
            "date": period_str,
            "outlets": outlets,
            "reports": reports_by_outlet,
            "all_alarms": all_alarms,
            "alarm_count": len(all_alarms)
        }

        # 6. 메시지 렌더링
        message_text = telegram_bot.render_template(comprehensive_report)
        prefix = f"🧪 <b>[삼척빛드림본부 일일 리포트 테스트 발송]</b>\n📊 데이터 기반: {data_source}\n\n"
        full_message = prefix + message_text

        # 7. 개인 Chat ID로만 텔레그램 발송
        tg_result = telegram_bot.send_message(full_message)

        return {
            "simulation_success": True,
            "is_real_data": is_real_data,
            "data_source": data_source,
            "period": period_str,
            "outlets": outlets,
            "reports": reports_by_outlet,
            "total_rows": total_rows,
            "detected_alarm_count": len(all_alarms),
            "raw_alarms": all_alarms,
            "telegram_result": tg_result,
            "sent_message_preview": full_message
        }

simulator = StackSimulator()
