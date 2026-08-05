import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple
from core.config import config, default_limits

class AlarmEvent:
    def __init__(self, timestamp: str, outlet: str, factor: str, alarm_type: str, message: str, level: str = "WARNING"):
        self.timestamp = timestamp
        self.outlet = outlet
        self.factor = factor
        self.alarm_type = alarm_type # MISSING_DATA, THRESHOLD_EXCEEDED, HUNTING, FROZEN_DATA, STOP_ABNORMAL
        self.message = message
        self.level = level

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "outlet": self.outlet,
            "factor": self.factor,
            "alarm_type": self.alarm_type,
            "message": self.message,
            "level": self.level
        }

class StackAnalyzer:
    def __init__(self, limits: Dict[str, float] = None):
        self.limits = limits or default_limits.model_dump()

    def classify_operating_state(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        보일러 연소 가스 배출구 특성 반영 운전/정지 판별 logic.
        - O2 >= 19.5% 이거나 Temp < 70, Flow < 1000 -> '정지 (STOP)'
        - O2 <= 16.0% 이고 Temp/Flow 상승 -> '운전 (OPERATING)'
        """
        df = df.copy()
        states = []
        
        for idx, row in df.iterrows():
            o2 = row.get("O2", np.nan)
            temp = row.get("Temp", np.nan)
            flow = row.get("Flow", np.nan)
            
            if pd.isna(o2):
                states.append("UNKNOWN")
                continue
                
            # 정지 조건
            is_stop = (o2 >= config.STOP_O2_THRESHOLD) or (
                (pd.notna(temp) and temp < config.STOP_TEMP_THRESHOLD) and 
                (pd.notna(flow) and flow < config.STOP_FLOW_THRESHOLD)
            )
            
            # 운전 조건
            is_op = (o2 <= config.OPERATING_O2_THRESHOLD) or (
                (pd.notna(flow) and flow >= config.STOP_FLOW_THRESHOLD) and 
                (pd.notna(temp) and temp >= config.STOP_TEMP_THRESHOLD)
            )
            
            if is_stop and not is_op:
                states.append("STOP")
            elif is_op:
                states.append("OPERATING")
            else:
                if o2 > 18.0:
                    states.append("STOP")
                else:
                    states.append("OPERATING")
                    
        df["State"] = states
        return df

    def analyze_stack(self, df: pd.DataFrame, outlet_name: str) -> Tuple[pd.DataFrame, List[AlarmEvent]]:
        """
        단일 배출구에 대한 전체 상태 판별 및 5가지 이상 알람 조건 정밀 검증
        """
        if df.empty:
            return df, [AlarmEvent(datetime.now().strftime("%Y-%m-%d %H:%M"), outlet_name, "ALL", "MISSING_DATA", "데이터가 존재하지 않습니다.", "CRITICAL")]
        
        df = df.sort_values(by="timestamp").reset_index(drop=True)
        df = self.classify_operating_state(df)
        
        alarms: List[AlarmEvent] = []
        
        # 1. 데이터 수집 검증: 2시간(4회) 연속 결측 알람 (Missing Data)
        missing_streak = 0
        for idx, row in df.iterrows():
            is_missing = all(pd.isna(row.get(f)) for f in config.FACTORS)
            if is_missing:
                missing_streak += 1
                if missing_streak >= config.MISSING_DATA_COUNT:
                    alarms.append(AlarmEvent(
                        timestamp=str(row["timestamp"]),
                        outlet=outlet_name,
                        factor="ALL",
                        alarm_type="MISSING_DATA",
                        message=f"최근 2시간({missing_streak * 30}분) 연속 데이터 미수신(결측) 발생",
                        level="CRITICAL"
                    ))
            else:
                missing_streak = 0

        for factor in config.FACTORS:
            if factor not in df.columns:
                continue
                
            series = df[factor].astype(float)
            
            # 2. 기준치 초과 알람 (Threshold Exceeded)
            limit = self.limits.get(factor)
            if limit is not None and factor in ["TSP", "NOX", "SOX"]:
                exceeded_mask = (series > limit) & (df["State"] == "OPERATING")
                for idx in df[exceeded_mask].index:
                    row = df.loc[idx]
                    alarms.append(AlarmEvent(
                        timestamp=str(row["timestamp"]),
                        outlet=outlet_name,
                        factor=factor,
                        alarm_type="THRESHOLD_EXCEEDED",
                        message=f"{factor} 배출 허용 기준치 초과! (측정값: {row[factor]:.2f}, 기준치: {limit:.2f})",
                        level="CRITICAL"
                    ))

            # 3. 급변동(헌팅) 알람 (Hunting)
            # 운전 중(OPERATING) 이며 유의미한 평균 수치가 존재하는 경우만 비교 (0.00 수치 제외)
            hunting_thresh = config.HUNTING_THRESHOLDS.get(factor, 0.5)
            rolling_avg = series.shift(1).rolling(window=12, min_periods=3).mean()
            
            for idx in range(len(df)):
                val = series.iloc[idx]
                avg = rolling_avg.iloc[idx]
                state = df["State"].iloc[idx]
                
                # 운전 중이며 이전 평균이 0.5 이상으로 유의미한 경우에만 헌팅 알람 검사
                if state == "OPERATING" and pd.notna(val) and pd.notna(avg) and avg >= 0.5:
                    rel_change = abs(val - avg) / avg
                    if rel_change >= hunting_thresh:
                        row = df.iloc[idx]
                        alarms.append(AlarmEvent(
                            timestamp=str(row["timestamp"]),
                            outlet=outlet_name,
                            factor=factor,
                            alarm_type="HUNTING",
                            message=f"{factor} 급변동(헌팅) 감지! (이전 평균: {avg:.2f}, 현재값: {val:.2f}, 변동률: {rel_change*100:.1f}%)",
                            level="WARNING"
                        ))

            # 4. 고정 데이터 알람 (Frozen Data)
            # 10회 연속 동일한 값 지시 여부
            # 단! SOX, NOX, TSP는 0이 아닌(non-zero) 상수값이 10회 고정될 때만 알람! (정지 중 0.00 고정은 정상)
            consecutive_count = 1
            last_val = None
            
            for idx in range(len(df)):
                val = series.iloc[idx]
                state = df["State"].iloc[idx]
                row_time = str(df["timestamp"].iloc[idx])
                
                if pd.notna(val) and val == last_val:
                    consecutive_count += 1
                else:
                    consecutive_count = 1
                    last_val = val
                    
                if consecutive_count >= config.FROZEN_DATA_COUNT:
                    if factor in ["SOX", "NOX", "TSP"]:
                        # 0을 제외한 0이 아닌 상수값 10회 고정 시에만 알람!
                        if val is not None and float(val) > 0.0:
                            alarms.append(AlarmEvent(
                                timestamp=row_time,
                                outlet=outlet_name,
                                factor=factor,
                                alarm_type="FROZEN_DATA",
                                message=f"{factor} 고정 데이터 알람 (0이 아닌 상수값 {val:.2f}가 10회 연속 동일 지시)",
                                level="WARNING"
                            ))
                    else:
                        # O2, Flow, Temp 등 일반 물리 인자
                        alarms.append(AlarmEvent(
                            timestamp=row_time,
                            outlet=outlet_name,
                            factor=factor,
                            alarm_type="FROZEN_DATA",
                            message=f"{factor} 고정 데이터 알람 (수치 {val:.2f}가 10회 연속 동일 지시)",
                            level="WARNING"
                        ))
            
            # SOX/NOX 특수 규칙: 운전 중(OPERATING) 하루 종일 0.00 고정 시 센서 고장 알람
            if factor in ["SOX", "NOX"]:
                op_df = df[df["State"] == "OPERATING"]
                if len(op_df) >= 20:
                    zero_ratio = (op_df[factor] == 0.0).mean()
                    if zero_ratio >= 0.95:
                        alarms.append(AlarmEvent(
                            timestamp=str(df["timestamp"].iloc[-1]),
                            outlet=outlet_name,
                            factor=factor,
                            alarm_type="FROZEN_DATA",
                            message=f"{factor} 센서 고장 의심 (운전 상태 중 하루 종일 0.00 고정지시 비율 {zero_ratio*100:.1f}%)",
                            level="WARNING"
                        ))



        # 5. 정지 중 이상 데이터 알람 (Stop-State Abnormal Data)
        # 정지 상태(STOP)임에도 0이 아닌 이상치(고온/고유량 또는 높은 오염물질 > 0.00) 송출 시 발생
        stop_df = df[df["State"] == "STOP"]
        for idx in stop_df.index:
            row = df.loc[idx]
            temp = float(row.get("Temp", 0.0))
            flow = float(row.get("Flow", 0.0))
            nox = float(row.get("NOX", 0.0))
            sox = float(row.get("SOX", 0.0))
            tsp = float(row.get("TSP", 0.0))
            
            # 정지 중 0이 아닌 수치(고온, 고유량 또는 0이 아닌 오염물질 발생) 감지
            abnormal_factors = []
            if temp > 80.0 and flow > 1000.0:
                abnormal_factors.append(f"고온({temp:.1f}°C)/고유량({flow:.0f}m³/h)")
            if nox > 1.0:
                abnormal_factors.append(f"NOX({nox:.1f}ppm)")
            if sox > 1.0:
                abnormal_factors.append(f"SOX({sox:.1f}ppm)")
            if tsp > 1.0:
                abnormal_factors.append(f"TSP({tsp:.1f}mg/m³)")

            if abnormal_factors:
                alarms.append(AlarmEvent(
                    timestamp=str(row["timestamp"]),
                    outlet=outlet_name,
                    factor="STOP_MONITOR",
                    alarm_type="STOP_ABNORMAL",
                    message=f"정지 상태 중 비Zero 이상 수치 지속 송출! [{', '.join(abnormal_factors)}]",
                    level="WARNING"
                ))
                
        # 중복 알람 제거 (타입, 배출구, 인자, 타임스탬프 기준)
        unique_alarms = []
        seen = set()
        for a in alarms:
            key = (a.timestamp, a.outlet, a.factor, a.alarm_type)
            if key not in seen:
                seen.add(key)
                unique_alarms.append(a)
                
        return df, unique_alarms

    def generate_daily_report(self, df: pd.DataFrame, outlet_name: str, date_str: str) -> Dict[str, Any]:
        """
        전일 08:00 ~ 금일 08:00 데이터를 요약하여 운전 상태 한정 각 인자별 평균 및 리포트 생성
        """
        df_analyzed, alarms = self.analyze_stack(df, outlet_name)
        
        op_df = df_analyzed[df_analyzed["State"] == "OPERATING"]
        stop_df = df_analyzed[df_analyzed["State"] == "STOP"]
        
        time_unit = 0.5 if len(df_analyzed) <= 48 else (1.0 / 12.0)
        op_hours = round(len(op_df) * time_unit, 1)
        stop_hours = round(len(stop_df) * time_unit, 1)
        
        status_summary = "운전 중" if len(op_df) > len(stop_df) else "정지 중"
        
        # 운전 중 평균만 필터링 산출
        averages = {}
        for factor in config.FACTORS:
            if not op_df.empty and factor in op_df.columns and pd.notna(op_df[factor]).any():
                averages[factor] = round(float(op_df[factor].mean()), 2)
            else:
                averages[factor] = 0.00

        alarm_msgs = []
        for a in alarms:
            alarm_msgs.append(f"• [{a.timestamp[-5:]}] {a.factor}: {a.message}")
            
        alarm_text = "\n".join(alarm_msgs) if alarm_msgs else "• 특이사항 없음 (모든 인자 정상 범위)"
        
        report_data = {
            "date": date_str,
            "outlet": outlet_name,
            "status": status_summary,
            "operating_hours": op_hours,
            "stop_hours": stop_hours,
            "avg_tsp": averages.get("TSP", 0.0),
            "avg_nox": averages.get("NOX", 0.0),
            "avg_sox": averages.get("SOX", 0.0),
            "avg_o2": averages.get("O2", 0.0),
            "avg_flow": averages.get("Flow", 0.0),
            "avg_temp": averages.get("Temp", 0.0),
            "alarm_count": len(alarms),
            "alarms": alarm_text,
            "raw_alarms": [a.to_dict() for a in alarms]
        }
        
        return report_data
