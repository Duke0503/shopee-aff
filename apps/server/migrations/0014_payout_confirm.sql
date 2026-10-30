-- Payout confirm and netting-only payouts (AD-4 owner: payouts; AD-6, AD-9, D39, D42; Stories 4.8, 4.11).
-- A netting-only payout moves no money, so its claim may have no bank account: payout_claims is
-- rebuilt with bank_fingerprint nullable, and only for a claim of amount 0. Everything else of
-- 0013 stays as it was, the triggers included. A payout is recorded at most once per claim, so a
-- retried or double-clicked confirm can never write a second payout.
CREATE TABLE payout_claims_new (
  claim_id TEXT PRIMARY KEY NOT NULL CHECK (length(claim_id) = 8 AND claim_id NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
  customer_id TEXT NOT NULL REFERENCES customers (customer_id),
  staff_id TEXT NOT NULL REFERENCES staff (staff_id),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CONFIRMED', 'ABANDONED')),
  order_ids TEXT NOT NULL CHECK (json_valid(order_ids) AND json_type(order_ids) = 'array'),
  award_ids TEXT NOT NULL CHECK (json_valid(award_ids) AND json_type(award_ids) = 'array'),
  clawback_ids TEXT NOT NULL CHECK (json_valid(clawback_ids) AND json_type(clawback_ids) = 'array'),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  -- HMAC fingerprint of the account the preview showed; NULL only for a netting-only claim without one.
  bank_fingerprint TEXT,
  bank_held INTEGER NOT NULL CHECK (bank_held IN (0, 1)),
  snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
  transfer_reference TEXT NOT NULL UNIQUE,
  opened_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  qr_shown_at TEXT,
  abandoned_at TEXT,
  confirmed_at TEXT,
  CHECK (status != 'ABANDONED' OR abandoned_at IS NOT NULL),
  CHECK (status != 'CONFIRMED' OR confirmed_at IS NOT NULL),
  CHECK (bank_fingerprint IS NOT NULL OR amount = 0)
);
INSERT INTO payout_claims_new SELECT claim_id, customer_id, staff_id, status, order_ids, award_ids, clawback_ids, amount, bank_fingerprint, bank_held, snapshot_hash, transfer_reference, opened_at, last_active_at, qr_shown_at, abandoned_at, confirmed_at FROM payout_claims;
DROP TABLE payout_claims;
ALTER TABLE payout_claims_new RENAME TO payout_claims;
CREATE UNIQUE INDEX payout_claims_one_open ON payout_claims (customer_id) WHERE status = 'OPEN';
CREATE INDEX payout_claims_customer_id ON payout_claims (customer_id, opened_at);

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

CREATE UNIQUE INDEX payouts_one_per_claim ON payouts (claim_id) WHERE claim_id IS NOT NULL;
