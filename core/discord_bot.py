import requests
import re
from typing import Dict, Any, Optional
from core.google_sheets import storage
from core.config import config

class DiscordBot:
    def __init__(self):
        pass

    def html_to_markdown(self, html_text: str) -> str:
        """
        HTML 태그를 디스코드 마크다운으로 변환
        """
        text = html_text
        text = re.sub(r'<b>(.*?)</b>', r'**\1**', text, flags=re.DOTALL)
        text = re.sub(r'<strong>(.*?)</strong>', r'**\1**', text, flags=re.DOTALL)
        text = re.sub(r'<i>(.*?)</i>', r'*\1*', text, flags=re.DOTALL)
        text = re.sub(r'<em>(.*?)</em>', r'*\1*', text, flags=re.DOTALL)
        text = re.sub(r'<code>(.*?)</code>', r'`\1`', text, flags=re.DOTALL)
        text = re.sub(r'<[^>]+>', '', text)
        return text

    def send_message(self, text: str, webhook_url: Optional[str] = None) -> Dict[str, Any]:
        """
        디스코드 웹후크를 통한 채널/그룹 알림 전송
        """
        settings = storage.get_settings()
        url = webhook_url or settings.get("discord_webhook_url") or getattr(config, "DISCORD_WEBHOOK_URL", "")

        if not url:
            return {
                "success": True,
                "is_mock": True,
                "message": "Discord Webhook URL이 설정되지 않아 가상 발송 처리되었습니다."
            }

        discord_text = self.html_to_markdown(text)
        if len(discord_text) > 1950:
            discord_text = discord_text[:1850] + "\n\n... (메시지 길이 제한으로 이하 생략)"

        payload = {
            "content": discord_text,
            "username": "삼척빛드림본부 TMS 봇",
            "avatar_url": "https://cdn-icons-png.flaticon.com/512/3252/3252919.png"
        }

        try:
            res = requests.post(url, json=payload, timeout=10)
            if res.status_code in [200, 204]:
                storage.add_log("INFO", "DISCORD_SEND", text, status="SUCCESS")
                return {"success": True, "is_mock": False, "status_code": res.status_code}
            else:
                err_msg = f"디스코드 API 오류 ({res.status_code}): {res.text}"
                storage.add_log("ERROR", "DISCORD_SEND_FAIL", err_msg[:80], status="FAILED")
                return {"success": False, "is_mock": False, "error": err_msg}
        except Exception as e:
            err_str = str(e)
            storage.add_log("ERROR", "DISCORD_EXCEPTION", f"통신 에러: {err_str}", status="FAILED")
            return {"success": False, "is_mock": False, "error": err_str}

discord_bot = DiscordBot()