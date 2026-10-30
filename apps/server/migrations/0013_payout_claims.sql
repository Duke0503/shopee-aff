-- Payout claims (AD-4 owner: payouts; AD-9, AD-7, D19, D39, INV-2, INV-4; Story 4.7).
-- Opening a customer's payout claims it for one staff member: one OPEN claim per customer, with a
-- snapshot of exactly what the preview showed (covered order ids, bonus ids, clawback ids, the
-- amount, the bank account fingerprint and the hold flag) and the hash of that snapshot, so a
-- later confirm (Story 4.8) can tell whether anything changed. A claim idle for 10 minutes becomes
-- ABANDONED; a claim is never deleted, because a QR that was shown may have been paid (D39).
-- Orders in the snapshot of an OPEN claim are protected from reversal (AD-7).
CREATE TABLE payout_claims (
  -- 8 characters of Crockford base32: the short claim id of the transfer reference.
  claim_id TEXT PRIMARY KEY NOT NULL CHECK (length(claim_id) = 8 AND claim_id NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
  -- The surviving customer the claim pays; references identity's customers in SQL only.
  customer_id TEXT NOT NULL REFERENCES customers (customer_id),
  staff_id TEXT NOT NULL REFERENCES staff (staff_id),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CONFIRMED', 'ABANDONED')),
  -- JSON arrays of ids, sorted: what the preview covered.
  order_ids TEXT NOT NULL CHECK (json_valid(order_ids) AND json_type(order_ids) = 'array'),
  award_ids TEXT NOT NULL CHECK (json_valid(award_ids) AND json_type(award_ids) = 'array'),
  clawback_ids TEXT NOT NULL CHECK (json_valid(clawback_ids) AND json_type(clawback_ids) = 'array'),
  -- The transfer the preview showed, whole dong: getBalances payable; 0 for netting only.
  amount INTEGER NOT NULL CHECK (amount >= 0),
  -- HMAC fingerprint of the account the preview showed (AD-17); never the number itself.
  bank_fingerprint TEXT NOT NULL,
  -- 1 when the account was a website change not yet confirmed; such a claim is never opened.
  bank_held INTEGER NOT NULL CHECK (bank_held IN (0, 1)),
  -- SHA-256 of the snapshot above, checked again by confirm (AD-9).
  snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
  -- The customer code plus the short claim id, unique per claim (D39).
  transfer_reference TEXT NOT NULL UNIQUE,
  opened_at TEXT NOT NULL,
  -- The last time the claiming staff member opened the panel; the idle clock starts here.
  last_active_at TEXT NOT NULL,
  -- Set when the preview carried a VietQR: from then on a transfer may have been made.
  qr_shown_at TEXT,
  abandoned_at TEXT,
  confirmed_at TEXT,
  CHECK (status != 'ABANDONED' OR abandoned_at IS NOT NULL),
  CHECK (status != 'CONFIRMED' OR confirmed_at IS NOT NULL)
);
CREATE UNIQUE INDEX payout_claims_one_open ON payout_claims (customer_id) WHERE status = 'OPEN';
CREATE INDEX payout_claims_customer_id ON payout_claims (customer_id, opened_at);

-- A claim is never deleted (D39); its status moves only along status-flows.md section 4, and its
-- snapshot never changes once written.
CREATE TRIGGER payout_claims_no_delete BEFORE DELETE ON payout_claims
BEGIN SELECT RAISE(ABORT, 'payout_claims: never deleted'); END;
CREATE TRIGGER payout_claims_status_flow BEFORE UPDATE OF status ON payout_claims
WHEN NEW.status IS NOT OLD.status AND NOT (
  (OLD.status = 'OPEN' AND NEW.status IN ('CONFIRMED', 'ABANDONED')) OR (OLD.status = 'ABANDONED' AND NEW.status = 'CONFIRMED')
)
BEGIN SELECT RAISE(ABORT, 'payout_claims: status change not allowed'); END;
CREATE TRIGGER payout_claims_snapshot_fixed BEFORE UPDATE ON payout_claims
WHEN NEW.customer_id IS NOT OLD.customer_id OR NEW.staff_id IS NOT OLD.staff_id OR NEW.order_ids IS NOT OLD.order_ids
  OR NEW.award_ids IS NOT OLD.award_ids OR NEW.clawback_ids IS NOT OLD.clawback_ids OR NEW.amount IS NOT OLD.amount
  OR NEW.bank_fingerprint IS NOT OLD.bank_fingerprint OR NEW.bank_held IS NOT OLD.bank_held
  OR NEW.snapshot_hash IS NOT OLD.snapshot_hash OR NEW.transfer_reference IS NOT OLD.transfer_reference OR NEW.opened_at IS NOT OLD.opened_at
BEGIN SELECT RAISE(ABORT, 'payout_claims: snapshot never changes'); END;
