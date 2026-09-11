"""Identifier generation.

Every identifier here ends up inside a Shopee sub_id, and that field accepts
only a-z, A-Z and 0-9. A dash or an underscore is silently rejected or
mangled, and the damage only surfaces two months later when the conversion
report comes back with a sub_id that matches nobody.

So: alphanumeric, validated at the point of creation, never at the point of
use.
"""

from __future__ import annotations

import re
import secrets
import sqlite3
from datetime import datetime

from ..shopee.page_selectors import SUB_ID_PATTERN

_VALID = re.compile(SUB_ID_PATTERN)

# Kept short because five sub_ids share one form and long values are easy to
# truncate somewhere in the chain.
CUSTOMER_PREFIX = "C"
REQUEST_PREFIX = "R"


def is_valid_sub_id(value: str) -> bool:
    return bool(value) and bool(_VALID.match(value))


def assert_valid_sub_id(value: str, label: str = "sub_id") -> None:
    if not is_valid_sub_id(value):
        raise ValueError(
            f"{label} {value!r} is not usable as a Shopee sub_id: only "
            "a-z, A-Z and 0-9 are accepted"
        )


def next_customer_id(conn: sqlite3.Connection) -> str:
    """Sequential, so a human reading the ledger can follow it."""
    row = conn.execute("SELECT COUNT(*) FROM customers").fetchone()
    candidate = f"{CUSTOMER_PREFIX}{int(row[0]) + 1:04d}"
    while conn.execute(
        "SELECT 1 FROM customers WHERE customer_id=?", (candidate,)
    ).fetchone():
        candidate = f"{CUSTOMER_PREFIX}{secrets.randbelow(10**6):06d}"
    assert_valid_sub_id(candidate, "customer_id")
    return candidate


def new_request_id(when: datetime | None = None) -> str:
    """Date plus randomness. No separators -- the sub_id field forbids them."""
    stamp = (when or datetime.now()).strftime("%y%m%d")
    suffix = f"{secrets.randbelow(10**5):05d}"
    candidate = f"{REQUEST_PREFIX}{stamp}{suffix}"
    assert_valid_sub_id(candidate, "request_id")
    return candidate
