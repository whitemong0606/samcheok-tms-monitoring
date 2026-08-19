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

    def generate_mock_telemetry(self, outlet_name: str = "배출구 1", date_str: str = None) -> pd.DataFrame:
        """
        24시간 5분 단위(288개) 또는 30분 단위 가상 굴뚝 원시 데이터 생성
        + 5가지 이상 징후 인젝션
        """
        if not date_str:
            date_str = datetime.now().strftime("%Y-%m-%d")

        start_dt = datetime.strptime(f"{date_str} 08:00:00", "%Y-%m-%d %H:%M:%S")
        timestamps = [start_dt + timedelta(minutes=5 * i) for i in range(288)]

        # 베이스 라인 (정상 운전 상태)
        # O2: 12% ~ 15% (운전)
        np.random.seed(42) # 재현 가능성
        o2_base = np.random.normal(14.0, 0.5, 288)
        flow_base = np.random.normal(25000, 1000, 288)
        temp_base = np.random.normal(160, 5, 288)
        tsp_base = np.random.normal(8.0, 1.2, 288)
        nox_base = np.random.normal(25.0, 3.0, 288)
        sox_base = np.random.normal(15.0, 2.0, 288)

        df = pd.DataFrame({
            "timestamp": [ts.strftime("%Y-%m-%d %H:%M:%S") for ts in timestamps],
            "O2": np.round(o2_base, 2),
            "Flow": np.round(flow_base, 0),
            "Temp": np.round(temp_base, 1),
            "TSP": np.round(np.maximum(0, tsp_base), 2),
            "NOX": np.round(np.maximum(0, nox_base), 2),
            "SOX": np.round(np.maximum(0, sox_base), 2)
        })

        # 이상 징후 인젝션 (테스트 검증용)
        # 1. 헌팅 (급변동): 10:00 경 (idx 24) Temp, Flow 60% 급증
        df.loc[24:28, "Flow"] = df.loc[24:28, "Flow"] * 1.65
        df.loc[24:28, "Temp"] = df.loc[24:28, "Temp"] * 1.55

        # 2. 기준치 초과 (Threshold Exceeded): 14:30 경 (idx 78) TSP 28.5 mg/m³ (기준 15.0)
        df.loc[78:80, "TSP"] = 28.50

        # 3. 고정 데이터 (Frozen Data): 16:00 경 (idx 96~110) NOX 값 32.40ppm 15회 연속 고정
        df.loc[96:112, "NOX"] = 32.40

        # 4. 정지 중 이상 데이터 (Stop-State Abnormal): 22:00 ~ 24:00 (idx 168~192) 정지(O2=20.2%) 인데 고온(140°C) 유지
        df.loc[168:192, "O2"] = 20.2
        df.loc[168:192, "Temp"] = 145.0
        df.loc[168:192, "Flow"] = 18000.0

        return df

    def run_simulation_test(self, outlet_name: str = "배출구 1") -> Dict[str, Any]:
        """
        시뮬레이션 데이터 생성 -> 분석 로직 수행 -> 텔레그램 테스트 발송
        """
        date_str = datetime.now().strftime("%Y-%m-%d")
        mock_df = self.generate_mock_telemetry(outlet_name, date_str)

        # 분석 및 리포트 생성
        report_data = self.analyzer.generate_daily_report(mock_df, outlet_name, date_str)

        # 텔레그램 메세지 렌더링
        message_text = telegram_bot.render_template(report_data)
        
        # 강조 텍스트 추가
        sim_heading = "🧪 <b>[시스템 시뮬레이션 테스트 발송]</b>\n"
        full_message = sim_heading + message_text

        # 텔레그램 발송
        send_result = telegram_bot.send_message(full_message)

        return {
            "simulation_success": True,
            "outlet": outlet_name,
            "date": date_str,
            "report_summary": report_data,
            "generated_rows": len(mock_df),
            "detected_alarm_count": report_data.get("alarm_count", 0),
            "raw_alarms": report_data.get("alarms", []),
            "telegram_result": send_result,
            "sent_message_preview": full_message
        }

simulator = StackSimulator()
