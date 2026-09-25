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
    assert text == notifications.messages.render("orders_empty")


def test_every_order_is_listed_newest_first(member):
    _order(member, "OLD", ledger.PAID, recorded="2026-09-01T10:00:00+07:00")
    _order(member, "MID", ledger.APPROVED, recorded="2026-09-10T10:00:00+07:00")
    _order(member, "NEW", ledger.AWAITING_APPROVAL, recorded="2026-09-20T10:00:00+07:00")
    _order(member, "BAD", ledger.REJECTED, recorded="2026-09-05T10:00:00+07:00")
    text = "\n".join(notifications.order_history(member, MEMBER, 0.8))
    positions = [text.index(o) for o in ("NEW", "MID", "BAD", "OLD")]
    assert positions == sorted(positions)
    assert "(4 " in text                       # the header counts them
    assert "DP00001" in text                   # the code to sign in with


def test_a_long_history_is_split_and_nothing_is_lost(member):
    ids = [f"ORDER{n:03d}" for n in range(60)]
    for n, oid in enumerate(ids):
        _order(member, oid, ledger.AWAITING_APPROVAL,
               recorded=f"2026-09-{1 + n % 28:02d}T10:00:{n % 60:02d}+07:00")
    parts = notifications.order_history(member, MEMBER, 0.8)
    assert len(parts) > 1
    assert all(len(p) <= notifications.MESSAGE_LIMIT for p in parts)
    joined = "\n".join(parts)
    # One block per order; "Mã đơn: <id>" appears once in each block.
    assert all(joined.count(f"Mã đơn: {oid}") == 1 for oid in ids)


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
