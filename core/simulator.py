import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, Any, List
from core.analyzer import StackAnalyzer
from core.telegram_bot import telegram_bot
from core.google_sheets import storage
from core.config import config

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

        # 배출구 1, 3에 이상 징후 인젝션 (테스트 검증용)
        if outlet_name == "배출구 1":
            # 1. 헌팅 (급변동): 10:00 경 (idx 24) Temp, Flow 60% 급증
            df.loc[24:28, "Flow"] = df.loc[24:28, "Flow"] * 1.65
            df.loc[24:28, "Temp"] = df.loc[24:28, "Temp"] * 1.55
            # 2. 기준치 초과: 14:30 경 (idx 78) TSP 28.5 mg/m³ (기준 15.0)
            df.loc[78:80, "TSP"] = 28.50
        elif outlet_name == "배출구 3":
            # 3. 고정 데이터 알람: 16:00 경 (idx 96~112) NOX 값 32.40ppm 15회 연속 고정
            df.loc[96:112, "NOX"] = 32.40

        return df

    def generate_mock_telemetry(self, outlet_name: str = "배출구 1", date_str: str = None) -> pd.DataFrame:
        if not date_str:
            date_str = datetime.now().strftime("%Y-%m-%d")
        return self.generate_outlet_mock(outlet_name, date_str)

    def run_simulation_test(self, outlet_name: str = "ALL") -> Dict[str, Any]:
        """
        배출구 1~5 전체 시뮬레이션 데이터 생성 -> 종합 분석 수행 -> 텔레그램 종합 테스트 발송
        """
        date_str = datetime.now().strftime("%Y-%m-%d")
        outlets = config.OUTLETS
        
        all_dfs = []
        reports_by_outlet = {}
        all_alarms = []
        total_rows = 0

        for idx, out in enumerate(outlets):
            out_df = self.generate_outlet_mock(out, date_str, seed=42 + idx * 10)
            all_dfs.append(out_df)
            rep = self.analyzer.generate_daily_report(out_df, out, date_str)
            reports_by_outlet[out] = rep
            if rep.get("alarms"):
                all_alarms.extend(rep["alarms"])
            total_rows += len(out_df)

        comprehensive_report = {
            "date": date_str,
            "outlets": outlets,
            "reports": reports_by_outlet,
            "all_alarms": all_alarms,
            "alarm_count": len(all_alarms)
        }

        # 텔레그램 메세지 렌더링
        message_text = telegram_bot.render_template(comprehensive_report)
        
        # 강조 헤딩 추가
        sim_heading = "🧪 <b>[시스템 시뮬레이션 테스트 발송]</b>\n"
        full_message = sim_heading + message_text

        # 텔레그램 발송
        send_result = telegram_bot.send_message(full_message)

        return {
            "simulation_success": True,
            "date": date_str,
            "outlets": outlets,
            "reports": reports_by_outlet,
            "total_rows": total_rows,
            "detected_alarm_count": len(all_alarms),
            "raw_alarms": all_alarms,
            "telegram_result": send_result,
            "sent_message_preview": full_message
        }

simulator = StackSimulator()
