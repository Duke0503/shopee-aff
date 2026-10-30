-- Operations tables (AD-4 owner: operations; AD-17, AD-27, FR-29, FR-30, INV-11; Story 3.2).
-- The audit trail: one entry per money or personal-data command, written in that command's own
-- transaction, with its actor. Insert-only: a trigger rejects UPDATE and DELETE. The payload is
-- JSON of ids, counts, statuses and HMAC fingerprints only, never names, phone numbers or bank
-- numbers; the operations module checks every entry before it is written.

CREATE TABLE audit_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('staff', 'customer', 'assistant', 'system')),
  actor_id TEXT NOT NULL CHECK (actor_id != ''),
  -- context.aggregate.verb
  event TEXT NOT NULL CHECK (event GLOB '[a-z]*.[a-z]*.[a-z]*'),
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  reason TEXT
);
CREATE INDEX audit_entries_entity ON audit_entries (entity_id);
CREATE INDEX audit_entries_recorded_at ON audit_entries (recorded_at);
CREATE TRIGGER IF NOT EXISTS audit_entries_no_update BEFORE UPDATE ON audit_entries BEGIN SELECT RAISE(ABORT, 'insert_only: audit_entries'); END;
CREATE TRIGGER IF NOT EXISTS audit_entries_no_delete BEFORE DELETE ON audit_entries BEGIN SELECT RAISE(ABORT, 'insert_only: audit_entries'); END;

-- Owner alerts (AD-27). One row per alert that goes out; a repeat of the same kind and severity
-- inside its cooldown (critical 5, high 15, warning 30 minutes) while that row is still PENDING is
-- counted on it instead. Delivery runs outside any transaction: a row is marked SENDING with a
-- fresh send_attempt id before the send, then SENT, or PENDING again (FAILED after the last
-- attempt) when the send failed; a SENDING row is never picked up again, so an alert the sender
-- accepted is never sent twice. It carries no personal data.
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind GLOB '[a-z]*' AND kind NOT GLOB '*[^a-z0-9_]*'),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'warning')),
  raised_at TEXT NOT NULL,
  suppressed INTEGER NOT NULL DEFAULT 0 CHECK (suppressed >= 0),
  delivery TEXT NOT NULL DEFAULT 'PENDING' CHECK (delivery IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  send_attempt TEXT,
  delivered_at TEXT
);
CREATE INDEX alerts_kind ON alerts (kind, severity, raised_at);
CREATE INDEX alerts_pending ON alerts (id) WHERE delivery = 'PENDING';
