"""Promotions: a fixed number of bonus slots for the earliest orders.

The first campaign (mid-autumn 2026) promised 20,000 VND on top of the
normal cashback to the first 20 customers whose order is recorded inside
the event window. Everything here is data-driven so the next event is a
new row, not new code.

Rules, in the order they bite:

  - A slot goes to the order RECORDED first (the moment Shopee or
    AccessTrade reported it to us). A slot belongs to an ORDER: one
    customer may hold several unless the campaign caps it (per_customer,
    0 = no cap; the 2026 mid-autumn event had none). Rank is fixed once
    given: a slot is lost only when its own order is cancelled.
  - A slot freed WHILE the event runs goes to the next order in line.
    One freed after the end stays empty: the cancelled order earns
    nothing and nobody else is promised its place.
  - A slot is only a promise until the order is approved. The bonus is
    paid with that order's cashback -- never before, because an order can
    still be cancelled, and paying on "recorded" invites buy-and-cancel.
  - Staff, the house account, and anyone listed as excluded never hold a
    slot.

Award states: held -> confirmed (order approved) -> paid (order paid), or
void (order rejected). A void award frees the slot.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from . import repository as ledger

HELD, CONFIRMED, PAID, VOID = "held", "confirmed", "paid", "void"
LIVE = (HELD, CONFIRMED, PAID)


@dataclass(frozen=True)
class Standing:
    campaign_id: str
    name: str
    rank: int
    slots: int
    amount: int
    status: str


def create(conn: sqlite3.Connection, campaign_id: str, name: str,
           starts_at: str, ends_at: str, slots: int, bonus_vnd: int,
           min_order_value: int = 0,
           platforms: str = "shopee,shopeefood,tiktok",
           excluded_customers: str = "", per_customer: int = 0) -> None:
    conn.execute(
        "INSERT INTO campaigns (campaign_id, name, starts_at, ends_at, slots,"
        " bonus_vnd, min_order_value, platforms, excluded_customers,"
        " per_customer, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?)",
        (campaign_id, name, starts_at, ends_at, slots, bonus_vnd,
         min_order_value, platforms, excluded_customers, per_customer, ledger.now()))


def _held_by(conn: sqlite3.Connection, campaign_id: str) -> dict[str, int]:
    """Live slots per customer in one campaign."""
    return {r[0]: r[1] for r in conn.execute(
        "SELECT customer_id, COUNT(*) FROM campaign_awards"
        " WHERE campaign_id=? AND status != ? GROUP BY customer_id",
        (campaign_id, VOID))}


def _at_cap(campaign: sqlite3.Row, held: int) -> bool:
    cap = campaign["per_customer"] or 0
    return cap > 0 and held >= cap


def active(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM campaigns WHERE status='active' ORDER BY starts_at").fetchall()


def _in_window(campaign: sqlite3.Row, moment: str | None) -> bool:
    key = ledger._created_sort_key
    return key(campaign["starts_at"]) <= key(moment) < key(campaign["ends_at"])


def _now() -> str:
    return ledger.now()


def evaluate(conn: sqlite3.Connection, now: str | None = None) -> dict:
    """Bring every active campaign's slots up to date. Safe to run often."""
    changes = {"voided": 0, "confirmed": 0, "paid": 0, "held": 0}
    now = now or _now()
    for campaign in active(conn):
        cid = campaign["campaign_id"]

        # Follow each live slot's order.
        for award in conn.execute(
            "SELECT a.id, a.status, o.status AS order_status, o.paid_at"
            "  FROM campaign_awards a JOIN orders o ON o.order_id = a.order_id"
            " WHERE a.campaign_id=? AND a.status IN (?, ?)", (cid, HELD, CONFIRMED)).fetchall():
            if award["order_status"] == ledger.REJECTED:
                conn.execute("UPDATE campaign_awards SET status=?, voided_at=? WHERE id=?",
                             (VOID, now, award["id"]))
                changes["voided"] += 1
            elif award["paid_at"]:
                conn.execute("UPDATE campaign_awards SET status=?, paid_at=?,"
                             " confirmed_at=COALESCE(confirmed_at, ?) WHERE id=?",
                             (PAID, award["paid_at"], now, award["id"]))
                changes["paid"] += 1
            elif award["status"] == HELD and award["order_status"] == ledger.APPROVED:
                conn.execute("UPDATE campaign_awards SET status=?, confirmed_at=? WHERE id=?",
                             (CONFIRMED, now, award["id"]))
                changes["confirmed"] += 1

        # Fill free slots with the next eligible orders, earliest first --
        # but only while the event runs. A slot freed by a cancellation after
        # the end stays empty: the event is over, nobody else is promised it.
        if not _in_window(campaign, now):
            continue
        live = conn.execute(
            "SELECT COUNT(*) FROM campaign_awards WHERE campaign_id=? AND status != ?",
            (cid, VOID)).fetchone()[0]
        free = campaign["slots"] - live
        if free <= 0:
            continue
        for order in _candidates(conn, campaign)[:free]:
            conn.execute(
                "INSERT INTO campaign_awards (campaign_id, customer_id, order_id,"
                " amount, status, created_at) VALUES (?,?,?,?,?,?)",
                (cid, order["customer_id"], order["order_id"], campaign["bonus_vnd"],
                 HELD, now))
            changes["held"] += 1
    return changes


def _candidates(conn: sqlite3.Connection, campaign: sqlite3.Row) -> list[sqlite3.Row]:
    """Eligible orders not yet holding a slot, earliest first, within the
    per-customer cap if the campaign has one."""
    platforms = [p.strip() for p in campaign["platforms"].split(",") if p.strip()]
    excluded = {c.strip() for c in campaign["excluded_customers"].split(",") if c.strip()}
    rows = conn.execute(
        "SELECT o.order_id, o.customer_id, o.recorded_at, o.order_value, o.platform"
        "  FROM orders o JOIN customers c ON c.customer_id = o.customer_id"
        " WHERE o.status != ? AND COALESCE(c.role, 'user') = 'user'"
        "   AND o.order_id NOT IN (SELECT order_id FROM campaign_awards"
        "                           WHERE campaign_id=? AND status != ?)",
        (ledger.REJECTED, campaign["campaign_id"], VOID)).fetchall()
    eligible = [
        r for r in rows
        if _in_window(campaign, r["recorded_at"])
        and (r["platform"] or "shopee") in platforms
        and r["customer_id"] not in excluded
        and (r["order_value"] or 0) >= campaign["min_order_value"]
    ]
    eligible.sort(key=lambda r: (ledger._created_sort_key(r["recorded_at"]), r["order_id"]))
    held = _held_by(conn, campaign["campaign_id"])
    chosen = []
    for r in eligible:
        if not _at_cap(campaign, held.get(r["customer_id"], 0)):
            held[r["customer_id"]] = held.get(r["customer_id"], 0) + 1
            chosen.append(r)
    return chosen


def standing_for_order(conn: sqlite3.Connection, order_id: str) -> Standing | None:
    """The live slot this order holds, with its rank, or None."""
    award = conn.execute(
        "SELECT a.*, c.name, c.slots FROM campaign_awards a"
        "  JOIN campaigns c ON c.campaign_id = a.campaign_id"
        " WHERE a.order_id=? AND a.status != ? ORDER BY a.id LIMIT 1",
        (order_id, VOID)).fetchone()
    if award is None:
        return None
    return Standing(award["campaign_id"], award["name"],
                    _rank(conn, award["campaign_id"], award["id"]),
                    award["slots"], award["amount"], award["status"])


def _rank(conn: sqlite3.Connection, campaign_id: str, award_id: int) -> int:
    """Position among live slots by when their order was recorded."""
    live = conn.execute(
        "SELECT a.id, o.recorded_at FROM campaign_awards a"
        "  JOIN orders o ON o.order_id = a.order_id"
        " WHERE a.campaign_id=? AND a.status != ?", (campaign_id, VOID)).fetchall()
    live.sort(key=lambda r: (ledger._created_sort_key(r["recorded_at"]), r["id"]))
    return next(i for i, r in enumerate(live, start=1) if r["id"] == award_id)


def missed_for_order(conn: sqlite3.Connection, order_id: str) -> sqlite3.Row | None:
    """An active campaign this order fell inside the window of but missed
    because every slot was already taken -- so the customer is told why."""
    order = conn.execute("SELECT * FROM orders WHERE order_id=?", (order_id,)).fetchone()
    # A cancelled order did not miss anything: its own status says why it
    # earns nothing, including when it had held a slot and lost it.
    if order is None or order["status"] == ledger.REJECTED:
        return None
    for campaign in active(conn):
        if not _in_window(campaign, order["recorded_at"]):
            continue
        # At the cap the order missed because of the cap, not the queue.
        if _at_cap(campaign, _held_by(conn, campaign["campaign_id"]).get(order["customer_id"], 0)):
            continue
        live = conn.execute("SELECT COUNT(*) FROM campaign_awards WHERE campaign_id=?"
                            " AND status != ?", (campaign["campaign_id"], VOID)).fetchone()[0]
        if live >= campaign["slots"]:
            return campaign
    return None


def bonus_owed(conn: sqlite3.Connection, order_ids: list[str]) -> int:
    """Confirmed, unpaid bonus riding on these orders."""
    if not order_ids:
        return 0
    marks = ",".join("?" * len(order_ids))
    return conn.execute(
        f"SELECT COALESCE(SUM(amount), 0) FROM campaign_awards"
        f" WHERE status=? AND order_id IN ({marks})", (CONFIRMED, *order_ids)).fetchone()[0]


def settle(conn: sqlite3.Connection, order_id: str) -> None:
    """The order was paid: its confirmed bonus went with it."""
    conn.execute("UPDATE campaign_awards SET status=?, paid_at=? WHERE order_id=? AND status=?",
                 (PAID, ledger.now(), order_id, CONFIRMED))


def offer_for(conn: sqlite3.Connection, customer_id: str, platform: str,
              now: str | None = None) -> dict | None:
    """What a customer asking for a link on this platform could still win.

    None when there is nothing honest to say: no event running, every slot
    taken, the platform not included, or this customer cannot win (staff,
    the house account, excluded, or already at the per-customer cap).
    """
    now = now or _now()
    customer = conn.execute("SELECT role FROM customers WHERE customer_id=?",
                            (customer_id,)).fetchone()
    if customer is None or (customer["role"] or "user") != "user":
        return None
    for campaign in active(conn):
        if not _in_window(campaign, now):
            continue
        platforms = [p.strip() for p in campaign["platforms"].split(",") if p.strip()]
        excluded = {c.strip() for c in campaign["excluded_customers"].split(",") if c.strip()}
        if platform not in platforms or customer_id in excluded:
            continue
        cid = campaign["campaign_id"]
        if _at_cap(campaign, _held_by(conn, cid).get(customer_id, 0)):
            continue
        live = conn.execute("SELECT COUNT(*) FROM campaign_awards WHERE campaign_id=?"
                            " AND status != ?", (cid, VOID)).fetchone()[0]
        left = campaign["slots"] - live
        if left <= 0:
            continue
        return {"name": campaign["name"], "bonus": campaign["bonus_vnd"],
                "slots": campaign["slots"], "left": left,
                "min_order_value": campaign["min_order_value"],
                "per_customer": campaign["per_customer"] or 0}
    return None
