-- The Telegram settlement notices owed to the DP Business group (AD-4 owner: payouts; D63). Every
-- change of a network settlement that is told inserts one row in the record's own transaction; the
-- delivery job sends pending rows outside any transaction. `dedup_key` is
-- `settlement:<id>:<event>`, so one settlement and event is told once however often it is re-read.
--   PENDING  owed; a failed send returns here and is retried on the next run, in order
--   SENDING  claimed under `send_attempt`, never picked up again, so an accepted send never repeats
--   SENT     the bot API accepted it
--   EXPIRED  still pending 24 hours after `raised_at`: skipped, never sent
-- A row holds no amount: the text is rendered from the stored settlement at send time. Nothing is
-- backfilled: a settlement that takes no new change after this migration owes no notice.
CREATE TABLE settlement_business_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key TEXT NOT NULL UNIQUE CHECK (dedup_key GLOB 'settlement:?*:?*'),
  settlement_id INTEGER NOT NULL REFERENCES network_settlements (settlement_id),
  event TEXT NOT NULL CHECK (event IN ('created', 'paid', 'failed', 'matched', 'mismatch')),
  raised_at TEXT NOT NULL,
  delivery TEXT NOT NULL DEFAULT 'PENDING' CHECK (delivery IN ('PENDING', 'SENDING', 'SENT', 'EXPIRED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  send_attempt TEXT,
  delivered_at TEXT
);
CREATE INDEX settlement_business_notices_pending ON settlement_business_notices (id) WHERE delivery = 'PENDING';
