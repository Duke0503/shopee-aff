"""The ledger. This is the product; everything else is plumbing.

All money is stored as whole VND integers. Never floats.
"""

from __future__ import annotations

import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Iterator

# --- Link request states -----------------------------------------------
PENDING = "pending"          # link issued, unknown whether the customer bought
CONVERTED = "converted"      # produced at least one order
EXPIRED = "expired"          # no order arrived in the window; bookkeeping
                             # only -- the link still works if clicked

# --- Order states ------------------------------------------------------
MAX_LINK_ATTEMPTS = 3

AWAITING_APPROVAL = "awaiting_approval"  # Shopee recorded the order
APPROVED = "approved"                    # commission approved -> payout allowed
PAID = "paid"                            # transferred to the customer, terminal
REJECTED = "rejected"                    # cancelled / returned / not recorded

# States only ever move forward along these edges.
ALLOWED_TRANSITIONS = {
    AWAITING_APPROVAL: {APPROVED, REJECTED},
    APPROVED: {PAID},
    PAID: set(),
    REJECTED: set(),
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    customer_id      TEXT PRIMARY KEY,
    zalo_user_id     TEXT,
    private_chat_id  TEXT,
    display_name     TEXT,
    bank_name        TEXT,
    bank_account     TEXT,
    account_holder   TEXT,
    consent_at       TEXT,
    status           TEXT NOT NULL DEFAULT 'active',
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS link_requests (
    request_id           TEXT PRIMARY KEY,
    customer_id          TEXT NOT NULL REFERENCES customers(customer_id),
    created_at           TEXT NOT NULL,
    source_url           TEXT NOT NULL,
    affiliate_url        TEXT,
    estimated_commission INTEGER,
    channel              TEXT,
    status               TEXT NOT NULL DEFAULT 'pending',
    notified_at          TEXT,
    platform             TEXT NOT NULL DEFAULT 'shopee'
);
CREATE INDEX IF NOT EXISTS idx_req_customer ON link_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_req_status ON link_requests(status);

CREATE TABLE IF NOT EXISTS orders (
    order_id             TEXT PRIMARY KEY,
    customer_id          TEXT REFERENCES customers(customer_id),
    request_id           TEXT REFERENCES link_requests(request_id),
    order_value          INTEGER,
    estimated_commission INTEGER,
    approved_commission  INTEGER,
    cashback_amount      INTEGER,
    status               TEXT NOT NULL,
    rejection_reason     TEXT,
    recorded_at          TEXT,
    approved_at          TEXT,
    paid_at              TEXT,
    updated_at           TEXT NOT NULL,
    platform             TEXT NOT NULL DEFAULT 'shopee'
);
CREATE INDEX IF NOT EXISTS idx_order_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_status ON orders(status);

-- Append-only. Never overwrite a row.
CREATE TABLE IF NOT EXISTS state_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    changed_at  TEXT NOT NULL,
    note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_order ON state_history(order_id);

-- Rows whose sub_id could not be matched. Never guess: leave them for a human.
CREATE TABLE IF NOT EXISTS manual_review (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   TEXT,
    raw_data   TEXT NOT NULL,
    reason     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ran_at        TEXT NOT NULL,
    source        TEXT NOT NULL,
    period_start  TEXT,
    period_end    TEXT,
    rows_read     INTEGER NOT NULL DEFAULT 0,
    orders_new    INTEGER NOT NULL DEFAULT 0,
    approved      INTEGER NOT NULL DEFAULT 0,
    rejected      INTEGER NOT NULL DEFAULT 0,
    skipped       INTEGER NOT NULL DEFAULT 0,
    needs_review  INTEGER NOT NULL DEFAULT 0,
    error         TEXT
);

CREATE TABLE IF NOT EXISTS products_cache (
    item_id               TEXT PRIMARY KEY,
    shop_id               TEXT,
    name                  TEXT,
    price                 INTEGER,
    price_formatted       TEXT,
    shopee_rate           REAL,
    seller_rate           REAL,
    shopee_part           INTEGER,
    shopee_part_formatted TEXT,
    seller_part           INTEGER,
    seller_part_formatted TEXT,
    total_commission      INTEGER,
    commission_formatted  TEXT,
    is_capped             INTEGER DEFAULT 0,
    cashback              INTEGER,
    cashback_formatted    TEXT,
    rate_percent          TEXT,
    affiliate_url         TEXT,
    canonical_url         TEXT,
    request_count         INTEGER DEFAULT 1,
    first_seen_at         TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prod_updated ON products_cache(updated_at);
CREATE INDEX IF NOT EXISTS idx_prod_count ON products_cache(request_count DESC);
"""


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=60.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 60000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def initialise(db_path: Path, assign_codes: bool = True) -> None:
    """Bring the schema up to date. assign_codes=False leaves customer
    codes unissued, for a merge that must run before numbering."""
    with connect(db_path) as conn:
        conn.executescript(SCHEMA)
        _add_missing_tables(conn)
        _add_missing_columns(conn, assign_codes)


# Columns added after the first release. SQLite has no IF NOT EXISTS for
# ADD COLUMN, so existing databases are upgraded by inspection.
_SESSIONS_DDL = """
-- Browser sessions for the customer-facing view. The token itself is
-- never stored: only its SHA-256, so a copy of this file does not hand
-- over live sessions. See core/accounts.py.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_customer ON sessions(customer_id);

CREATE TABLE IF NOT EXISTS activity_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT,
    action      TEXT NOT NULL,
    path        TEXT,
    ip_address  TEXT,
    user_agent  TEXT,
    detail      TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_customer ON activity_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS payment_transfers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id     TEXT NOT NULL,
    amount          INTEGER NOT NULL,
    transfer_code   TEXT,
    note            TEXT,
    proof_image     TEXT,
    order_ids       TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT
);
CREATE INDEX IF NOT EXISTS idx_transfer_customer ON payment_transfers(customer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_time ON payment_transfers(created_at DESC);

CREATE TABLE IF NOT EXISTS group_info (
    group_id        TEXT PRIMARY KEY,
    group_name      TEXT NOT NULL,
    total_members   INTEGER NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS featured_deals (
    id              TEXT PRIMARY KEY,
    item_id         TEXT NOT NULL,
    name            TEXT NOT NULL,
    platform        TEXT NOT NULL DEFAULT 'Shopee Mall',
    category        TEXT NOT NULL,
    original_price  INTEGER NOT NULL,
    sale_price      INTEGER NOT NULL,
    commission_rate REAL NOT NULL,
    cashback        INTEGER NOT NULL,
    image_url       TEXT NOT NULL,
    url             TEXT NOT NULL,
    is_active       INTEGER DEFAULT 1,
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deals_cat ON featured_deals(category, is_active, sort_order);
"""


_LATER_COLUMNS = {
    "campaigns": {
        "per_customer": "INTEGER NOT NULL DEFAULT 0",
    },
    "link_requests": {
        "notified_at": "TEXT",
        "estimate_source": "TEXT",
        "estimate_detail": "TEXT",
        # How many times the browser has tried this one. A link that
        # cannot be made was retried forever and the customer was never
        # told; after MAX_LINK_ATTEMPTS it is given up on and they hear
        # about it.
        "attempts": "INTEGER NOT NULL DEFAULT 0",
        "platform": "TEXT NOT NULL DEFAULT 'shopee'",
    },
    # The last status the customer was actually told about. Compared with
    # `status` to find who is owed an update, which makes the notifier safe
    # to run repeatedly and safe across a restart.
    "orders": {
        "notified_status": "TEXT",
        "platform": "TEXT NOT NULL DEFAULT 'shopee'",
    },
    # Signing in to the customer-facing view. password_hash is PBKDF2 and
    # cannot be read back -- asking the bot for a password issues a new
    # one rather than repeating the old.
    "customers": {
        "password_hash": "TEXT",
        "password_set_at": "TEXT",
        "failed_logins": "INTEGER NOT NULL DEFAULT 0",
        "locked_until": "TEXT",
        "role": "TEXT NOT NULL DEFAULT 'user'",
        "last_login_at": "TEXT",
        "login_count": "INTEGER NOT NULL DEFAULT 0",
        "customer_code": "TEXT",
    },
    "products_cache": {
        "image_url": "TEXT",
    },
}


# Promotions such as "20,000 VND extra for the first 20 customers". A bonus
# is its own money, never folded into cashback: cashback is derived from an
# approved commission (rule 1), a bonus is a promise we made. See
# ledger/campaigns.py for the rules that fill and settle the slots.
_CAMPAIGNS_DDL = """
CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id        TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    starts_at          TEXT NOT NULL,
    ends_at            TEXT NOT NULL,
    slots              INTEGER NOT NULL,
    bonus_vnd          INTEGER NOT NULL,
    min_order_value    INTEGER NOT NULL DEFAULT 0,
    platforms          TEXT NOT NULL DEFAULT 'shopee,shopeefood,tiktok',
    excluded_customers TEXT NOT NULL DEFAULT '',
    per_customer       INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'active',
    created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_awards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id     TEXT NOT NULL REFERENCES campaigns(campaign_id),
    customer_id     TEXT NOT NULL,
    order_id        TEXT NOT NULL,
    amount          INTEGER NOT NULL,
    status          TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    confirmed_at    TEXT,
    paid_at         TEXT,
    voided_at       TEXT,
    notified_status TEXT
);
-- One live slot per order: enforced here, not trusted to code. A customer
-- may hold several (campaigns.per_customer caps it in code), so the old
-- one-per-customer index is dropped from databases that already had it.
DROP INDEX IF EXISTS idx_award_customer;
CREATE INDEX IF NOT EXISTS idx_award_customer_lookup
    ON campaign_awards(campaign_id, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_award_order
    ON campaign_awards(campaign_id, order_id) WHERE status != 'void';
CREATE INDEX IF NOT EXISTS idx_award_order_lookup ON campaign_awards(order_id);
"""


def _add_missing_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(_SESSIONS_DDL)
    conn.executescript(_CAMPAIGNS_DDL)


def _add_missing_columns(conn: sqlite3.Connection, assign_codes: bool = True) -> None:
    for table, columns in _LATER_COLUMNS.items():
        present = {
            row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        for name, kind in columns.items():
            if name not in present:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {kind}")

    _ensure_customer_aliases(conn)
    _ensure_house(conn)
    if assign_codes:
        _ensure_customer_codes(conn)

    # Ensure multi-platform & canonical indexes exist
    conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_platform ON orders(platform)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_req_platform ON link_requests(platform)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_products_cache_canonical ON products_cache(canonical_url)")


# The name a customer signs in with and reads back to us. customer_id is
# the Zalo UID and cannot change -- it is inside the sub_id of every link
# already handed out -- but nineteen digits is not something anyone types.
CUSTOMER_CODE_PREFIX = "DP"
CUSTOMER_CODE_DIGITS = 5
# The account guest links are made under. See _ensure_house.
HOUSE_CUSTOMER_ID = "HOUSE"
HOUSE_ROLE = "house"

# Rows that are not people to be paid never get a customer code.
_STAFF_ROLES = ("admin", "employee", HOUSE_ROLE)

# The counter only ever goes up. Deriving the next number from MAX() would
# hand a deleted customer's code to the next person to join, and a code in
# an old bank transfer must only ever mean one person.
_CODE_COUNTER_DDL = """
CREATE TABLE IF NOT EXISTS customer_code_counter (
    id   INTEGER PRIMARY KEY CHECK (id = 1),
    last INTEGER NOT NULL
);
INSERT OR IGNORE INTO customer_code_counter (id, last) VALUES (1, 0);
"""

_CODE_TRIGGER = f"""
CREATE TRIGGER IF NOT EXISTS trg_customer_code
AFTER INSERT ON customers
WHEN NEW.customer_code IS NULL
     AND COALESCE(NEW.role, 'user') NOT IN {_STAFF_ROLES!r}
BEGIN
    UPDATE customer_code_counter SET last = last + 1 WHERE id = 1;
    UPDATE customers SET customer_code = '{CUSTOMER_CODE_PREFIX}' || printf(
        '%0{CUSTOMER_CODE_DIGITS}d',
        (SELECT last FROM customer_code_counter WHERE id = 1))
    WHERE rowid = NEW.rowid;
END;
"""


# Zalo gives one person a different UID depending on which account is
# looking. When the bot moved to a new Zalo account on 2026-09-24, every
# member was seen again under a new id and got a second customer row. The
# old ids are still inside the sub_id of every link handed out before the
# move, so after merging they stay here as aliases of the surviving row.
_ALIASES_DDL = """
CREATE TABLE IF NOT EXISTS customer_aliases (
    alias       TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_aliases_customer ON customer_aliases(customer_id);

CREATE TRIGGER IF NOT EXISTS trg_customer_not_alias
BEFORE INSERT ON customers
WHEN EXISTS (SELECT 1 FROM customer_aliases
             WHERE alias IN (NEW.customer_id, NEW.zalo_user_id))
BEGIN
    SELECT RAISE(ABORT, 'that id is an alias of an existing customer');
END;
"""


def _ensure_customer_aliases(conn: sqlite3.Connection) -> None:
    conn.executescript(_ALIASES_DDL)
    try:
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_zalo"
            " ON customers(zalo_user_id)"
            " WHERE zalo_user_id IS NOT NULL AND zalo_user_id != ''")
    except sqlite3.IntegrityError:
        # Refusing to start over this would take the bot down; saying so
        # loudly and leaving the rows for `cashback merge-customers` does not.
        print("WARNING: two customers share a zalo_user_id;"
              " run `cashback merge-customers` to resolve it")


def _ensure_house(conn: sqlite3.Connection) -> None:
    """The account a link is made under when the web does not know who asked.

    A visitor who has not signed in and gave no code still gets a working
    link, so the commission is ours rather than nobody's. Every visitor is
    the same person here, so one link per product serves them all: a flood
    of guests costs one trip to Shopee per product, not one per click.

    Its orders pay no cashback (mark_approved forces zero), it never
    appears among payouts, and nothing is ever sent to it.
    """
    conn.execute(
        "INSERT OR IGNORE INTO customers"
        " (customer_id, display_name, role, status, created_at)"
        " VALUES (?, ?, ?, 'active', ?)",
        (HOUSE_CUSTOMER_ID, "Web guests (house)", HOUSE_ROLE, now()))


def is_house(conn: sqlite3.Connection, customer_id: str | None) -> bool:
    return customer_id == HOUSE_CUSTOMER_ID or bool(conn.execute(
        "SELECT 1 FROM customers WHERE customer_id=? AND role=?",
        (customer_id, HOUSE_ROLE)).fetchone())


def find_house_link(conn: sqlite3.Connection, item_id: str) -> sqlite3.Row | None:
    """The guest link already made (or being made) for this product."""
    return conn.execute(
        "SELECT * FROM link_requests"
        " WHERE customer_id=? AND status != 'failed'"
        "   AND json_extract(estimate_detail, '$.item_id') = ?"
        " ORDER BY (affiliate_url IS NULL OR affiliate_url = ''), created_at DESC"
        " LIMIT 1", (HOUSE_CUSTOMER_ID, str(item_id))).fetchone()


def format_customer_code(number: int) -> str:
    return f"{CUSTOMER_CODE_PREFIX}{number:0{CUSTOMER_CODE_DIGITS}d}"


def _created_sort_key(value: str | None) -> datetime:
    """created_at holds two formats: ISO with an offset from now(), and
    SQLite's datetime('now'), which is UTC without one. Compared as
    strings they interleave wrongly, so both are brought to UTC."""
    try:
        moment = datetime.fromisoformat(str(value).replace(" ", "T"))
    except ValueError:
        return datetime.max.replace(tzinfo=timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _ensure_customer_codes(conn: sqlite3.Connection) -> None:
    """Give every customer a code, oldest first, and every new one on insert.

    The trigger is what covers new rows: customers are created from half a
    dozen places, and a rule each of them has to remember is a rule one of
    them forgets. Numbers are never reused, so a code seen in an old bank
    transfer can only ever mean one person.
    """
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_code"
                 " ON customers(customer_code)")
    conn.executescript(_CODE_COUNTER_DDL)
    missing = conn.execute(
        "SELECT rowid, created_at FROM customers"
        " WHERE customer_code IS NULL"
        f"   AND COALESCE(role, 'user') NOT IN {_STAFF_ROLES!r}"
    ).fetchall()
    top = max(
        conn.execute("SELECT last FROM customer_code_counter WHERE id=1")
        .fetchone()[0],
        conn.execute(
            "SELECT COALESCE(MAX(CAST(substr(customer_code, ?) AS INTEGER)), 0)"
            "  FROM customers WHERE customer_code LIKE ?",
            (len(CUSTOMER_CODE_PREFIX) + 1, f"{CUSTOMER_CODE_PREFIX}%"),
        ).fetchone()[0],
    )
    ordered = sorted(missing, key=lambda r: (_created_sort_key(r[1]), r[0]))
    conn.executemany(
        "UPDATE customers SET customer_code=? WHERE rowid=?",
        [(format_customer_code(top + i), row[0])
         for i, row in enumerate(ordered, start=1)],
    )
    conn.execute("UPDATE customer_code_counter SET last=? WHERE id=1",
                 (top + len(ordered),))
    # Recreated every start so a change to the rule (such as a new role that
    # gets no code) reaches databases that already have the old trigger.
    conn.execute("DROP TRIGGER IF EXISTS trg_customer_code")
    conn.executescript(_CODE_TRIGGER)


def find_customer_id(conn: sqlite3.Connection, key: str) -> str | None:
    """The customer behind a DP code, an internal id, a Zalo id, or an
    old Zalo id merged into another row (see customer_aliases)."""
    key = "".join((key or "").split())
    if not key:
        return None
    row = conn.execute(
        "SELECT customer_id FROM customers"
        " WHERE customer_code=? OR customer_id=? OR zalo_user_id=?",
        (key.upper(), key, key)).fetchone()
    if row is None:
        # Retired DP codes are aliases too, typed in any case.
        row = conn.execute(
            "SELECT customer_id FROM customer_aliases WHERE alias IN (?, ?)",
            (key, key.upper())).fetchone()
    return row[0] if row else None


def looks_like_customer_code(key: str) -> bool:
    return bool(re.fullmatch(
        rf"{CUSTOMER_CODE_PREFIX}\d+", "".join((key or "").split()).upper()))


def customer_code_of(conn: sqlite3.Connection, customer_id: str) -> str:
    row = conn.execute(
        "SELECT customer_code FROM customers WHERE customer_id=?",
        (customer_id,)).fetchone()
    return (row[0] if row else None) or customer_id


# ======================================================================
# Customers
# ======================================================================

def add_customer(
    conn: sqlite3.Connection,
    customer_id: str,
    display_name: str = "",
    zalo_user_id: str = "",
    private_chat_id: str = "",
) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO customers"
        " (customer_id, zalo_user_id, private_chat_id, display_name, created_at)"
        " VALUES (?,?,?,?,?)",
        (customer_id, zalo_user_id, private_chat_id, display_name, now()),
    )


def set_bank_details(
    conn: sqlite3.Connection,
    customer_id: str,
    bank_name: str,
    bank_account: str,
    account_holder: str,
) -> None:
    """Collected ONCE at onboarding.

    `consent_at` is recorded alongside: Vietnam's personal data protection
    law takes effect 2026-01-01 and this is personal data.
    """
    conn.execute(
        "UPDATE customers SET bank_name=?, bank_account=?, account_holder=?,"
        " consent_at=? WHERE customer_id=?",
        (bank_name, bank_account, account_holder, now(), customer_id),
    )


def erase_bank_details(conn: sqlite3.Connection, customer_id: str) -> None:
    """Honour a customer's request to delete their banking details."""
    conn.execute(
        "UPDATE customers SET bank_name=NULL, bank_account=NULL,"
        " account_holder=NULL, consent_at=NULL WHERE customer_id=?",
        (customer_id,),
    )


def get_customer(conn: sqlite3.Connection, customer_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM customers WHERE customer_id=?", (customer_id,)
    ).fetchone()


def can_accept_orders(conn: sqlite3.Connection, customer_id: str) -> tuple[bool, str]:
    """Refuse orders we would be unable to settle two months from now.

    Without a private chat id the bot cannot message the customer when the
    commission is finally approved, so the payout would silently strand.
    """
    row = get_customer(conn, customer_id)
    if row is None:
        return False, "unknown customer"
    if not row["private_chat_id"]:
        return False, "customer has never messaged the bot privately"
    if not row["bank_account"]:
        return False, "no bank account on file"
    return True, ""


# ======================================================================
# Link requests
# ======================================================================

def record_link_request(
    conn: sqlite3.Connection,
    request_id: str,
    customer_id: str,
    source_url: str,
    affiliate_url: str | None,
    estimated_commission: int | None,
    channel: str = "direct",
    platform: str = "shopee",
) -> None:
    conn.execute(
        "INSERT INTO link_requests"
        " (request_id, customer_id, created_at, source_url, affiliate_url,"
        "  estimated_commission, channel, status, platform)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (request_id, customer_id, now(), source_url, affiliate_url,
         estimated_commission, channel, PENDING, platform),
    )


def expire_stale_requests(conn: sqlite3.Connection, attribution_days: int) -> int:
    """Mark requests expired once the attribution window has elapsed."""
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=attribution_days)
    ).astimezone().isoformat()
    cur = conn.execute(
        "UPDATE link_requests SET status=? WHERE status=? AND created_at < ?",
        (EXPIRED, PENDING, cutoff),
    )
    return cur.rowcount


# ======================================================================
# Orders
# ======================================================================

def _record_transition(
    conn: sqlite3.Connection,
    order_id: str,
    from_status: str | None,
    to_status: str,
    note: str = "",
) -> None:
    conn.execute(
        "INSERT INTO state_history (order_id, from_status, to_status, changed_at, note)"
        " VALUES (?,?,?,?,?)",
        (order_id, from_status, to_status, now(), note),
    )


def get_order(conn: sqlite3.Connection, order_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM orders WHERE order_id=?", (order_id,)).fetchone()


def add_order(
    conn: sqlite3.Connection,
    order_id: str,
    customer_id: str | None,
    request_id: str | None,
    order_value: int | None,
    estimated_commission: int | None,
    platform: str = "shopee",
) -> None:
    conn.execute(
        "INSERT INTO orders"
        " (order_id, customer_id, request_id, order_value, estimated_commission,"
        "  status, recorded_at, updated_at, platform)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (order_id, customer_id, request_id, order_value, estimated_commission,
         AWAITING_APPROVAL, now(), now(), platform),
    )
    _record_transition(conn, order_id, None, AWAITING_APPROVAL, f"recorded by {platform.title()}")
    if request_id:
        conn.execute(
            "UPDATE link_requests SET status=? WHERE request_id=? AND status=?",
            (CONVERTED, request_id, PENDING),
        )


def mark_approved(
    conn: sqlite3.Connection,
    order_id: str,
    approved_commission: int,
    cashback_amount: int,
) -> bool:
    """RULE 2: an order that already has `paid_at` is never reprocessed.

    Reconciliation runs repeatedly over overlapping periods. Without this
    guard a single order gets paid out two or three times.

    RULE 3: `cashback_amount` must be derived from the APPROVED commission,
    never from the estimate. The caller computes it via policy.split_commission.
    """
    row = get_order(conn, order_id)
    if row is None:
        return False
    if row["paid_at"]:
        return False
    if row["status"] != AWAITING_APPROVAL:
        return False
    # Guest orders are ours in full. Enforced here, where every approval
    # passes, rather than trusted to each reconciler.
    if is_house(conn, row["customer_id"]):
        cashback_amount = 0

    conn.execute(
        "UPDATE orders SET status=?, approved_commission=?, cashback_amount=?,"
        " approved_at=?, updated_at=? WHERE order_id=?",
        (APPROVED, approved_commission, cashback_amount, now(), now(), order_id),
    )
    _record_transition(
        conn, order_id, row["status"], APPROVED,
        f"approved commission {approved_commission} VND -> cashback {cashback_amount} VND",
    )
    return True


def mark_rejected(conn: sqlite3.Connection, order_id: str, reason: str) -> bool:
    row = get_order(conn, order_id)
    if row is None or row["paid_at"]:
        return False
    if row["status"] != AWAITING_APPROVAL:
        return False
    conn.execute(
        "UPDATE orders SET status=?, rejection_reason=?, updated_at=? WHERE order_id=?",
        (REJECTED, reason, now(), order_id),
    )
    _record_transition(conn, order_id, row["status"], REJECTED, reason)
    return True


def mark_paid(conn: sqlite3.Connection, order_id: str, note: str = "") -> bool:
    """RULE 1: only ever pay an order that is already APPROVED."""
    row = get_order(conn, order_id)
    if row is None:
        return False
    if row["status"] != APPROVED:
        return False
    if row["paid_at"]:
        return False
    conn.execute(
        "UPDATE orders SET status=?, paid_at=?, updated_at=? WHERE order_id=?",
        (PAID, now(), now(), order_id),
    )
    _record_transition(conn, order_id, APPROVED, PAID, note or "transferred")
    # A campaign bonus riding on this order went out in the same transfer.
    from . import campaigns
    campaigns.settle(conn, order_id)
    return True


def orders_awaiting_payout(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT o.*, c.display_name, c.bank_name, c.bank_account, c.account_holder,"
        " c.private_chat_id"
        " FROM orders o LEFT JOIN customers c ON c.customer_id = o.customer_id"
        " WHERE o.status=? AND o.paid_at IS NULL"
        " ORDER BY o.approved_at",
        (APPROVED,),
    ).fetchall()


def flag_for_review(
    conn: sqlite3.Connection, order_id: str | None, raw_data: str, reason: str
) -> None:
    """Queue a row for a human -- once. Reconciliation re-reads the same
    report every hour; filing the same order again each time buried the
    twelve real questions under a thousand copies of them."""
    if order_id and conn.execute(
        "SELECT 1 FROM manual_review WHERE order_id=? AND reason=? AND resolved=0",
        (order_id, reason)).fetchone():
        return
    conn.execute(
        "INSERT INTO manual_review (order_id, raw_data, reason, created_at)"
        " VALUES (?,?,?,?)",
        (order_id, raw_data, reason, now()),
    )


# ======================================================================
# Metrics live in metrics.py
# ======================================================================
# The three figures that matter -- effective commission rate, valid rate and
# approved AOV -- are defined in metrics.py per audit v8 section 12.
#
# An earlier summary function here was removed for two defects:
#   - it reported a "rejection ratio" in place of valid rate; the denominators
#     differ, since valid rate counts every order that arose, including those
#     still awaiting approval
#   - its profit figure subtracted neither the 0.98% service fee nor the
#     withheld tax, so it overstated earnings


# ======================================================================
# Link generation queue
# ======================================================================

def pending_link_jobs(
    conn: sqlite3.Connection, limit: int = 100
) -> list[sqlite3.Row]:
    """Link requests still waiting for an affiliate URL, oldest first."""
    return conn.execute(
        "SELECT request_id, customer_id, source_url, created_at"
        " FROM link_requests"
        " WHERE status=? AND (affiliate_url IS NULL OR affiliate_url='')"
        # Someone waiting in a Zalo chat first, then a web customer, then
        # guests: a flood of web requests must not delay the customers who
        # are actually talking to us.
        " ORDER BY CASE WHEN customer_id=? THEN 2"
        "               WHEN COALESCE(channel, '') = 'web' THEN 1 ELSE 0 END,"
        "          created_at LIMIT ?",
        (PENDING, HOUSE_CUSTOMER_ID, limit),
    ).fetchall()


def find_reusable_request(
    conn: sqlite3.Connection,
    customer_id: str,
    source_url: str,
    resend_within_days: int,
    platform: str | None = None,
) -> sqlite3.Row | None:
    """A link this customer asked for recently for this exact product.

    People resend a product when no reply arrives. Treating each send as a
    new request made three links for one item, three trips to Shopee, and
    three near-identical messages the customer had to choose between.

    THE LINK ITSELF NEVER EXPIRES. Shopee's seven days start when the
    customer CLICKS, not when the link was made, so one created a month ago
    still earns if it is clicked today -- and reconciliation still finds
    its request whatever status the row carries.

    The window here is therefore not an expiry. It separates "I never got
    it" from "I am shopping for this again": past it the quoted price and
    commission are stale and the message would be wrong, so a fresh
    request is made to get fresh numbers.
    """
    cutoff = (datetime.now(timezone.utc).astimezone()
              - timedelta(days=resend_within_days)).isoformat()
    if platform:
        return conn.execute(
            "SELECT * FROM link_requests"
            " WHERE customer_id=? AND source_url=? AND platform=? AND created_at >= ?"
            "   AND status != 'failed'"
            " ORDER BY created_at DESC LIMIT 1",
            (customer_id, source_url, platform, cutoff),
        ).fetchone()
    return conn.execute(
        "SELECT * FROM link_requests"
        " WHERE customer_id=? AND source_url=? AND created_at >= ?"
        "   AND status != 'failed'"
        " ORDER BY created_at DESC LIMIT 1",
        (customer_id, source_url, cutoff),
    ).fetchone()


def find_own_request(
    conn: sqlite3.Connection,
    customer_id: str,
    source_urls: Iterable[str],
    resend_within_days: int,
    platform: str | None = None,
) -> sqlite3.Row | None:
    """find_reusable_request across the spellings one product arrives in.

    The same paste is stored as the raw text on one path and as the
    extracted URL on another, so matching only one of them misses the
    customer's own earlier link and makes a duplicate.

    This is the ONLY way a link may be reused. A link carries the sub_id
    of the customer it was made for, and reconciliation credits every order
    on it to that customer -- so a link found by product rather than by
    customer pays someone else for this customer's purchase.
    """
    for url in dict.fromkeys(u for u in source_urls if u):
        row = find_reusable_request(
            conn, customer_id, url, resend_within_days, platform=platform)
        if row is not None:
            return row
    return None


def mark_link_delivered(conn: sqlite3.Connection, request_id: str) -> None:
    """The customer has the link in hand: nobody needs to send it again."""
    conn.execute(
        "UPDATE link_requests SET notified_at=? WHERE request_id=?"
        " AND notified_at IS NULL", (now(), request_id))


def resend_request(conn: sqlite3.Connection, request_id: str) -> None:
    """Queue an already-generated link to go out again, with fresh numbers.

    The link is reused; the price and commission are not. Shopee prices
    move -- a flash sale is enough -- and a message quoting what the item
    cost the last time it was asked about is simply wrong. Clearing the
    stored estimate makes delivery look it up again.
    """
    conn.execute(
        "UPDATE link_requests SET notified_at=NULL, estimate_detail=NULL,"
        " estimated_commission=NULL, estimate_source=NULL WHERE request_id=?",
        (request_id,),
    )


def attach_affiliate_url(
    conn: sqlite3.Connection,
    request_id: str,
    affiliate_url: str,
    estimated_commission: int | None = None,
) -> bool:
    """Store the generated link. Refuses an overwrite, and a wrong link.

    The second refusal matters more than it looks. An affiliate link points
    at ONE product. If the browser hands back a link already recorded
    against a different source URL, the page returned a stale answer -- and
    storing it would send a customer a link to somebody else's product,
    quietly, with the cashback quoted for the item they asked about. That
    has happened once, when a page stopped being reloaded between passes.
    """
    row = conn.execute(
        "SELECT affiliate_url, source_url FROM link_requests WHERE request_id=?",
        (request_id,),
    ).fetchone()
    if row is None or row["affiliate_url"]:
        return False

    clash = conn.execute(
        "SELECT request_id FROM link_requests"
        " WHERE affiliate_url=? AND source_url != ? LIMIT 1",
        (affiliate_url, row["source_url"]),
    ).fetchone()
    if clash:
        return False
    if estimated_commission is None:
        conn.execute(
            "UPDATE link_requests SET affiliate_url=? WHERE request_id=?",
            (affiliate_url, request_id),
        )
    else:
        conn.execute(
            "UPDATE link_requests SET affiliate_url=?, estimated_commission=?"
            " WHERE request_id=?",
            (affiliate_url, estimated_commission, request_id),
        )
    return True


def forget_customer(
    conn: sqlite3.Connection, customer_id: str, force: bool = False
) -> dict:
    """Erase a customer and everything traceable to them.

    Refuses while money is still owed: deleting a record that says you owe
    someone 20,000 VND does not end the obligation, it just hides it. Pass
    force only when that has been settled some other way.

    A customer may ask for this under Vietnam's personal data protection
    law, so it has to actually delete rather than flag as inactive.
    """
    row = get_customer(conn, customer_id)
    if row is None:
        return {"found": False}

    owed = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(cashback_amount), 0) FROM orders"
        " WHERE customer_id=? AND status=? AND paid_at IS NULL",
        (customer_id, APPROVED),
    ).fetchone()

    if owed[0] and not force:
        return {
            "found": True,
            "deleted": False,
            "owed_orders": owed[0],
            "owed_amount": owed[1],
        }

    order_ids = [
        r[0] for r in conn.execute(
            "SELECT order_id FROM orders WHERE customer_id=?", (customer_id,)
        )
    ]
    for order_id in order_ids:
        conn.execute("DELETE FROM state_history WHERE order_id=?", (order_id,))
        conn.execute("DELETE FROM manual_review WHERE order_id=?", (order_id,))

    counts = {}
    for table in ("orders", "link_requests"):
        cur = conn.execute(f"DELETE FROM {table} WHERE customer_id=?", (customer_id,))
        counts[table] = cur.rowcount
    conn.execute("DELETE FROM customers WHERE customer_id=?", (customer_id,))

    return {
        "found": True,
        "deleted": True,
        "display_name": row["display_name"],
        "orders": counts["orders"],
        "link_requests": counts["link_requests"],
    }


def get_product_cache(conn: sqlite3.Connection, item_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM products_cache WHERE item_id = ?", (str(item_id),)
    ).fetchone()


def upsert_product_cache(
    conn: sqlite3.Connection,
    item_id: str,
    shop_id: str = "",
    name: str = "",
    price: int = 0,
    price_formatted: str = "",
    shopee_rate: float = 0.0,
    seller_rate: float = 0.0,
    shopee_part: int = 0,
    shopee_part_formatted: str = "",
    seller_part: int = 0,
    seller_part_formatted: str = "",
    total_commission: int = 0,
    commission_formatted: str = "",
    is_capped: bool = False,
    cashback: int = 0,
    cashback_formatted: str = "",
    rate_percent: str = "80%",
    affiliate_url: str | None = None,
    canonical_url: str = "",
    image_url: str = "",
    increment_count: bool = False,
) -> sqlite3.Row:
    timestamp = now()
    existing = get_product_cache(conn, item_id)
    if existing:
        final_aff_url = affiliate_url or existing["affiliate_url"]
        conn.execute(
            """
            UPDATE products_cache SET
                shop_id = COALESCE(NULLIF(?, ''), shop_id),
                name = COALESCE(NULLIF(?, ''), name),
                price = CASE WHEN ? > 0 THEN ? ELSE price END,
                price_formatted = COALESCE(NULLIF(?, ''), price_formatted),
                shopee_rate = CASE WHEN ? > 0 THEN ? ELSE shopee_rate END,
                seller_rate = CASE WHEN ? > 0 THEN ? ELSE seller_rate END,
                shopee_part = CASE WHEN ? > 0 THEN ? ELSE shopee_part END,
                shopee_part_formatted = COALESCE(NULLIF(?, ''), shopee_part_formatted),
                seller_part = CASE WHEN ? > 0 THEN ? ELSE seller_part END,
                seller_part_formatted = COALESCE(NULLIF(?, ''), seller_part_formatted),
                total_commission = CASE WHEN ? > 0 THEN ? ELSE total_commission END,
                commission_formatted = COALESCE(NULLIF(?, ''), commission_formatted),
                is_capped = ?,
                cashback = CASE WHEN ? > 0 THEN ? ELSE cashback END,
                cashback_formatted = COALESCE(NULLIF(?, ''), cashback_formatted),
                rate_percent = COALESCE(NULLIF(?, ''), rate_percent),
                affiliate_url = ?,
                canonical_url = COALESCE(NULLIF(?, ''), canonical_url),
                image_url = COALESCE(NULLIF(?, ''), image_url),
                request_count = CASE WHEN ? THEN request_count + 1 ELSE request_count END,
                updated_at = ?
            WHERE item_id = ?
            """,
            (
                shop_id, name, price, price, price_formatted,
                shopee_rate, shopee_rate, seller_rate, seller_rate,
                shopee_part, shopee_part, shopee_part_formatted,
                seller_part, seller_part, seller_part_formatted,
                total_commission, total_commission, commission_formatted,
                1 if is_capped else 0,
                cashback, cashback, cashback_formatted,
                rate_percent, final_aff_url, canonical_url, image_url,
                1 if increment_count else 0,
                timestamp, str(item_id),
            ),
        )
    else:
        conn.execute(
            """
            INSERT INTO products_cache (
                item_id, shop_id, name, price, price_formatted,
                shopee_rate, seller_rate, shopee_part, shopee_part_formatted,
                seller_part, seller_part_formatted, total_commission, commission_formatted,
                is_capped, cashback, cashback_formatted, rate_percent,
                affiliate_url, canonical_url, image_url, request_count, first_seen_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                str(item_id), shop_id, name, price, price_formatted,
                shopee_rate, seller_rate, shopee_part, shopee_part_formatted,
                seller_part, seller_part_formatted, total_commission, commission_formatted,
                1 if is_capped else 0, cashback, cashback_formatted, rate_percent,
                affiliate_url, canonical_url, image_url, timestamp, timestamp,
            ),
        )
    return get_product_cache(conn, item_id)


def get_hot_products(conn: sqlite3.Connection, limit: int = 50) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM products_cache ORDER BY request_count DESC, updated_at DESC LIMIT ?",
        (limit,),
    ).fetchall()


def get_stale_hot_products(
    conn: sqlite3.Connection, limit: int = 20, max_age_hours: int = 6
) -> list[sqlite3.Row]:
    cutoff = (
        datetime.now(timezone.utc).astimezone() - timedelta(hours=max_age_hours)
    ).isoformat()
    return conn.execute(
        "SELECT * FROM products_cache WHERE updated_at < ? ORDER BY request_count DESC LIMIT ?",
        (cutoff, limit),
    ).fetchall()


def get_featured_deals(
    conn: sqlite3.Connection, category: str | None = None, limit: int = 24
) -> list[sqlite3.Row]:
    """Return active curated/hot deals, optionally filtered by category."""
    if category and category != "all":
        return conn.execute(
            """
            SELECT * FROM featured_deals
            WHERE is_active = 1 AND category = ?
            ORDER BY sort_order ASC, updated_at DESC
            LIMIT ?
            """,
            (category, limit),
        ).fetchall()
    return conn.execute(
        """
        SELECT * FROM featured_deals
        WHERE is_active = 1
        ORDER BY sort_order ASC, updated_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()


def upsert_featured_deal(
    conn: sqlite3.Connection,
    deal_id: str,
    item_id: str,
    name: str,
    platform: str,
    category: str,
    original_price: int,
    sale_price: int,
    commission_rate: float,
    cashback: int,
    image_url: str,
    url: str,
    is_active: int = 1,
    sort_order: int = 0,
) -> None:
    timestamp = now()
    existing = conn.execute(
        "SELECT id FROM featured_deals WHERE id = ?", (deal_id,)
    ).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE featured_deals SET
                item_id = ?, name = ?, platform = ?, category = ?,
                original_price = ?, sale_price = ?, commission_rate = ?,
                cashback = ?, image_url = ?, url = ?, is_active = ?,
                sort_order = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                item_id, name, platform, category,
                original_price, sale_price, commission_rate,
                cashback, image_url, url, is_active,
                sort_order, timestamp, deal_id,
            ),
        )
    else:
        conn.execute(
            """
            INSERT INTO featured_deals (
                id, item_id, name, platform, category,
                original_price, sale_price, commission_rate,
                cashback, image_url, url, is_active,
                sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                deal_id, item_id, name, platform, category,
                original_price, sale_price, commission_rate,
                cashback, image_url, url, is_active,
                sort_order, timestamp, timestamp,
            ),
        )

