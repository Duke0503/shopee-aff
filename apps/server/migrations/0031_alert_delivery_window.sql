-- Owner alert delivery, Story 8.3 (AD-27). Two changes to alerts, so the table is rebuilt (a
-- CHECK cannot be altered in SQLite):
--   not_before  a repeat raised while the last alert of its kind and severity was already sent
--               inside the cooldown waits until that cooldown ends, then goes out once with its
--               repeat count; NULL means at once.
--   EXPIRED     a pending alert older than 24 hours when the delivery job first reaches it (a first
--               deploy, a long Telegram outage) is skipped, never sent, and counted in one log line.
CREATE TABLE alerts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind GLOB '[a-z]*' AND kind NOT GLOB '*[^a-z0-9_]*'),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'warning')),
  raised_at TEXT NOT NULL,
  suppressed INTEGER NOT NULL DEFAULT 0 CHECK (suppressed >= 0),
  delivery TEXT NOT NULL DEFAULT 'PENDING' CHECK (delivery IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'EXPIRED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  send_attempt TEXT,
  delivered_at TEXT,
  not_before TEXT
);
INSERT INTO alerts_new (id, kind, severity, raised_at, suppressed, delivery, attempts, send_attempt, delivered_at)
  SELECT id, kind, severity, raised_at, suppressed, delivery, attempts, send_attempt, delivered_at FROM alerts;
DROP TABLE alerts;
ALTER TABLE alerts_new RENAME TO alerts;
CREATE INDEX alerts_kind ON alerts (kind, severity, raised_at);
CREATE INDEX alerts_pending ON alerts (id) WHERE delivery = 'PENDING';
