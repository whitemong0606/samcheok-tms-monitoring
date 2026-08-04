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
        사용자 설정 템플릿 치환
        """
        if not template_str:
            settings = storage.get_settings()
            template_str = settings.get("template") or config.DEFAULT_TEMPLATE

        # 템플릿 태그 안전 치환
        formatted_text = template_str
        replacements = {
            "{date}": str(report_data.get("date", "")),
            "{outlet}": str(report_data.get("outlet", "")),
            "{status}": str(report_data.get("status", "")),
            "{operating_hours}": str(report_data.get("operating_hours", "0")),
            "{stop_hours}": str(report_data.get("stop_hours", "0")),
            "{avg_tsp}": str(report_data.get("avg_tsp", "0.0")),
            "{avg_nox}": str(report_data.get("avg_nox", "0.0")),
            "{avg_sox}": str(report_data.get("avg_sox", "0.0")),
            "{avg_o2}": str(report_data.get("avg_o2", "0.0")),
            "{avg_flow}": str(report_data.get("avg_flow", "0")),
            "{avg_temp}": str(report_data.get("avg_temp", "0")),
            "{alarm_count}": str(report_data.get("alarm_count", "0")),
            "{alarms}": str(report_data.get("alarms", ""))
        }

        for key, val in replacements.items():
            formatted_text = formatted_text.replace(key, val)

        return formatted_text

telegram_bot = TelegramBot()
