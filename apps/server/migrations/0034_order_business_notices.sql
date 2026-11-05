-- The Telegram order notices owed to the DP Business group (AD-4 owner: orders; D62). Every order
-- step to a notified status inserts one row in the step's own transaction; the delivery job sends
-- pending rows outside any transaction. `dedup_key` is `order:<id>[@<reopens>]:<event>`, so one
-- order, event and lifecycle is told once however often the report is re-read.
--   PENDING  owed; a failed send returns here and is retried on the next run, in order
--   SENDING  claimed under `send_attempt`, never picked up again, so an accepted send never repeats
--   SENT     the bot API accepted it
--   EXPIRED  still pending 24 hours after `raised_at`: skipped, never sent
-- A row holds no name and no amount: the text is rendered from the order at send time, so an erased
-- customer's name never waits here. Nothing is backfilled: an order that took no step after this
-- migration owes no notice.
CREATE TABLE order_business_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key TEXT NOT NULL UNIQUE CHECK (dedup_key GLOB '?*:?*:?*'),
  order_id TEXT NOT NULL REFERENCES orders (order_id),
  event TEXT NOT NULL CHECK (event IN ('recorded', 'approved', 'rejected', 'reversed', 'paid')),
  raised_at TEXT NOT NULL,
  delivery TEXT NOT NULL DEFAULT 'PENDING' CHECK (delivery IN ('PENDING', 'SENDING', 'SENT', 'EXPIRED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  send_attempt TEXT,
  delivered_at TEXT
);
CREATE INDEX order_business_notices_pending ON order_business_notices (id) WHERE delivery = 'PENDING';
