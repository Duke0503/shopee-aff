-- Delivering the outbox (AD-4 owner: messaging; AD-16, D9, D46; Stories 6.4 and 6.10).
-- The assistant pulls one due row at a time and acknowledges it once sent. A handed-out row stays
-- leased for 2 minutes; unacknowledged, it is due again 1, 2, 4 ... up to 60 minutes after the
-- lease ends (`due_at` holds that time from the handout on). A row older than 7 days is never
-- handed out; the expiry job drops it (never due again) and counts it by `drop_reason`. A leased
-- row is never dropped, and an ack of a dropped row records the send and clears the drop. A row enqueued while `messaging.silent` is on is
-- a would-be send: `silenced_at` is set and it is never due, also after the flag is turned off.

ALTER TABLE outbox ADD COLUMN handed_out_at TEXT;
ALTER TABLE outbox ADD COLUMN silenced_at TEXT;
ALTER TABLE outbox ADD COLUMN dropped_at TEXT;
-- expired: older than 7 days; no_recipient: no Zalo id to write to; undeliverable: the assistant
-- has no complete text for it; superseded: what it tells was handed over another way first.
ALTER TABLE outbox ADD COLUMN drop_reason TEXT CHECK (drop_reason IS NULL OR drop_reason IN ('expired', 'no_recipient', 'undeliverable', 'superseded'));
CREATE INDEX outbox_silenced ON outbox (silenced_at) WHERE silenced_at IS NOT NULL;
CREATE INDEX outbox_sent ON outbox (sent_at) WHERE sent_at IS NOT NULL;
-- The handout's order (oldest due first, replacing 0004's outbox_due) and the daily cap's open leases.
DROP INDEX outbox_due;
CREATE INDEX outbox_handout ON outbox (due_at, id) WHERE sent_at IS NULL AND dropped_at IS NULL;
CREATE INDEX outbox_leased ON outbox (handed_out_at) WHERE sent_at IS NULL;

-- The server flags of messaging, one row. `silent`: enqueue records would-be sends and makes none
-- due (the first run after the cutover import, which turns it on, D46). Every change is audited.
CREATE TABLE messaging_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  silent INTEGER NOT NULL DEFAULT 0 CHECK (silent IN (0, 1)),
  changed_at TEXT,
  changed_by TEXT
);
INSERT INTO messaging_settings (id, silent) VALUES (1, 0);

-- One row per Vietnam day the daily cap on proactive sends was reached, so the owner is alerted
-- once that day.
CREATE TABLE outbox_cap_days (
  day TEXT PRIMARY KEY NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reached_at TEXT NOT NULL
);
