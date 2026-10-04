"""/donhang: every order a customer has ever had, as Zalo messages."""

from __future__ import annotations

import json
import urllib.request

import pytest

from cashback.ledger import repository as ledger
from cashback.messaging import notifications
from cashback.web import dashboard

MEMBER = "6823332485297437912"


def _order(conn, order_id, status, commission=10_000, recorded="2026-09-20T10:00:00+07:00"):
    ledger.add_order(conn, order_id, MEMBER, None, order_value=100_000,
                     estimated_commission=commission)
    conn.execute("UPDATE orders SET recorded_at=? WHERE order_id=?", (recorded, order_id))
    if status in (ledger.APPROVED, ledger.PAID):
        ledger.mark_approved(conn, order_id, commission, 7_000)
    if status == ledger.PAID:
        ledger.mark_paid(conn, order_id, "")
    if status == ledger.REJECTED:
        ledger.mark_rejected(conn, order_id, "huy don")


@pytest.fixture
def member(conn):
    ledger.add_customer(conn, MEMBER, zalo_user_id=MEMBER)
    return conn


def test_no_orders_says_how_to_start(member):
    [text] = notifications.order_history(member, MEMBER, 0.8)
    assert "chưa có đơn hàng nào" in text
    assert "https://hoantiendp.com/orders" in text


def test_every_order_is_listed_newest_first(member):
    _order(member, "OLD", ledger.PAID, recorded="2026-09-01T10:00:00+07:00")
    _order(member, "MID", ledger.APPROVED, recorded="2026-09-10T10:00:00+07:00")
    _order(member, "NEW", ledger.AWAITING_APPROVAL, recorded="2026-09-20T10:00:00+07:00")
    _order(member, "BAD", ledger.REJECTED, recorded="2026-09-05T10:00:00+07:00")
    text = "\n".join(notifications.order_history(member, MEMBER, 0.8))
    positions = [text.index(o) for o in ("NEW", "MID", "BAD", "OLD")]
    assert positions == sorted(positions)
    assert "Danh sách 4 đơn hàng gần nhất:" in text
    assert "DP00001" not in text
    assert "https://hoantiendp.com/orders" in text


def test_today_orders_format(member):
    now_vn = notifications.datetime.now(notifications.timezone.utc).astimezone(ledger.VN_TZ)
    today_iso = now_vn.isoformat()
    _order(member, "TODAY1", ledger.AWAITING_APPROVAL, commission=20_000, recorded=today_iso)
    _order(member, "TODAY2", ledger.APPROVED, commission=10_000, recorded=today_iso)
    text = "\n".join(notifications.order_history(member, MEMBER, 0.8))
    assert "📦 Đơn hàng ngày " in text
    assert "1. TODAY" in text
    assert "💰 Tổng hoa hồng:" in text
    assert "🔗 Xem chi tiết tất cả đơn hàng tại: https://hoantiendp.com/orders" in text


def test_a_long_history_is_split_and_nothing_is_lost(member):
    now_vn = notifications.datetime.now(notifications.timezone.utc).astimezone(ledger.VN_TZ)
    ids = [f"ORDER{n:03d}" for n in range(100)]
    for n, oid in enumerate(ids):
        # Place 100 orders today with varying seconds/minutes
        _order(member, oid, ledger.AWAITING_APPROVAL,
               recorded=now_vn.replace(hour=(n // 60) % 24, minute=n % 60, second=n % 60).isoformat())
    parts = notifications.order_history(member, MEMBER, 0.8)
    assert len(parts) > 1
    assert all(len(p) <= notifications.MESSAGE_LIMIT for p in parts)
    joined = "\n".join(parts)
    assert all(oid in joined for oid in ids)


def test_the_assistant_gets_the_messages(db):
    with ledger.connect(db) as conn:
        ledger.add_customer(conn, MEMBER, zalo_user_id=MEMBER)
        _order(conn, "O1", ledger.AWAITING_APPROVAL)
    from cashback.core.config import load
    cfg = load()
    object.__setattr__(cfg, "db_path", db)
    srv = dashboard.serve_in_background(cfg, port=0)
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{srv.server_address[1]}/api/bot/customer-auth",
            data=json.dumps({"uid": MEMBER, "action": "get_orders"}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=10) as response:
            body = json.loads(response.read())
    finally:
        srv.shutdown()
        srv.server_close()
    assert body["ok"] and "O1" in "".join(body["parts"])
