-- The live ledger schema, for building a fixture live database in tests (Story 2.1, 2.2).
-- Extracted from the live system on `main`, never edited by hand:
--   src/cashback/ledger/repository.py (branch main-v2 copy, last change a48c878)
--     SCHEMA                 lines 38-148
--     _SESSIONS_DDL          lines 249-330
--     _LATER_COLUMNS         lines 333-386 (as ALTER TABLE ... ADD COLUMN, the way _add_missing_columns applies them)
--     _CAMPAIGNS_DDL         lines 416-454
--     _SHARE_DDL             lines 457-468
--     _FNB_VOUCHERS_DDL      lines 470-491
--     _SYSTEM_KV_DDL         lines 493-499
--     _TELEGRAM_ALERTS_DDL   lines 501-509
--     indexes                lines 537-545 (_add_missing_columns), 614-616 (_ensure_customer_aliases), 683-684 (_ensure_customer_codes)
--     _CODE_COUNTER_DDL      lines 563-569
--     _CODE_TRIGGER          lines 571-583
--     _ALIASES_DDL           lines 591-607
-- Order of application follows initialise() (lines 239-245). The HOUSE row of _ensure_house is not
-- here: fixtures insert their own rows.


-- SCHEMA (lines 38-148)

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

-- _SESSIONS_DDL (lines 249-330)

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
    notify_mode     TEXT,
    notified_at     TEXT,
    target_group    TEXT,
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

CREATE TABLE IF NOT EXISTS payout_batches (
    batch_id        TEXT PRIMARY KEY,
    platform        TEXT NOT NULL DEFAULT 'shopee',
    status          TEXT NOT NULL,
    amount          INTEGER NOT NULL DEFAULT 0,
    eligible_amount INTEGER NOT NULL DEFAULT 0,
    created_time    TEXT,
    paid_time       TEXT,
    raw_json        TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batches_platform ON payout_batches(platform, status);

-- _CAMPAIGNS_DDL

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

-- _SHARE_DDL

-- Each time a person opened one of our short links. Previews fetched by
-- bots are not recorded. Evidence for "I clicked your link", and the
-- click-to-order rate.
CREATE TABLE IF NOT EXISTS link_clicks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id  TEXT NOT NULL,
    clicked_at  TEXT NOT NULL,
    agent       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_request ON link_clicks(request_id);

-- _FNB_VOUCHERS_DDL

CREATE TABLE IF NOT EXISTS fnb_vouchers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    brand         TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT,
    voucher_type  TEXT NOT NULL DEFAULT 'counter',
    code          TEXT,
    barcode_url   TEXT,
    affiliate_url TEXT,
    discount_text TEXT,
    min_order     INTEGER DEFAULT 0,
    start_date    TEXT,
    end_date      TEXT,
    is_hot        INTEGER DEFAULT 0,
    is_active     INTEGER DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fnb_brand_active ON fnb_vouchers(brand, is_active);
CREATE INDEX IF NOT EXISTS idx_fnb_hot ON fnb_vouchers(is_hot, is_active);

-- _SYSTEM_KV_DDL

CREATE TABLE IF NOT EXISTS system_kv (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL
);

-- _TELEGRAM_ALERTS_DDL

CREATE TABLE IF NOT EXISTS telegram_order_alerts (
    order_id    TEXT NOT NULL,
    status      TEXT NOT NULL,
    notified_at TEXT NOT NULL,
    PRIMARY KEY (order_id, status)
);
CREATE INDEX IF NOT EXISTS idx_tg_alerts_order ON telegram_order_alerts(order_id);

-- _LATER_COLUMNS (lines 333-386); columns already in the CREATE TABLE are skipped, as PRAGMA table_info would

ALTER TABLE link_requests ADD COLUMN estimate_source TEXT;

ALTER TABLE link_requests ADD COLUMN estimate_detail TEXT;

ALTER TABLE link_requests ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE link_requests ADD COLUMN share_code TEXT;

ALTER TABLE orders ADD COLUMN notified_status TEXT;

ALTER TABLE orders ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'unsettled';

ALTER TABLE orders ADD COLUMN payout_batch_id TEXT;

ALTER TABLE orders ADD COLUMN settled_at TEXT;

ALTER TABLE customers ADD COLUMN password_hash TEXT;

ALTER TABLE customers ADD COLUMN password_set_at TEXT;

ALTER TABLE customers ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;

ALTER TABLE customers ADD COLUMN locked_until TEXT;

ALTER TABLE customers ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE customers ADD COLUMN last_login_at TEXT;

ALTER TABLE customers ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE customers ADD COLUMN customer_code TEXT;

ALTER TABLE products_cache ADD COLUMN image_url TEXT;

ALTER TABLE payment_transfers ADD COLUMN bill_token TEXT;

-- _ALIASES_DDL (lines 591-607)

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

-- indexes from _ensure_customer_aliases (lines 614-616) and _add_missing_columns (lines 537-545)

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_zalo ON customers(zalo_user_id) WHERE zalo_user_id IS NOT NULL AND zalo_user_id != '';

CREATE INDEX IF NOT EXISTS idx_orders_platform ON orders(platform);

CREATE INDEX IF NOT EXISTS idx_req_platform ON link_requests(platform);

CREATE INDEX IF NOT EXISTS idx_products_cache_canonical ON products_cache(canonical_url);

CREATE UNIQUE INDEX IF NOT EXISTS idx_req_share_code ON link_requests(share_code) WHERE share_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_batch ON orders(payout_batch_id);

CREATE INDEX IF NOT EXISTS idx_orders_settlement ON orders(settlement_status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_bill_token ON payment_transfers(bill_token) WHERE bill_token IS NOT NULL;

-- _ensure_customer_codes (lines 683-684), _CODE_COUNTER_DDL (lines 563-569), _CODE_TRIGGER (lines 571-583)

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);

CREATE TABLE IF NOT EXISTS customer_code_counter (
    id   INTEGER PRIMARY KEY CHECK (id = 1),
    last INTEGER NOT NULL
);
INSERT OR IGNORE INTO customer_code_counter (id, last) VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS trg_customer_code
AFTER INSERT ON customers
WHEN NEW.customer_code IS NULL
     AND COALESCE(NEW.role, 'user') NOT IN ('admin', 'employee', 'house')
BEGIN
    UPDATE customer_code_counter SET last = last + 1 WHERE id = 1;
    UPDATE customers SET customer_code = 'DP' || printf(
        '%05d',
        (SELECT last FROM customer_code_counter WHERE id = 1))
    WHERE rowid = NEW.rowid;
END;
