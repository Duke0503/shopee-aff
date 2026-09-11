"""Match report rows against the ledger and advance order states.

This module is deliberately independent of where the rows came from. Today
they arrive from a downloaded CSV (importer.py); once Open API access is
granted they will arrive from the API instead. Only the source changes --
the matching and the state machine below stay exactly as they are.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from typing import Iterable

from ..ledger import repository as ledger
from ..shopee.report_importer import ReportRow
from ..core.policy import TaxPolicy, split_commission


@dataclass
class Outcome:
    rows_read: int = 0
    orders_new: int = 0
    approved: int = 0
    rejected: int = 0
    skipped: int = 0            # already paid, or already in a terminal state
    needs_review: int = 0
    notify_approved: list[str] = field(default_factory=list)
    notify_rejected: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"read {self.rows_read} | new {self.orders_new} | "
            f"approved {self.approved} | rejected {self.rejected} | "
            f"skipped {self.skipped} | needs review {self.needs_review}"
        )


def run(
    conn: sqlite3.Connection,
    rows: Iterable[ReportRow],
    *,
    cashback_rate: float,
    tax_policy: TaxPolicy,
    period_is_withheld: bool,
    source: str = "csv",
    period_start: str | None = None,
    period_end: str | None = None,
) -> Outcome:
    result = Outcome()

    for row in rows:
        result.rows_read += 1

        # Never guess. A row we cannot attribute goes to a human.
        if not row.customer_code:
            ledger.flag_for_review(
                conn, row.order_id, json.dumps(row.raw, ensure_ascii=False),
                "no sub_id1, cannot attribute to a customer",
            )
            result.needs_review += 1
            continue

        if ledger.get_customer(conn, row.customer_code) is None:
            ledger.flag_for_review(
                conn, row.order_id, json.dumps(row.raw, ensure_ascii=False),
                f"sub_id1 '{row.customer_code}' is not a known customer",
            )
            result.needs_review += 1
            continue

        if row.status == "unknown":
            ledger.flag_for_review(
                conn, row.order_id, json.dumps(row.raw, ensure_ascii=False),
                "unrecognised status value",
            )
            result.needs_review += 1
            continue

        existing = ledger.get_order(conn, row.order_id)

        if existing is None:
            # sub_id2 may reference a link created outside this system, for
            # instance by hand in the dashboard before the ledger existed.
            # Attribution to a customer is what matters for payout, so drop
            # an unknown request reference rather than rejecting the order.
            request_id = row.request_code or None
            if request_id and not conn.execute(
                "SELECT 1 FROM link_requests WHERE request_id=?", (request_id,)
            ).fetchone():
                request_id = None

            ledger.add_order(
                conn,
                order_id=row.order_id,
                customer_id=row.customer_code,
                request_id=request_id,
                order_value=row.order_value,
                estimated_commission=None,
            )
            result.orders_new += 1
            existing = ledger.get_order(conn, row.order_id)

        # RULE 2: an order already paid is never reprocessed, whatever the
        # report now says. Reconciliation windows overlap; without this a
        # single order gets paid two or three times.
        if existing["paid_at"] or existing["status"] in (
            ledger.PAID,
            ledger.REJECTED,
        ):
            result.skipped += 1
            continue

        if row.status == "approved":
            if row.commission is None:
                ledger.flag_for_review(
                    conn, row.order_id, json.dumps(row.raw, ensure_ascii=False),
                    "marked approved but no commission amount",
                )
                result.needs_review += 1
                continue

            # RULE 3: cashback derives from the APPROVED commission only.
            split = split_commission(
                row.commission, cashback_rate, tax_policy, period_is_withheld
            )
            if ledger.mark_approved(
                conn, row.order_id, row.commission, split.customer_receives
            ):
                result.approved += 1
                result.notify_approved.append(row.order_id)
            else:
                result.skipped += 1

        elif row.status == "rejected":
            if ledger.mark_rejected(conn, row.order_id, "rejected in Shopee report"):
                result.rejected += 1
                result.notify_rejected.append(row.order_id)
            else:
                result.skipped += 1

        else:
            # Still awaiting approval: recorded, nothing to advance yet.
            result.skipped += 1

    conn.execute(
        "INSERT INTO reconciliation_runs"
        " (ran_at, source, period_start, period_end, rows_read, orders_new,"
        "  approved, rejected, skipped, needs_review)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            ledger.now(), source, period_start, period_end,
            result.rows_read, result.orders_new, result.approved,
            result.rejected, result.skipped, result.needs_review,
        ),
    )
    return result
