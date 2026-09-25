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

from ..core.logging_setup import get_logger

log = get_logger(__name__)


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

        # An id merged into another row still arrives here from every link
        # issued before the merge; find_customer_id follows the alias.
        customer_id = (ledger.find_customer_id(conn, row.customer_code)
                       if row.customer_code else None)
        if customer_id is None and row.request_code:
            # sub_id2 names the exact link, and a link is made for exactly
            # one customer. Customers renumbered since (the C0003-era codes)
            # are still found this way. That is evidence, not a guess.
            owner = conn.execute(
                "SELECT customer_id FROM link_requests WHERE request_id=?",
                (row.request_code,)).fetchone()
            customer_id = owner[0] if owner else None

        # Never guess. A row we cannot attribute goes to a human.
        if customer_id is None:
            reason = (f"sub_id1 '{row.customer_code}' is not a known customer"
                      if row.customer_code
                      else "no sub_id1, cannot attribute to a customer")
            ledger.flag_for_review(
                conn, row.order_id, json.dumps(row.raw, ensure_ascii=False), reason)
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
                customer_id=customer_id,
                request_id=request_id,
                order_value=row.order_value,
                # The report carries what the order WOULD earn. It is an
                # estimate and is never paid from -- mark_approved below
                # overwrites the payable figure with what Shopee agreed --
                # but discarding it left the ledger blank and the customer
                # told "amount to be confirmed" when the number was known.
                estimated_commission=row.commission,
            )
            result.orders_new += 1
            existing = ledger.get_order(conn, row.order_id)
        elif existing["estimated_commission"] is None and row.commission:
            # An order recorded before the report was read for its estimate,
            # or by a run that discarded it. Filling it in costs nothing and
            # is what the payout page and the customer's message read from.
            # Never touches the APPROVED figure, which only mark_approved
            # sets.
            conn.execute(
                "UPDATE orders SET estimated_commission=?, updated_at=?"
                " WHERE order_id=? AND estimated_commission IS NULL",
                (row.commission, ledger.now(), row.order_id),
            )
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
