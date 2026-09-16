"""Who is owed money, and whether it is worth moving yet.

Two things turn a list of approved orders into a payout run.

THE THRESHOLD
-------------
Commissions here are small -- a few thousand dong an order. Transferring
6,131 VND to one person, then 2,142 the next week, is more of the
operator's evening than it is worth to anybody. So a customer's approved
orders accumulate, and only become payable once they clear
MIN_PAYOUT_VND together. Below it they are still owed, still visible, and
still counted; they simply wait.

The threshold is per CUSTOMER, never per order: an order is not a debt
that stands alone, it is part of what one person is owed.

THE QR
------
Nothing here moves money. Vietnamese banks offer no API to an individual
account, and driving a banking app with someone's credentials is not
automation worth having. What this does remove is the typing: a VietQR
carries the bank, the account, the amount and the reference already
filled in, so the operator scans and confirms rather than transcribing an
account number at eleven at night.

A bank name that cannot be matched with certainty produces no QR -- see
core.banks for why a guess there is worse than a manual transfer.
"""

from __future__ import annotations

import sqlite3
import urllib.parse
from dataclasses import dataclass, field

from ..core import banks

# Below this a customer's balance waits rather than being transferred.
MIN_PAYOUT_VND = 50_000

QR_BASE = "https://img.vietqr.io/image"
QR_TEMPLATE = "compact2"

# Bank transfer references reject most punctuation, and Vietnamese banks
# vary in what survives. Plain ASCII is what always arrives intact.
REFERENCE_PREFIX = "Hoan tien Shopee"


@dataclass
class Payable:
    customer_id: str
    display_name: str
    bank_name: str
    bank_account: str
    account_holder: str
    amount: int
    order_ids: list[str] = field(default_factory=list)
    bank: dict | None = None

    @property
    def is_payable(self) -> bool:
        return self.amount >= MIN_PAYOUT_VND

    @property
    def has_bank_details(self) -> bool:
        return bool(self.bank_account and self.bank_name)

    @property
    def reference(self) -> str:
        return f"{REFERENCE_PREFIX} {self.customer_id}"

    def qr_url(self) -> str | None:
        """A VietQR with everything filled in, or None when unsure.

        None means one of: no bank details yet, a bank name that could not
        be matched to exactly one bank, or a bank NAPAS does not support
        for incoming transfers. In every case the operator is shown the
        raw details instead and transfers by hand.
        """
        if not self.has_bank_details or not self.bank:
            return None
        if not banks.transfer_supported(self.bank):
            return None
        params = urllib.parse.urlencode({
            "amount": self.amount,
            "addInfo": self.reference,
            "accountName": self.account_holder or "",
        })
        return (f"{QR_BASE}/{self.bank['bin']}-{self.bank_account}"
                f"-{QR_TEMPLATE}.png?{params}")


def collect(conn: sqlite3.Connection) -> list[Payable]:
    """What each customer is owed, most owed first.

    Reads only approved, unpaid orders: the ledger's rule that cashback
    comes from an approved commission is enforced upstream, and this must
    not widen it.
    """
    rows = conn.execute(
        "SELECT o.customer_id, o.order_id, o.cashback_amount,"
        "       c.display_name, c.bank_name, c.bank_account, c.account_holder"
        "  FROM orders o JOIN customers c ON c.customer_id = o.customer_id"
        " WHERE o.status = 'approved' AND o.paid_at IS NULL"
        " ORDER BY o.approved_at"
    ).fetchall()

    catalogue = banks.load()
    by_customer: dict[str, Payable] = {}
    for row in rows:
        entry = by_customer.get(row["customer_id"])
        if entry is None:
            entry = Payable(
                customer_id=row["customer_id"],
                display_name=row["display_name"] or "",
                bank_name=row["bank_name"] or "",
                bank_account=row["bank_account"] or "",
                account_holder=row["account_holder"] or "",
                amount=0,
                bank=banks.find(row["bank_name"] or "", catalogue),
            )
            by_customer[row["customer_id"]] = entry
        entry.amount += row["cashback_amount"] or 0
        entry.order_ids.append(row["order_id"])

    return sorted(by_customer.values(), key=lambda p: -p.amount)


def split_by_threshold(
    payables: list[Payable],
) -> tuple[list[Payable], list[Payable]]:
    """(ready to pay, still accumulating)."""
    ready = [p for p in payables if p.is_payable and p.has_bank_details]
    waiting = [p for p in payables if not (p.is_payable and p.has_bank_details)]
    return ready, waiting
