-- Network payouts matched to exact orders, and the payout history's paid amount (AD-4 owner:
-- payouts; AD-6, AD-12, D27, D59, status-flows.md section 7; Stories 4.12 and 4.21).
--
-- A network settlement is one payout batch a network made to the operator. Shopee makes one every
-- three or four days (production backup: 11 batches from 24/9 to 29/10/2026), each with its gross
-- commission (`eligible_amount`, Shopee eligibleTotalAmount) and what reached the operator
-- (`amount`, totalPaymentAmount), both whole dong. The difference is the 0.98% fee and, in a
-- withheld batch, 10% tax, both on the gross, so `withheld` is read from the two amounts by
-- packages/money (NULL when neither split fits; a review case then opens), with the `fee` and `tax`
-- that reading gives. A batch is matched to exact orders, never by a date cut-off on its own
-- (D59): the order list the network gave (`order_ids`, kept whenever it arrives), or else the
-- network's approved, unsettled orders approved in its window (after the previous batch was
-- created, before this one was). Batches also pay for orders attributed to no customer (guest,
-- unknown sub_id), so the operator's orders cover part of the gross: `matched_gross` is their
-- gross and `unattributed` the rest; a mismatch is only orders that exceed the batch, or rules
-- that do not apply. `match`: PENDING (not paid yet), MATCHED (orders settled with this batch),
-- MISMATCH (nothing settled; the candidates are kept and a review case is open) or HISTORIC (a
-- live batch from before the cutover: its facts and totals only, never matched to orders, because
-- the live ledger kept no approval time to place an order in a batch's window). Settling writes orders.network_batch_id and
-- settled_at through the orders module; it never changes an order's status (D27).
CREATE TABLE network_settlements (
  settlement_id INTEGER PRIMARY KEY AUTOINCREMENT,
  network TEXT NOT NULL CHECK (network IN ('shopee', 'accesstrade')),
  -- The network's own payout id (Shopee payoutId, the live payout_batches.batch_id).
  network_payout_id TEXT NOT NULL CHECK (network_payout_id != ''),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'PAID', 'FAILED')),
  -- What reached the operator, whole dong (Shopee totalPaymentAmount after fromNetworkUnits).
  amount INTEGER NOT NULL CHECK (amount >= 0),
  -- The batch's gross commission (Shopee eligibleTotalAmount); NULL when the network did not say.
  eligible_amount INTEGER CHECK (eligible_amount IS NULL OR eligible_amount >= 0),
  -- Read from amount and eligible_amount (packages/money classifyWithholding); NULL when unknown.
  withheld INTEGER CHECK (withheld IS NULL OR withheld IN (0, 1)),
  fee INTEGER CHECK (fee IS NULL OR fee >= 0),
  tax INTEGER CHECK (tax IS NULL OR tax >= 0),
  -- When the network created the batch (payoutCreatedTime): the end of its window.
  created_at TEXT,
  paid_at TEXT,
  -- The start of its window: when the network's previous batch recorded by this system was
  -- created, or the go-live (the cutover import) for the first; NULL when neither exists.
  window_from TEXT,
  -- The network's own order list for the batch, a JSON array of order ids; NULL when not given.
  order_ids TEXT CHECK (order_ids IS NULL OR (json_valid(order_ids) AND json_type(order_ids) = 'array')),
  match TEXT NOT NULL CHECK (match IN ('PENDING', 'MATCHED', 'MISMATCH', 'HISTORIC')),
  -- The gross of the operator's orders matched or proposed, and eligible minus it (packages/money).
  matched_gross INTEGER CHECK (matched_gross IS NULL OR matched_gross >= 0),
  unattributed INTEGER,
  -- What the last match was computed from: an unchanged batch is not matched again.
  match_fingerprint TEXT CHECK (match_fingerprint IS NULL OR length(match_fingerprint) = 64),
  origin TEXT NOT NULL CHECK (origin IN ('CUTOVER', 'NETWORK')),
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- The list's search over the network payout id (ASCII letters, digits, - and _: lower() is its
  -- folded search text); generated, never written, not declared in Drizzle.
  search_text TEXT GENERATED ALWAYS AS (lower(network_payout_id)) VIRTUAL,
  UNIQUE (network, network_payout_id),
  CHECK ((withheld IS NULL) = (fee IS NULL) AND (fee IS NULL) = (tax IS NULL)),
  CHECK ((matched_gross IS NULL) = (unattributed IS NULL))
);
CREATE INDEX network_settlements_created ON network_settlements (network, created_at);

-- A settlement moves only PROCESSING -> PAID or FAILED (status-flows.md section 7). What the
-- network said it paid never changes: a later record that says otherwise is audited and opens a
-- review case instead (Story 4.21). A matched batch stays matched.
CREATE TRIGGER network_settlements_status_flow BEFORE UPDATE OF status ON network_settlements
WHEN NEW.status IS NOT OLD.status AND NOT (OLD.status = 'PROCESSING' AND NEW.status IN ('PAID', 'FAILED'))
BEGIN SELECT RAISE(ABORT, 'network_settlements: status change not allowed'); END;
CREATE TRIGGER network_settlements_facts_fixed BEFORE UPDATE ON network_settlements
WHEN NEW.network IS NOT OLD.network OR NEW.network_payout_id IS NOT OLD.network_payout_id OR NEW.amount IS NOT OLD.amount
  OR NEW.eligible_amount IS NOT OLD.eligible_amount OR NEW.created_at IS NOT OLD.created_at
  OR NEW.withheld IS NOT OLD.withheld OR NEW.origin IS NOT OLD.origin OR NEW.recorded_at IS NOT OLD.recorded_at
  OR (OLD.match = 'MATCHED' AND NEW.match IS NOT 'MATCHED') OR ((OLD.match = 'HISTORIC') != (NEW.match = 'HISTORIC'))
BEGIN SELECT RAISE(ABORT, 'network_settlements: recorded facts never change'); END;

-- The orders of a settlement: SETTLED (marked with this batch), CANDIDATE (a mismatch proposed it,
-- nothing settled), CONFLICT (listed by the network but already settled by another batch),
-- NOT_APPROVED (listed but not approved or paid here), UNKNOWN (listed, not in the ledger); the
-- last three are refused, each with a review case. `gross` is the order's approved commission (for
-- an imported order the live estimate, the live system stored no approved figure) and `net` what
-- the network pays for it under the batch's withholding (packages/money).
CREATE TABLE network_settlement_orders (
  settlement_id INTEGER NOT NULL REFERENCES network_settlements (settlement_id),
  order_id TEXT NOT NULL CHECK (order_id != ''),
  outcome TEXT NOT NULL CHECK (outcome IN ('SETTLED', 'CANDIDATE', 'CONFLICT', 'NOT_APPROVED', 'UNKNOWN')),
  gross INTEGER CHECK (gross IS NULL OR gross >= 0),
  net INTEGER CHECK (net IS NULL OR net >= 0),
  PRIMARY KEY (settlement_id, order_id)
);
CREATE INDEX network_settlement_orders_order_id ON network_settlement_orders (order_id);

-- The payout history's paid figure (Story 4.12 AC2): what a payout still counts as paid, 0 once it
-- is voided, so the history's summary is one SUM() over a stored column of the filtered set
-- (code.md section 4) and a voided payout is excluded from it. Virtual: it follows the status.
ALTER TABLE payouts ADD COLUMN paid_amount INTEGER GENERATED ALWAYS AS (CASE WHEN status = 'RECORDED' THEN transfer_amount ELSE 0 END) VIRTUAL;
