-- Proof images and payout void (AD-4 owner: payouts; AD-9, AD-21, AD-26, D24, D41, D49, INV-13;
-- Stories 4.9 and 4.10).
--
-- A proof image is a bank screenshot: it carries the full account number and the holder, so it is
-- never on the public receipt (D49). The file itself lives under the backed-up data/<env>/files/
-- directory, outside every web root, under a random name the server chose; this row is the only
-- way to reach it. Only JPEG and PNG are kept, re-written without metadata on upload. One proof
-- per payout: a second upload replaces the row (the earlier file stays on disk and in the audit
-- trail by its SHA-256).
CREATE TABLE payout_proofs (
  payout_id INTEGER PRIMARY KEY NOT NULL REFERENCES payouts (payout_id),
  -- 32 lowercase hex characters and the extension of the content type; never a name the browser sent.
  file_name TEXT NOT NULL UNIQUE CHECK (length(file_name) = 36 AND substr(file_name, 1, 32) NOT GLOB '*[^0-9a-f]*' AND substr(file_name, 33) IN ('.jpg', '.png')),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  CHECK ((content_type = 'image/jpeg') = (substr(file_name, 33) = '.jpg'))
);

-- Who voided a payout (D24); the reason and the time are already on the row (0007).
ALTER TABLE payouts ADD COLUMN voided_by TEXT;

-- A payout moves only RECORDED -> VOIDED (status-flows.md section 4), and a voided payout keeps
-- its void facts. What it paid never changes: amount, customer, receipt token and claim are fixed.
CREATE TRIGGER payouts_status_flow BEFORE UPDATE OF status ON payouts
WHEN NEW.status IS NOT OLD.status AND NOT (OLD.status = 'RECORDED' AND NEW.status = 'VOIDED')
BEGIN SELECT RAISE(ABORT, 'payouts: status change not allowed'); END;
CREATE TRIGGER payouts_facts_fixed BEFORE UPDATE ON payouts
WHEN NEW.customer_id IS NOT OLD.customer_id OR NEW.transfer_amount IS NOT OLD.transfer_amount OR NEW.receipt_token IS NOT OLD.receipt_token
  OR NEW.claim_id IS NOT OLD.claim_id OR NEW.recorded_at IS NOT OLD.recorded_at OR NEW.origin IS NOT OLD.origin
  OR (OLD.status = 'VOIDED' AND (NEW.voided_at IS NOT OLD.voided_at OR NEW.void_reason IS NOT OLD.void_reason OR NEW.voided_by IS NOT OLD.voided_by))
BEGIN SELECT RAISE(ABORT, 'payouts: recorded facts never change'); END;

-- A void can leave the customer owed money a clawback already took back (D41, D42): when a later
-- payout netted a clawback on an order this payout covered, the void closes the clawback and the
-- netted part is credited back as a NETTING_REFUND entry (positive, linked to the voided payout and
-- the clawback). The next payout pays the credit with a REFUND_PAID entry (negative, linked to
-- that payout). Credit entries are not part of any clawback's open amount; a credit's open amount is
-- the sum of its NETTING_REFUND and REFUND_PAID entries. ledger_entries is rebuilt for the two
-- kinds; rows, indexes and the insert-only triggers stay as they were.
CREATE TABLE ledger_entries_new (
  entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL REFERENCES customers (customer_id),
  clawback_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CLAWBACK', 'NETTING', 'WRITE_OFF', 'OFFSET', 'NETTING_REFUND', 'REFUND_PAID')),
  amount INTEGER NOT NULL CHECK (amount != 0),
  order_id TEXT REFERENCES orders (order_id),
  payout_id INTEGER REFERENCES payouts (payout_id),
  reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  CHECK (kind != 'CLAWBACK' OR amount < 0),
  CHECK (kind NOT IN ('NETTING', 'WRITE_OFF', 'NETTING_REFUND') OR amount > 0),
  CHECK (kind != 'REFUND_PAID' OR amount < 0),
  CHECK (kind NOT IN ('NETTING_REFUND', 'REFUND_PAID') OR payout_id IS NOT NULL)
);
INSERT INTO ledger_entries_new SELECT entry_id, customer_id, clawback_id, kind, amount, order_id, payout_id, reason, created_at, created_by FROM ledger_entries;
DROP TABLE ledger_entries;
ALTER TABLE ledger_entries_new RENAME TO ledger_entries;
CREATE INDEX ledger_entries_customer_id ON ledger_entries (customer_id);
CREATE INDEX ledger_entries_clawback_id ON ledger_entries (clawback_id);
CREATE INDEX ledger_entries_payout_id ON ledger_entries (payout_id) WHERE payout_id IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'insert_only: ledger_entries'); END;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'insert_only: ledger_entries'); END;
