import requests
from typing import Dict, Any, Optional
from core.google_sheets import storage
from core.config import config

class TelegramBot:
    def __init__(self):
        pass

    def send_message(self, text: str, bot_token: Optional[str] = None, chat_id: Optional[str] = None) -> Dict[str, Any]:
        """
        텔레그램 메세지 전송
        """
        settings = storage.get_settings()
        token = bot_token or settings.get("bot_token") or config.TELEGRAM_BOT_TOKEN
        cid = chat_id or settings.get("chat_id") or config.TELEGRAM_CHAT_ID

        if not token or not cid:
            log_msg = f"[Telegram Notification (Simulation Mode)] Token/Chat ID 미설정으로 가상 발송 처리: {text[:60]}..."
            try:
                print(log_msg)
            except Exception:
                print(log_msg.encode('ascii', errors='ignore').decode('ascii'))
            storage.add_log("INFO", "SIMULATION_SEND", text, status="MOCK_SUCCESS")
            return {
                "success": True,
                "is_mock": True,
                "message": "텔레그램 Token/Chat ID가 설정되지 않아 가상 발송으로 성공 처리되었습니다."
            }

        if len(text) > 4000:
            text = text[:3900] + "\n\n... (메시지 길이 제한으로 이하 내용 생략)"

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": cid,
            "text": text,
            "parse_mode": "HTML"
        }

        try:
            response = requests.post(url, json=payload, timeout=10)
            res_json = response.json()

            if response.status_code == 200 and res_json.get("ok"):
                storage.add_log("INFO", "TELEGRAM_SEND", text, status="SUCCESS")
                return {"success": True, "is_mock": False, "result": res_json}
            else:
                err_msg = res_json.get("description", "텔레그램 API 전송 오류")
                storage.add_log("ERROR", "TELEGRAM_SEND_FAIL", f"{err_msg} | 내용: {text[:40]}", status="FAILED")
                return {"success": False, "is_mock": False, "error": err_msg}
        except Exception as e:
            err_str = str(e)
            storage.add_log("ERROR", "TELEGRAM_EXCEPTION", f"네트워크 통신 에러: {err_str}", status="FAILED")
            return {"success": False, "is_mock": False, "error": err_str}

    def render_template(self, report_data: Dict[str, Any], template_str: Optional[str] = None) -> str:
        """
        사용자 설정 템플릿 치환 (배출구별 종합 리포트 및 단일 배출구 리포트 완벽 지원)
        """
        if not template_str:
            settings = storage.get_settings()
            template_str = settings.get("template") or config.DEFAULT_TEMPLATE

        date_str = str(report_data.get("date", ""))
        reports_map = report_data.get("reports", {})
        all_outlets = config.OUTLETS

        # 1. 배출구별 설비 운전 상태 ({outlets_status})
        if reports_map and isinstance(reports_map, dict):
            status_lines = []
            for out in all_outlets:
                r = reports_map.get(out, {})
                st = r.get("status", "⚪ 데이터 없음")
                op_h = r.get("operating_hours", 0.0)
                st_h = r.get("stop_hours", 0.0)
                icon = "🟢" if "운전" in str(st) else ("🔴" if "정지" in str(st) else "⚪")
                status_lines.append(f"• <b>{out}:</b> {icon} {st} (운전 {op_h}h / 정지 {st_h}h)")
            outlets_status_text = "\n".join(status_lines)
        else:
            st = report_data.get("status", "정상 운전 중")
            op_h = report_data.get("operating_hours", "24.0")
            st_h = report_data.get("stop_hours", "0.0")
            out_nm = report_data.get("outlet", "배출구 1")
            icon = "🟢" if "운전" in str(st) else ("🔴" if "정지" in str(st) else "⚪")
            outlets_status_text = f"• <b>{out_nm}:</b> {icon} {st} (운전 {op_h}h / 정지 {st_h}h)"

        # 2. 배출구별 운전 중 평균 수치 ({outlets_averages})
        if reports_map and isinstance(reports_map, dict):
            avg_lines = []
            for out in all_outlets:
                r = reports_map.get(out, {})
                if r and r.get("status") not in ["⚪ 데이터 없음", "NO_DATA", None] and float(r.get("operating_hours", 0.0)) > 0:
                    tsp = float(r.get("avg_tsp", 0.0))
                    nox = float(r.get("avg_nox", 0.0))
                    sox = float(r.get("avg_sox", 0.0))
                    o2 = float(r.get("avg_o2", 0.0))
                    flow = float(r.get("avg_flow", 0.0))
                    temp = float(r.get("avg_temp", 0.0))
                    avg_lines.append(f"• <b>[{out}]</b> TSP {tsp:.2f}mg | NOX {nox:.2f}ppm | SOX {sox:.2f}ppm | 유량 {flow:,.0f}m³/h | O2 {o2:.1f}% | 온도 {temp:.1f}°C")
                elif r and "정지" in str(r.get("status", "")):
                    avg_lines.append(f"• <b>[{out}]</b> 🔴 가동정지 (운전 데이터 없음)")
                else:
                    avg_lines.append(f"• <b>[{out}]</b> ⚪ 데이터 미수집")
            outlets_averages_text = "\n".join(avg_lines)
        else:
            tsp = report_data.get("avg_tsp", 0.0)
            nox = report_data.get("avg_nox", 0.0)
            sox = report_data.get("avg_sox", 0.0)
            o2 = report_data.get("avg_o2", 0.0)
            flow = report_data.get("avg_flow", 0.0)
            temp = report_data.get("avg_temp", 0.0)
            out_nm = report_data.get("outlet", "배출구 1")
            outlets_averages_text = f"• <b>[{out_nm}]</b> TSP {tsp}mg | NOX {nox}ppm | SOX {sox}ppm | 유량 {flow}m³/h | O2 {o2}% | 온도 {temp}°C"

        # 3. 배출구별 이상 신호 감지 내역 ({alarms})
        if reports_map and isinstance(reports_map, dict):
            alarm_groups = []
            total_alarm_count = 0
            for out in all_outlets:
                r = reports_map.get(out, {})
                out_alarms = r.get("alarms", [])
                total_alarm_count += len(out_alarms)
                if out_alarms:
                    alarm_groups.append(f"<b>[{out}]</b>")
                    for a in out_alarms[:3]:
                        msg = a.get("message") if isinstance(a, dict) else str(a)
                        ts = a.get("timestamp", "") if isinstance(a, dict) else ""
                        ts_part = f"[{str(ts)[-8:]}] " if ts else ""
                        alarm_groups.append(f"  • {ts_part}{msg}")
                    if len(out_alarms) > 3:
                        alarm_groups.append(f"  • ... 외 {len(out_alarms) - 3}건")
            if alarm_groups:
                alarms_text = "\n".join(alarm_groups)
            else:
                alarms_text = "• 전 배출구 특이사항 없음 (모든 인자 정상 범위)"
            alarm_count_val = total_alarm_count
        else:
            alarm_summary = report_data.get("alarm_summary")
            if not alarm_summary:
                raw_alarms = report_data.get("alarms", [])
                if isinstance(raw_alarms, list) and raw_alarms:
                    max_show = 5
                    msgs = [f"• {a.get('factor', '')}: {a.get('message', '')}" if isinstance(a, dict) else f"• {a}" for a in raw_alarms[:max_show]]
                    if len(raw_alarms) > max_show:
                        msgs.append(f"• ... 외 {len(raw_alarms) - max_show}건 추가 감지")
                    alarms_text = "\n".join(msgs)
                else:
                    alarms_text = "• 특이사항 없음 (모든 인자 정상 범위)"
            else:
                alarms_text = str(alarm_summary)
            alarm_count_val = report_data.get("alarm_count", 0)

        # 4. 치환 테이블 구성
        replacements = {
            "{date}": date_str,
            "{outlets_status}": outlets_status_text,
            "{outlets_averages}": outlets_averages_text,
            "{alarms}": alarms_text,
            "{alarm_count}": str(alarm_count_val),
            # 레거시 단일 태그 호환
            "{outlet}": str(report_data.get("outlet", "전체 배출구")),
            "{status}": str(report_data.get("status", "정상 운전 중")),
            "{operating_hours}": str(report_data.get("operating_hours", "24.0")),
            "{stop_hours}": str(report_data.get("stop_hours", "0.0")),
            "{avg_tsp}": str(report_data.get("avg_tsp", "0.0")),
            "{avg_nox}": str(report_data.get("avg_nox", "0.0")),
            "{avg_sox}": str(report_data.get("avg_sox", "0.0")),
            "{avg_o2}": str(report_data.get("avg_o2", "0.0")),
            "{avg_flow}": str(report_data.get("avg_flow", "0")),
            "{avg_temp}": str(report_data.get("avg_temp", "0"))
        }

        formatted_text = template_str
        for key, val in replacements.items():
            formatted_text = formatted_text.replace(key, val)

        return formatted_text

telegram_bot = TelegramBot()
