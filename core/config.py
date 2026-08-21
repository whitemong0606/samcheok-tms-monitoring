import os
from pydantic import BaseModel
from typing import Dict, Any

class StackEmissionLimits(BaseModel):
    """배출 허용 기준치 설정 (기본값)"""
    TSP: float = 15.0  # mg/m³
    NOX: float = 50.0  # ppm
    SOX: float = 50.0  # ppm
    O2: float = 21.0   # % (상한 참조)
    Flow: float = 50000.0 # m³/h
    Temp: float = 300.0   # °C

class SystemConfig:
    """시스템 환경 설정 및 상수"""
    TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    TELEGRAM_CHAT_ID: str = os.getenv("TELEGRAM_CHAT_ID", "")
    TELEGRAM_GROUP_CHAT_ID: str = os.getenv("TELEGRAM_GROUP_CHAT_ID", "")
    GOOGLE_SHEET_ID: str = os.getenv("GOOGLE_SHEET_ID", "1vmOgz9xh6w5LMg6Oh-yU_-1TNwIuQ8-vIpBAT0IpizY")
    DAILY_REPORT_TIME: str = os.getenv("DAILY_REPORT_TIME", "08:30")
    
    # 배출구 목록 (5개 배출구)
    OUTLETS = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"]
    
    # 감시 항목 (6개 인자)
    FACTORS = ["TSP", "NOX", "SOX", "O2", "Flow", "Temp"]
    
    # 헌팅(급변동) 감지 임계 비율
    HUNTING_THRESHOLDS = {
        "O2": 0.50,     # 50% 이상 변동
        "Flow": 0.50,   # 50% 이상 변동
        "Temp": 0.50,   # 50% 이상 변동
        "TSP": 1.00,    # 100% 이상 변동
        "NOX": 1.00,    # 100% 이상 변동
        "SOX": 1.00     # 100% 이상 변동
    }
    
    # 고정 데이터 알람 횟수 (5분 데이터 10회 연속 = 50분)
    FROZEN_DATA_COUNT = 10
    
    # 결측 알람 기준 (30분 데이터 4회 연속 = 2시간)
    MISSING_DATA_COUNT = 4
    
    # 운전/정지 판별 기준
    STOP_O2_THRESHOLD = 19.5       # O2 >= 19.5% 면 정지 의심
    OPERATING_O2_THRESHOLD = 16.0  # O2 <= 16.0% 면 운전
    STOP_FLOW_THRESHOLD = 1000.0   # m³/h 이하
    STOP_TEMP_THRESHOLD = 70.0     # °C 이하

    DEFAULT_TEMPLATE = (
        "📊 <b>[삼척빛드림본부 굴뚝 배출가스 일일 종합 리포트]</b>\n"
        "📅 <b>기간:</b> {date}\n\n"
        "🏭 <b>[배출구별 설비 운전 상태]</b>\n"
        "{outlets_status}\n\n"
        "🔹 <b>[배출구별 운전 중 평균 수치]</b>\n"
        "{outlets_averages}\n\n"
        "⚠️ <b>[배출구별 이상 신호 감지 내역 ({alarm_count}건)]</b>\n"
        "{alarms}"
    )

config = SystemConfig()
default_limits = StackEmissionLimits()
