"""Merge customers who exist twice because the bot changed Zalo account.

Zalo shows one person under a different UID to each account. When the bot
moved accounts, every group member was synced again under a new id, so
one person became two rows, each holding part of their history.

The row under the NEW id survives: it is the id the running bot sees, so
it is the only one a message can reach. The old id becomes an alias, which
keeps two things working that would otherwise break silently:

  - orders on links issued before the move carry the old id in sub_id1,
    and reconciliation must still credit them to this person;
  - someone who saved their old id can still sign in with it.

Pairs are proposed by display name and never merged without being shown
first: two different people can share a name.
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field

from . import repository as ledger

# Every table that points at a customer. A row missed here would keep
# pointing at an id that no longer exists.
_REFERENCES = ("link_requests", "orders", "sessions", "activity_logs",
               "payment_transfers")


@dataclass
class Pair:
    name: str
    old: sqlite3.Row
    new: sqlite3.Row
    conflict: str = ""
    moved: dict = field(default_factory=dict)


def find_pairs(conn: sqlite3.Connection) -> list[Pair]:
    """Display names held by exactly two customer rows, older first.

    Staff accounts are never paired. A name on three or more rows is left
    out: which two belong together is a judgment, not a rule.
    """
    rows = conn.execute(
        "SELECT * FROM customers"
        " WHERE COALESCE(role, 'user') = 'user'"
        "   AND COALESCE(display_name, '') != ''"
    ).fetchall()
    by_name: dict[str, list] = defaultdict(list)
    for row in rows:
        by_name[row["display_name"].strip()].append(row)

    pairs = []
    for name, group in sorted(by_name.items()):
        if len(group) != 2:
            continue
        old, new = sorted(group, key=lambda r: ledger._created_sort_key(r["created_at"]))
        pairs.append(Pair(name, old, new, conflict=_conflict(old, new)))
    return pairs


def _conflict(old: sqlite3.Row, new: sqlite3.Row) -> str:
    """Anything a machine should not decide on someone's behalf."""
    if (old["bank_account"] and new["bank_account"]
            and (old["bank_account"], old["bank_name"])
            != (new["bank_account"], new["bank_name"])):
        return "two different bank accounts"
    return ""


def merge(conn: sqlite3.Connection, pair: Pair) -> Pair:
    """Fold pair.old into pair.new. Refuses a pair with a conflict."""
    if pair.conflict:
        raise ValueError(f"{pair.name}: {pair.conflict}")
    old, new = pair.old, pair.new
    old_id, new_id = old["customer_id"], new["customer_id"]

    for table in _REFERENCES:
        cur = conn.execute(
            f"UPDATE {table} SET customer_id=? WHERE customer_id=?",
            (new_id, old_id))
        pair.moved[table] = cur.rowcount

    updates: dict[str, object] = {}
    if not new["bank_account"] and old["bank_account"]:
        for column in ("bank_name", "bank_account", "account_holder",
                       "consent_at"):
            updates[column] = old[column]
    # Keep the password set most recently: it is the one the person is
    # likelier to remember, and either id now signs in with it.
    if old["password_hash"] and (
            not new["password_hash"]
            or (old["password_set_at"] or "") > (new["password_set_at"] or "")):
        updates["password_hash"] = old["password_hash"]
        updates["password_set_at"] = old["password_set_at"]
    updates["login_count"] = (old["login_count"] or 0) + (new["login_count"] or 0)
    updates["last_login_at"] = max(old["last_login_at"] or "",
                                   new["last_login_at"] or "") or None
    # The person has been a customer since the old row appeared.
    updates["created_at"] = min(
        (old["created_at"], new["created_at"]), key=ledger._created_sort_key)

    codes = [c for c in (_code(old), _code(new)) if c]
    keep_code = min(codes) if codes else None

    # The old row goes first: the unique index on customer_code would
    # otherwise refuse handing its code to the survivor.
    conn.execute("DELETE FROM customers WHERE customer_id=?", (old_id,))
    if keep_code is not None:
        updates["customer_code"] = keep_code
    assignments = ", ".join(f"{column}=?" for column in updates)
    conn.execute(f"UPDATE customers SET {assignments} WHERE customer_id=?",
                 (*updates.values(), new_id))

    # A retired code may already have been shown to the customer (the web
    # displays it once they sign in), so it keeps signing them in.
    retired_codes = set(codes) - {keep_code}
    for alias in ({old_id, old["zalo_user_id"]} | retired_codes) - {None, "", new_id}:
        conn.execute(
            "INSERT OR REPLACE INTO customer_aliases"
            " (alias, customer_id, created_at, note) VALUES (?, ?, ?, ?)",
            (alias, new_id, ledger.now(), "merged: Zalo account change"))
    return pair


def _code(row: sqlite3.Row) -> str | None:
    return row["customer_code"] if "customer_code" in row.keys() else None


def delete_unused(conn: sqlite3.Connection, customer_id: str) -> str:
    """Remove a row that was never a customer (a bot, a stale duplicate).

    Refuses anything with history. Those go through merge, or through
    `cashback forget`, which knows about money still owed.
    """
    row = ledger.get_customer(conn, customer_id)
    if row is None:
        return "not found"
    for table in ("link_requests", "orders", "payment_transfers"):
        if conn.execute(f"SELECT 1 FROM {table} WHERE customer_id=? LIMIT 1",
                        (customer_id,)).fetchone():
            return f"refused: has {table}"
    if row["bank_account"] or row["password_hash"]:
        return "refused: has bank details or a password"
    conn.execute("DELETE FROM sessions WHERE customer_id=?", (customer_id,))
    conn.execute("DELETE FROM activity_logs WHERE customer_id=?", (customer_id,))
    conn.execute("DELETE FROM customers WHERE customer_id=?", (customer_id,))
    return "deleted"
