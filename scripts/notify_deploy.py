"""Script to send deployment success notification to Telegram with rich formatting."""

import os
from datetime import datetime
from src.cashback.core import telegram_alerts

def main() -> None:
    commit_sha = (os.getenv("SHA") or "latest")[:7]
    commit_msg = (os.getenv("COMMIT_MSG") or "Deploy tự động").split("\n")[0]
    actor = os.getenv("ACTOR") or "Git User"
    time_str = datetime.now().strftime("%H:%M:%S %d/%m/%Y")

    msg = (
        f"🚀 <b>[CI/CD DEPLOY THÀNH CÔNG]</b>\n\n"
        f"📦 <b>Nhánh:</b> <code>main</code>\n"
        f"📝 <b>Commit:</b> <code>{commit_sha}</code> - {commit_msg}\n"
        f"👤 <b>Tác giả:</b> {actor}\n"
        f"⏱ <b>Thời gian:</b> <code>{time_str}</code>\n\n"
        f"✅ <i>Mã nguồn trên VPS đã được tự động cập nhật và nạp lại dịch vụ mới nhất!</i>"
    )

    telegram_alerts.send_telegram_message(msg)

if __name__ == "__main__":
    main()
