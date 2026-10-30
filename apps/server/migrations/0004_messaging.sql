-- The notification outbox (AD-4 owner: messaging; AD-16, D5, D9, D46; Story 2.5).
-- One (entity, event) is told once: the dedup key `<entity>:<id>:<event>` is unique, so a second
-- enqueue of the same key is a no-op. A row is due while `due_at` is set and `sent_at` is not.
-- The cutover seeds a row with `sent_at` set for every event the live system already told, so the
-- first run after the import sends none of them again (D46).

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key TEXT NOT NULL UNIQUE CHECK (dedup_key GLOB '?*:?*:?*'),
  customer_id TEXT NOT NULL REFERENCES customers (customer_id),
  message_key TEXT NOT NULL,
  -- Ids and amounts in dong only, as JSON; never names, phone numbers or bank numbers.
  params TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  due_at TEXT,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- EVENT: enqueued by a command; CUTOVER_SEED: told by the live system before the cutover.
  origin TEXT NOT NULL CHECK (origin IN ('EVENT', 'CUTOVER_SEED')),
  CHECK (origin != 'CUTOVER_SEED' OR (sent_at IS NOT NULL AND due_at IS NULL))
);
CREATE INDEX outbox_due ON outbox (due_at) WHERE sent_at IS NULL AND due_at IS NOT NULL;
