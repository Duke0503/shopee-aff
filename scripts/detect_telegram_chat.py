"""Helper script to detect Telegram Chat ID for @hoantien_dp_alert_bot.
Usage: uv run python scripts/detect_telegram_chat.py
"""
import json
import urllib.request
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

BOT_TOKEN = "8746069794:AAHIT_a389S0n-ybyll2NilA1UseCYO9Ddg"

def check_updates():
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
    req = urllib.request.Request(url, headers={"User-Agent": "HoanTienDPAlertBot/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        print(f"Error calling Telegram API: {e}")
        return []

    if not data.get("ok"):
        print(f"Telegram API error: {data}")
        return []

    updates = data.get("result", [])
    found_chats = {}
    for up in updates:
        chat = None
        user = None
        text = None
        if "message" in up:
            msg = up["message"]
            chat = msg.get("chat")
            user = msg.get("from")
            text = msg.get("text")
        elif "my_chat_member" in up:
            chat = up["my_chat_member"].get("chat")
            user = up["my_chat_member"].get("from")
        elif "channel_post" in up:
            chat = up["channel_post"].get("chat")
            text = up["channel_post"].get("text")

        if chat and "id" in chat:
            cid = chat["id"]
            if cid not in found_chats:
                found_chats[cid] = {
                    "id": cid,
                    "title": chat.get("title") or chat.get("username") or f"{chat.get('first_name', '')} {chat.get('last_name', '')}".strip(),
                    "type": chat.get("type"),
                    "last_text": text,
                    "from_user": user.get("username") or user.get("first_name") if user else None
                }
    return list(found_chats.values())

if __name__ == "__main__":
    chats = check_updates()
    if not chats:
        print("Chưa có tin nhắn hoặc cập nhật mới nào.")
        print("Vui lòng thêm bot @hoantien_dp_alert_bot vào nhóm Telegram và gửi một tin nhắn (ví dụ: ping).")
    else:
        print(f"Tìm thấy {len(chats)} cuộc trò chuyện:")
        for c in chats:
            print(f"- Type: {c['type']} | Title: {c['title']} | ID: {c['id']} | Last text: {c['last_text']}")
