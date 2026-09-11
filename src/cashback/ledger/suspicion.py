"""Patterns worth a second look before money leaves the account.

None of these prove anything. They are the shapes that, in a cashback
operation, usually mean either abuse or a mistake worth catching before a
payout rather than after:

    shared_bank_account   several customers paid to the same account
    frequent_bank_change  the destination keeps moving
    never_buys            takes links constantly, no order ever lands
    mostly_rejected       orders arrive but Shopee keeps refusing them
    sudden_volume         a quiet account starts requesting in bulk

Every finding names the evidence that produced it, because the operator
has to decide, and a flag with no reasoning behind it either gets obeyed
blindly or ignored entirely. Neither is useful.

Bank accounts are compared by the fingerprint written to the audit trail,
never by their digits: the point is to notice two customers sharing one
account, not to reproduce the account number anywhere it can leak.
"""

from __future__ import annotations

import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ..core import audit

# A single link request is not a pattern; these are the counts at which a
# shape stops being ordinary. They are starting points, not science --
# tune them once a few hundred real orders exist.
MIN_REQUESTS_TO_JUDGE = 8
BANK_CHANGES_BEFORE_FLAG = 3
REJECTION_RATE_BEFORE_FLAG = 0.5
MIN_ORDERS_TO_JUDGE_REJECTIONS = 4
SUDDEN_VOLUME_PER_DAY = 20

HIGH = "high"
MEDIUM = "medium"
LOW = "low"


@dataclass
class Finding:
    customer_id: str
    pattern: str
    severity: str
    summary: str
    evidence: list[str] = field(default_factory=list)


def _customers(conn: sqlite3.Connection) -> dict[str, sqlite3.Row]:
    return {
        row["customer_id"]: row
        for row in conn.execute("SELECT * FROM customers").fetchall()
    }


def shared_bank_accounts(conn: sqlite3.Connection) -> list[Finding]:
    """Two or more customers pointing at one destination account.

    The ordinary explanation is a family sharing an account. The other
    explanation is one person running several identities to collect
    several cashbacks on the same purchases, which is worth knowing
    before paying all of them.
    """
    by_account: dict[str, list[str]] = defaultdict(list)
    for customer_id, row in _customers(conn).items():
        account = (row["bank_account"] or "").strip()
        if account:
            by_account[audit.fingerprint(account)].append(customer_id)

    findings = []
    for mark, owners in by_account.items():
        if len(owners) < 2:
            continue
        for customer_id in owners:
            others = [o for o in owners if o != customer_id]
            findings.append(Finding(
                customer_id=customer_id,
                pattern="shared_bank_account",
                severity=HIGH,
                summary=f"Same payout account as {len(others)} other customer(s)",
                evidence=[f"account fingerprint {mark}",
                          "also used by " + ", ".join(others)],
            ))
    return findings


def frequent_bank_changes(events: list[dict]) -> list[Finding]:
    """A destination that keeps moving, read from the audit trail."""
    counts: Counter[str] = Counter()
    marks: dict[str, set[str]] = defaultdict(set)
    for event in events:
        if event.get("event") != audit.BANK_CHANGED:
            continue
        customer_id = event.get("customer_id")
        if not customer_id:
            continue
        counts[customer_id] += 1
        if event.get("account"):
            marks[customer_id].add(str(event["account"]))

    return [
        Finding(
            customer_id=customer_id,
            pattern="frequent_bank_change",
            severity=MEDIUM,
            summary=f"Changed payout account {count} times",
            evidence=[f"{len(marks[customer_id])} distinct account(s) seen"],
        )
        for customer_id, count in counts.items()
        if count >= BANK_CHANGES_BEFORE_FLAG
    ]


def never_buys(conn: sqlite3.Connection) -> list[Finding]:
    """Takes links steadily, never orders.

    Usually harmless -- people browse. Worth seeing anyway, because a
    steady stream of links with no orders is also what link harvesting
    looks like, and links carry the operator's own tracking id.
    """
    rows = conn.execute(
        "SELECT c.customer_id, COUNT(r.request_id) AS requests,"
        "       (SELECT COUNT(*) FROM orders o"
        "         WHERE o.customer_id = c.customer_id) AS orders"
        "  FROM customers c"
        "  LEFT JOIN link_requests r ON r.customer_id = c.customer_id"
        " GROUP BY c.customer_id"
    ).fetchall()
    return [
        Finding(
            customer_id=row["customer_id"],
            pattern="never_buys",
            severity=LOW,
            summary=f"{row['requests']} links requested, no order recorded",
            evidence=["may simply be browsing"],
        )
        for row in rows
        if row["requests"] >= MIN_REQUESTS_TO_JUDGE and row["orders"] == 0
    ]


def mostly_rejected(conn: sqlite3.Connection) -> list[Finding]:
    """Orders land but Shopee keeps refusing the commission.

    Cancelling and returning repeatedly is the cheapest way to look like a
    buyer without being one.
    """
    rows = conn.execute(
        "SELECT customer_id, COUNT(*) AS total,"
        "       SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected"
        "  FROM orders GROUP BY customer_id"
    ).fetchall()
    findings = []
    for row in rows:
        total, rejected = row["total"] or 0, row["rejected"] or 0
        if total < MIN_ORDERS_TO_JUDGE_REJECTIONS:
            continue
        rate = rejected / total
        if rate >= REJECTION_RATE_BEFORE_FLAG:
            findings.append(Finding(
                customer_id=row["customer_id"],
                pattern="mostly_rejected",
                severity=MEDIUM,
                summary=f"{rejected} of {total} orders rejected ({rate:.0%})",
                evidence=["cancellations and returns do not earn commission"],
            ))
    return findings


def sudden_volume(events: list[dict]) -> list[Finding]:
    """More requests in one day than a person shops for."""
    per_day: dict[tuple[str, str], int] = Counter()
    for event in events:
        if event.get("event") != audit.LINK_REQUESTED:
            continue
        customer_id, at = event.get("customer_id"), event.get("at", "")
        if customer_id and at:
            per_day[(customer_id, at[:10])] += 1

    worst: dict[str, tuple[str, int]] = {}
    for (customer_id, day), count in per_day.items():
        if count > worst.get(customer_id, ("", 0))[1]:
            worst[customer_id] = (day, count)

    return [
        Finding(
            customer_id=customer_id,
            pattern="sudden_volume",
            severity=MEDIUM,
            summary=f"{count} link requests in one day ({day})",
            evidence=[f"threshold is {SUDDEN_VOLUME_PER_DAY}/day"],
        )
        for customer_id, (day, count) in worst.items()
        if count >= SUDDEN_VOLUME_PER_DAY
    ]


def scan(conn: sqlite3.Connection, months: int = 3) -> list[Finding]:
    """Run every check. Most severe first, so the list reads top-down."""
    events = list(audit.read(months=months))
    findings = (
        shared_bank_accounts(conn)
        + frequent_bank_changes(events)
        + mostly_rejected(conn)
        + sudden_volume(events)
        + never_buys(conn)
    )
    order = {HIGH: 0, MEDIUM: 1, LOW: 2}
    return sorted(findings, key=lambda f: (order[f.severity], f.customer_id))


def history(customer_id: str, months: int = 12) -> list[dict]:
    """Everything one customer did, oldest first. For settling a dispute."""
    return [
        event for event in audit.read(months=months)
        if event.get("customer_id") == customer_id
    ]
