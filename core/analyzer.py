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
        운전/정지 판별:
        [API 자동수집 데이터] status 컬럼에 CleanSYS 원문 상태 → 직접 분류
        [수동 업로드 데이터]  O2/Temp/Flow 실측값 → 임계치 기반 분류
        """
        df = df.copy()
        if df.empty:
            df["State"] = []
            return df

        # status/state/상태/구분 컬럼 탐색 (API 저장값 우선)
        existing_state_col = next(
            (c for c in df.columns if str(c).lower() in ["status", "state", "상태", "운전상태", "구분"]),
            None
        )
        states = []
        
        for idx, row in df.iterrows():
            def safe_f(v):
                if pd.isna(v) or v == "" or str(v).strip().lower() in ["nan", "none"]:
                    return None
                try:
                    return float(v)
                except (ValueError, TypeError):
                    return None

            o2_f   = safe_f(row.get("O2"))
            temp_f = safe_f(row.get("Temp"))
            flow_f = safe_f(row.get("Flow"))
            
            status_val = str(row.get("status", "")).strip()

            # 1. O2 / Temp / Flow 수치 기준 무조건 가동정지 (STOP)
            # O2 >= 19.5% -> 대기 유입 (연소 중단) -> STOP
            if o2_f is not None and o2_f >= 19.5:
                states.append("STOP")
                continue
            # Flow <= 100 m3/h -> 유량 없음 -> STOP
            if flow_f is not None and flow_f <= 100.0:
                states.append("STOP")
                continue
            # Temp <= 30.0 °C -> 배가스 온도 없음 -> STOP
            if temp_f is not None and temp_f <= 30.0:
                states.append("STOP")
                continue

            # 2. 텍스트 상태 뱃지 판별
            if any(k in status_val for k in ["가동중지", "가동 중지", "미운전", "정지", "STOP", "stop"]):
                states.append("STOP")
                continue
            elif any(k in status_val for k in ["점검", "자료확인", "보수", "불량"]):
                states.append("MAINTENANCE")
                continue

            # 3. O2 < 19.5% AND Flow > 100 AND Temp > 30.0 -> 정상 운전 (OPERATING)
            states.append("OPERATING")
                    
        df["State"] = states
        return df


    def analyze_stack(self, df: pd.DataFrame, outlet_name: str) -> Tuple[pd.DataFrame, List[AlarmEvent]]:
        """
        단일 배출구에 대한 전체 상태 판별 및 5가지 이상 알람 조건 정밀 검증
        """
        if df.empty or "timestamp" not in df.columns:
            empty_df = df.copy() if not df.empty else pd.DataFrame()
            empty_df["State"] = []
            return empty_df, [AlarmEvent(datetime.now().strftime("%Y-%m-%d %H:%M"), outlet_name, "ALL", "MISSING_DATA", "데이터가 존재하지 않습니다.", "CRITICAL")]
        
        df = df.sort_values(by="timestamp").reset_index(drop=True)
        df = self.classify_operating_state(df)
        
        state_series = df["State"] if "State" in df.columns else pd.Series(["OPERATING"] * len(df))
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
                
            # 문자열 찌꺼기(가동중지 등)가 혼입되어도 안전하게 숫자 변환 (비숫자는 NaN 처리)
            series = pd.to_numeric(df[factor], errors="coerce")

            
            # 2. 기준치 초과 알람 (Threshold Exceeded)
            limit = self.limits.get(factor)
            if limit is not None and factor in ["TSP", "NOX", "SOX"]:
                exceeded_mask = (series > limit) & (state_series == "OPERATING")
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
            hunting_thresh = config.HUNTING_THRESHOLDS.get(factor, 0.5)
            rolling_avg = series.shift(1).rolling(window=12, min_periods=3).mean()
            
            for idx in range(len(df)):
                val = series.iloc[idx]
                avg = rolling_avg.iloc[idx]
                st_val = state_series.iloc[idx]
                
                if st_val == "OPERATING" and pd.notna(val) and pd.notna(avg) and avg >= 0.5:
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

            # 4. 고정 데이터 알람 (Frozen Data) - 정상 운전 상태(OPERATING) 및 수치 0 초과 시에만 감지
            consecutive_count = 1
            last_val = None
            
            for idx in range(len(df)):
                val = series.iloc[idx]
                st_val = state_series.iloc[idx]
                row_time = str(df["timestamp"].iloc[idx])
                row_status = str(df["status"].iloc[idx]) if "status" in df.columns else ""
                
                # 계측기 상태가 보수/점검/자료확인/가동중지인 행은 알람 감지 대상에서 제외
                if st_val in ["MAINTENANCE", "STOP"] or any(k in row_status for k in ["보수", "점검", "자료확인", "정지", "가동중지"]):
                    consecutive_count = 1
                    last_val = None
                    continue

                if pd.notna(val) and val == last_val:
                    consecutive_count += 1
                else:
                    consecutive_count = 1
                    last_val = val
                    
                if consecutive_count >= config.FROZEN_DATA_COUNT:
                    if factor in ["SOX", "NOX", "TSP"]:
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
                        # Flow / Temp / O2 등도 수치 0 초과인 유효 동작 값일 때만 고정 데이터 알람 감지
                        if val is not None and float(val) > 0.0:
                            alarms.append(AlarmEvent(
                                timestamp=row_time,
                                outlet=outlet_name,
                                factor=factor,
                                alarm_type="FROZEN_DATA",
                                message=f"{factor} 고정 데이터 알람 (수치 {val:.2f}가 10회 연속 동일 지시)",
                                level="WARNING"
                            ))
            
            if factor in ["SOX", "NOX"]:
                op_df = df[state_series == "OPERATING"]
                if len(op_df) >= 20 and factor in op_df.columns:
                    num_op = pd.to_numeric(op_df[factor], errors="coerce")
                    zero_ratio = (num_op == 0.0).mean()
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
        stop_df = df[state_series == "STOP"]
        for idx in stop_df.index:
            row = df.loc[idx]
            # API 데이터에서 O2/Flow/Temp가 None일 수 있으므로 안전 변환
            def safe_f(v, default=0.0):
                try:
                    return float(v) if v is not None and v != "" else default
                except (TypeError, ValueError):
                    return default
            temp = safe_f(row.get("Temp"))
            flow = safe_f(row.get("Flow"))
            nox  = safe_f(row.get("NOX"))
            sox  = safe_f(row.get("SOX"))
            tsp  = safe_f(row.get("TSP"))

            
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
        
        state_series = df_analyzed["State"] if not df_analyzed.empty and "State" in df_analyzed.columns else pd.Series([], dtype=str)
        op_df = df_analyzed[state_series == "OPERATING"] if not df_analyzed.empty else pd.DataFrame()
        maint_df = df_analyzed[state_series == "MAINTENANCE"] if not df_analyzed.empty else pd.DataFrame()
        stop_df = df_analyzed[state_series == "STOP"] if not df_analyzed.empty else pd.DataFrame()
        
        time_unit = 0.5 if len(df_analyzed) <= 48 else (1.0 / 12.0)
        op_hours = round(len(op_df) * time_unit, 1)
        stop_hours = round(len(stop_df) * time_unit, 1)
        
        if len(maint_df) > 0 and len(maint_df) >= len(op_df):
            status_summary = "점검 중"
        elif len(stop_df) > len(op_df):
            status_summary = "가동정지"
        else:
            status_summary = "정상 운전 중"
        
        # 운전 중 평균만 필터링 산출
        averages = {}
        for factor in config.FACTORS:
            if not op_df.empty and factor in op_df.columns:
                num_series = pd.to_numeric(op_df[factor], errors="coerce").dropna()
                if not num_series.empty:
                    averages[factor] = round(float(num_series.mean()), 2)
                else:
                    averages[factor] = 0.00
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
            "alarm_summary": alarm_text,
            "alarms": [a.to_dict() if hasattr(a, "to_dict") else a for a in alarms]
        }

        return report_data

    def validate_5m_against_30m(self, df_5m: pd.DataFrame, df_30m: pd.DataFrame, outlet_name: str = "ALL") -> Dict[str, Any]:
        """
        5분 수동 데이터의 30분 평균과 30분 자동 취득 데이터를 대조 검증
        """
        if df_5m is None or df_5m.empty:
            return {
                "status": "MISSING_5M",
                "status_message": "5분 데이터 누락",
                "mismatch_count": 0,
                "validation_logs": ["5분 수동데이터가 업로드되지 않았거나 누락되었습니다."]
            }
        
        if df_30m is None or df_30m.empty:
            return {
                "status": "MISSING_30M",
                "status_message": "30분 데이터 누락",
                "mismatch_count": 0,
                "validation_logs": ["구글 시트 30분 자동 취득 데이터가 수집되지 않았거나 누락되었습니다."]
            }

        # 5분 데이터 30분 단위 평균 리샘플링
        def get_30m_slot(ts_str):
            s = str(ts_str).strip()
            if len(s) < 16:
                return s
            dt_part = s[:14] # 'YYYY-MM-DD HH:'
            try:
                m = int(s[14:16])
                slot = "00" if m < 30 else "30"
                return f"{dt_part}{slot}"
            except Exception:
                return s[:16]

        df_5m_copy = df_5m.copy()
        if outlet_name != "ALL":
            df_5m_copy = df_5m_copy[df_5m_copy["outlet"] == outlet_name]
            df_30m_copy = df_30m[df_30m["outlet"] == outlet_name].copy() if not df_30m.empty else pd.DataFrame()
        else:
            df_30m_copy = df_30m.copy() if not df_30m.empty else pd.DataFrame()

        if df_5m_copy.empty:
            return {
                "status": "MISSING_5M",
                "status_message": f"{outlet_name} 5분 데이터 누락",
                "mismatch_count": 0,
                "validation_logs": [f"{outlet_name}의 5분 수동 데이터가 없습니다."]
            }

        if df_30m_copy.empty:
            return {
                "status": "MISSING_30M",
                "status_message": f"{outlet_name} 30분 데이터 누락",
                "mismatch_count": 0,
                "validation_logs": [f"{outlet_name}의 30분 자동 수집 데이터가 없습니다."]
            }

        df_5m_copy["slot"] = df_5m_copy["timestamp"].apply(get_30m_slot)
        
        # 슬롯 & 배출구별 5분 데이터 평균 계산
        grouped_5m = {}
        for (slot, out), g in df_5m_copy.groupby(["slot", "outlet"]):
            key = f"{slot}_{out}"
            grouped_5m[key] = {
                "TSP": pd.to_numeric(g["TSP"], errors="coerce").dropna().mean(),
                "NOX": pd.to_numeric(g["NOX"], errors="coerce").dropna().mean(),
                "SOX": pd.to_numeric(g["SOX"], errors="coerce").dropna().mean(),
            }

        df_30m_copy["slot"] = df_30m_copy["timestamp"].apply(get_30m_slot)
        
        mismatches = []
        logs = []
        compared_count = 0

        for idx, row in df_30m_copy.iterrows():
            slot = str(row["slot"])
            out = str(row.get("outlet", ""))
            key = f"{slot}_{out}"
            
            if key not in grouped_5m:
                logs.append(f"[{slot} {out}] 5분 데이터 미수신으로 대조 불가")
                continue

            m_5m = grouped_5m[key]
            compared_count += 1
            
            # TSP, NOX, SOX 1:1 수치 대조 (허용 오차 0.05 이내)
            for factor in ["TSP", "NOX", "SOX"]:
                v_30m = pd.to_numeric(row.get(factor), errors="coerce")
                v_5m_avg = m_5m.get(factor)
                
                if pd.notna(v_30m) and pd.notna(v_5m_avg):
                    diff = abs(v_30m - v_5m_avg)
                    if diff > 0.05:
                        msg = f"[{slot} {out} {factor}] 5분평균({v_5m_avg:.2f}) vs 30분실측({v_30m:.2f}) 불일치 (차이: {diff:.2f})"
                        mismatches.append(msg)
                        logs.append(msg)

        if compared_count == 0:
            return {
                "status": "MISSING_5M",
                "status_message": "5분 데이터 누락",
                "mismatch_count": 0,
                "validation_logs": ["동일 타임스탬프 슬롯의 5분/30분 데이터가 존재하지 않아 비교가 불가능합니다."]
            }

        if len(mismatches) == 0:
            return {
                "status": "MATCH",
                "status_message": "일치 검증 완료",
                "mismatch_count": 0,
                "validation_logs": [f"총 {compared_count}개 30분 슬롯 대조 결과 100% 일치 검증 완료"]
            }
        else:
            return {
                "status": "MISMATCH",
                "status_message": f"불일치 {len(mismatches)}건",
                "mismatch_count": len(mismatches),
                "validation_logs": logs
            }
