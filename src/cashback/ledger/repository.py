"""The ledger. This is the product; everything else is plumbing.

All money is stored as whole VND integers. Never floats.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

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


def initialise(db_path: Path) -> None:
    with connect(db_path) as conn:
        conn.executescript(SCHEMA)
        _add_missing_tables(conn)
        _add_missing_columns(conn)


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
"""


_LATER_COLUMNS = {
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
    },
    "products_cache": {
        "image_url": "TEXT",
    },
}


def _add_missing_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(_SESSIONS_DDL)


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    for table, columns in _LATER_COLUMNS.items():
        present = {
            row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        for name, kind in columns.items():
            if name not in present:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {kind}")

    # Ensure multi-platform & canonical indexes exist
    conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_platform ON orders(platform)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_req_platform ON link_requests(platform)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_products_cache_canonical ON products_cache(canonical_url)")


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
        " ORDER BY created_at LIMIT ?",
        (PENDING, limit),
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
