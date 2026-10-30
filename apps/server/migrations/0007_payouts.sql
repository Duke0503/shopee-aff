-- Payout tables (AD-4 owner: payouts; AD-6, AD-9, AD-17, AD-24, D4, D39, D41, D42, D49; Story 2.4).
-- A payout is one recorded transfer to one customer: RECORDED, or VOIDED by an admin with a
-- reason (status-flows.md section 4). Imported payouts keep the live payment_transfers id and its
-- bill token, so every /b/<token> receipt link already handed out still opens its payout. Payout
-- claims are new-system only (D39): an imported payout has no claim. Times that fit no
-- conversion rule are NULL and listed in the import report.

CREATE TABLE payouts (
  payout_id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL REFERENCES customers (customer_id),
  status TEXT NOT NULL CHECK (status IN ('RECORDED', 'VOIDED')),
  -- What left the bank, in whole dong; 0 for a netting-only payout (AD-6).
  transfer_amount INTEGER NOT NULL CHECK (transfer_amount >= 0),
  transfer_reference TEXT,
  -- The public receipt link /b/<token>; the receipt shows facts only (D49).
  receipt_token TEXT UNIQUE CHECK (receipt_token IS NULL OR receipt_token != ''),
  -- The last four digits of the account paid into, for the receipt; never the full number.
  bank_last_four TEXT CHECK (bank_last_four IS NULL OR length(bank_last_four) BETWEEN 1 AND 4),
  -- The payout claim confirmed as this payout (AD-9); NULL for an imported payout (D39).
  claim_id TEXT,
  -- The staff member who recorded it.
  recorded_by TEXT,
  recorded_at TEXT,
  note TEXT,
  -- Staff only: where the live proof image is kept. Never served on the receipt (D49).
  proof_ref TEXT,
  voided_at TEXT,
  void_reason TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('CUTOVER', 'CONFIRM')),
  CHECK (status != 'VOIDED' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)),
  CHECK (origin != 'CUTOVER' OR claim_id IS NULL)
);
CREATE INDEX payouts_customer_id ON payouts (customer_id);

-- What a payout covered: each order with its stored cashback, and each campaign bonus with its
-- order. Amounts are copied from the order and the award; they are never computed here (AD-5).
CREATE TABLE payout_items (
  payout_id INTEGER NOT NULL REFERENCES payouts (payout_id),
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('ORDER', 'AWARD')),
  order_id TEXT NOT NULL REFERENCES orders (order_id),
  award_id INTEGER REFERENCES campaign_awards (award_id),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (payout_id, line_no),
  CHECK ((kind = 'AWARD') = (award_id IS NOT NULL))
);
CREATE INDEX payout_items_order_id ON payout_items (order_id);
CREATE INDEX payout_items_award_id ON payout_items (award_id) WHERE award_id IS NOT NULL;

-- Clawbacks, netting, write-offs and their offsets (AD-6, D42): insert-only. A clawback's open
-- amount is the sum of the entries sharing its clawback id: the negative original (stored
-- cashback plus any paid bonus, D35) and positive netting and write-off entries; a payout void
-- offsets what it wrote (D41). The cutover writes none: the live system had no clawbacks.
CREATE TABLE ledger_entries (
  entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL REFERENCES customers (customer_id),
  clawback_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CLAWBACK', 'NETTING', 'WRITE_OFF', 'OFFSET')),
  amount INTEGER NOT NULL CHECK (amount != 0),
  order_id TEXT REFERENCES orders (order_id),
  payout_id INTEGER REFERENCES payouts (payout_id),
  reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  CHECK (kind != 'CLAWBACK' OR amount < 0),
  CHECK (kind NOT IN ('NETTING', 'WRITE_OFF') OR amount > 0)
);
CREATE INDEX ledger_entries_customer_id ON ledger_entries (customer_id);
CREATE INDEX ledger_entries_clawback_id ON ledger_entries (clawback_id);
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'insert_only: ledger_entries'); END;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'insert_only: ledger_entries'); END;
