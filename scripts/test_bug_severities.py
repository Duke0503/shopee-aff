import time
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from cashback.core import telegram_alerts as t

print("Gửi test CRITICAL...")
t.report_bug(
    title="Mất kết nối Database Turso Cloud",
    details="Truy vấn thất bại: connection reset by peer (AWS Tokyo region timeout)",
    severity="CRITICAL",
    source="ledger.repository",
    error_trace="File 'src/cashback/ledger/repository.py', line 120, in connect\n  libsql_client.create_client(...)",
    action_needed="Kiểm tra token Turso Cloud hoặc kết nối mạng tới AWS Tokyo.",
    force=True,
)

time.sleep(1)

print("Gửi test HIGH...")
t.report_bug(
    title="AccessTrade API Timeout (TikTok Shop)",
    details="Không thể kéo báo cáo chuyển đổi TikTok Shop sau 3 lần thử (HTTP 504 Gateway Timeout).",
    severity="HIGH",
    source="providers.accesstrade_reconciler",
    error_trace="File 'src/cashback/providers/accesstrade_reconciler.py', line 140, in fetch_orders\n  httpx.get(url, timeout=15)",
    action_needed="Kiểm tra tình trạng máy chủ API của đối tác AccessTrade.",
    force=True,
)

time.sleep(1)

print("Gửi test WARNING...")
t.report_bug(
    title="Hàng đợi link Shopee tăng cao (Backlog > 15)",
    details="Hàng đợi đang có 18 link chờ xử lý. Tốc độ chuyển đổi có thể chậm hơn 1-2 phút so với bình thường.",
    severity="WARNING",
    source="worker.batch_queue",
    action_needed="Theo dõi nếu hàng đợi tiếp tục tăng trên 30 link.",
    force=True,
)

time.sleep(3)
print("Hoàn tất gửi 3 mức độ cảnh báo!")
