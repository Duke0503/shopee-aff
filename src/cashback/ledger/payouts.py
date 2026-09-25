"""Who is owed money, grouped the way it gets paid.

WHEN A BALANCE IS PAID IS THE OPERATOR'S CALL
--------------------------------------------
There was a 50,000 VND minimum here once: balances accumulated and only
became payable together. It was removed deliberately. A rule the
customer cannot see or influence means a customer with 6,000 VND waits
an unbounded time for a payout nobody ever promised them a date for,
and every message about it has to explain a policy instead of a payment.

So everything approved and unpaid is payable, and the operator decides
when to send it -- one customer tonight, everyone on Sunday, whatever
suits. Nothing here waits for a number to be reached.

What still groups is the CUSTOMER: an order is not a debt standing
alone, it is part of what one person is owed, and one transfer settles
all of them at once.

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
from ..core.policy import round_dong

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
    customer_code: str = ""
    # Campaign bonus included in amount, kept apart so a transfer can say
    # what part is cashback and what part is a promotion.
    bonus: int = 0

    @property
    def has_bank_details(self) -> bool:
        return bool(self.bank_account and self.bank_name)

    @property
    def reference(self) -> str:
        return f"{REFERENCE_PREFIX} {self.customer_code or self.customer_id}"

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
        "       c.display_name, c.bank_name, c.bank_account, c.account_holder,"
        "       c.customer_code"
        "  FROM orders o JOIN customers c ON c.customer_id = o.customer_id"
        " WHERE o.status = 'approved' AND o.paid_at IS NULL"
        # Guest orders are ours: there is nobody to pay.
        "   AND COALESCE(c.role, 'user') != 'house'"
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
                customer_code=row["customer_code"] or "",
            )
            by_customer[row["customer_id"]] = entry
        entry.amount += row["cashback_amount"] or 0
        entry.order_ids.append(row["order_id"])

    from . import campaigns
    for entry in by_customer.values():
        entry.bonus = campaigns.bonus_owed(conn, entry.order_ids)
        entry.amount += entry.bonus

    return sorted(by_customer.values(), key=lambda p: -p.amount)


def split_by_bank_details(
    payables: list[Payable],
) -> tuple[list[Payable], list[Payable]]:
    """(can be paid now, blocked on a missing account number).

    A missing account number is the only thing left that stops a
    transfer, and it is not something the operator can fix alone -- the
    customer has to send it. That is why it is its own group rather than
    a note on a row.
    """
    ready = [p for p in payables if p.has_bank_details]
    blocked = [p for p in payables if not p.has_bank_details]
    return ready, blocked


@dataclass
class Balance:
    """What one customer is owed, as that customer would ask it.

    Three numbers, because a customer asking "where is my money" is
    really asking three questions: what is approved and waiting to be
    sent, what is still in Shopee's hands, and what has already arrived.
    """

    approved: int = 0
    awaiting: int = 0
    paid: int = 0
    approved_orders: int = 0
    awaiting_orders: int = 0

    @property
    def is_payable(self) -> bool:
        """Anything approved and not yet sent. No minimum."""
        return self.approved > 0

    @property
    def is_empty(self) -> bool:
        return not (self.approved or self.awaiting or self.paid)


def balance_for(conn: sqlite3.Connection, customer_id: str,
                cashback_rate: float) -> Balance:
    """One customer's own ledger line, in the money THEY receive.

    An approved order already stores the customer's share, so it is used
    as it stands. An awaiting order stores the estimated COMMISSION, so
    the rate is applied here -- and the result is an estimate twice over
    (the commission is unsettled, and the rate can be cut by withholding),
    which is why every message showing it says so.
    """
    balance = Balance()
    rows = conn.execute(
        "SELECT o.status, o.cashback_amount, o.estimated_commission, o.paid_at,"
        "       COALESCE((SELECT SUM(a.amount) FROM campaign_awards a"
        "                 WHERE a.order_id = o.order_id AND a.status != 'void'), 0) AS bonus"
        "  FROM orders o WHERE o.customer_id = ?",
        (customer_id,),
    ).fetchall()
    for row in rows:
        # A campaign bonus follows its order: waiting while the order waits,
        # payable once it is approved, paid with it.
        if row["paid_at"]:
            balance.paid += (row["cashback_amount"] or 0) + row["bonus"]
        elif row["status"] == "approved":
            balance.approved += (row["cashback_amount"] or 0) + row["bonus"]
            balance.approved_orders += 1
        elif row["status"] == "awaiting_approval":
            est_comm = row["estimated_commission"] or 0
            net_comm = round_dong(est_comm * (1 - 0.10 - 0.0098))
            balance.awaiting += round_dong(net_comm * cashback_rate) + row["bonus"]
            balance.awaiting_orders += 1
    return balance
