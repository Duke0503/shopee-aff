-- Reconciliation apply (AD-4 owner: orders; AD-5, AD-7, AD-8, D4, D39, D54, D55, D58; Stories 3.3, 3.4).
-- Cashback is stored once, at approval, with the split inputs it was computed from: the fee, the
-- withheld tax, whether the order's settlement period was withheld then, and that period. A staff
-- mark on a period changes only approvals after it; a stored split is never recomputed. An
-- imported order keeps NULL here: the live system stored no split inputs (D34).

ALTER TABLE orders ADD COLUMN cashback_fee INTEGER CHECK (cashback_fee IS NULL OR cashback_fee >= 0);
ALTER TABLE orders ADD COLUMN cashback_tax INTEGER CHECK (cashback_tax IS NULL OR cashback_tax >= 0);
ALTER TABLE orders ADD COLUMN cashback_withheld INTEGER CHECK (cashback_withheld IS NULL OR cashback_withheld IN (0, 1));
ALTER TABLE orders ADD COLUMN settlement_period TEXT CHECK (settlement_period IS NULL OR settlement_period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]');

-- A paid order never changes (D4, INV-2), beyond 0002's trigger: its split, network, request,
-- approval time, estimate and value stay as they were, and it leaves PAID only for the two states
-- a payout void may give (APPROVED or REVERSED, D41). Only last_seen_in_report_at and updated_at move.
CREATE TRIGGER orders_paid_order_unchanged BEFORE UPDATE ON orders
WHEN OLD.status = 'PAID' AND (
  NEW.status NOT IN ('PAID', 'APPROVED', 'REVERSED')
  OR NEW.cashback_fee IS NOT OLD.cashback_fee OR NEW.cashback_tax IS NOT OLD.cashback_tax
  OR NEW.cashback_withheld IS NOT OLD.cashback_withheld OR NEW.settlement_period IS NOT OLD.settlement_period
  OR NEW.network IS NOT OLD.network OR NEW.request_id IS NOT OLD.request_id OR NEW.approved_at IS NOT OLD.approved_at
  OR NEW.estimated_commission IS NOT OLD.estimated_commission OR NEW.order_value IS NOT OLD.order_value
  OR NEW.rejection_reason IS NOT OLD.rejection_reason
)
BEGIN SELECT RAISE(ABORT, 'a paid order never changes'); END;

-- The items of a paid order are never rewritten either.
CREATE TRIGGER order_items_paid_no_update BEFORE UPDATE ON order_items
WHEN (SELECT status FROM orders WHERE order_id = OLD.order_id) = 'PAID'
BEGIN SELECT RAISE(ABORT, 'a paid order never changes'); END;
CREATE TRIGGER order_items_paid_no_delete BEFORE DELETE ON order_items
WHEN (SELECT status FROM orders WHERE order_id = OLD.order_id) = 'PAID'
BEGIN SELECT RAISE(ABORT, 'a paid order never changes'); END;

-- Review cases (AD-7, AD-8, status-flows.md section 6): a report row the rules will not guess at.
-- `subject` is the report's order id, or '#' and the row fingerprint for a row without one, so
-- one case is open per (network, subject, reason). `order_id` is set only when an order is
-- recorded; an unattributed row has none (D58). A case carries only the candidates the rules
-- produced, never another customer. Story 3.9 adds apply and dismiss.
CREATE TABLE review_cases (
  case_id INTEGER PRIMARY KEY AUTOINCREMENT,
  network TEXT NOT NULL CHECK (network IN ('shopee', 'accesstrade')),
  subject TEXT NOT NULL CHECK (subject != ''),
  order_id TEXT REFERENCES orders (order_id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('APPLIED', 'DISMISSED')),
  -- JSON array of customer ids the rules produced.
  candidates TEXT NOT NULL DEFAULT '[]',
  -- The normalized report row that opened the case, as JSON.
  observation TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_reason TEXT,
  CHECK ((status = 'RESOLVED') = (resolution IS NOT NULL)),
  CHECK (status = 'OPEN' OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_reason IS NOT NULL))
);
CREATE UNIQUE INDEX review_cases_one_open ON review_cases (network, subject, reason) WHERE status = 'OPEN';
CREATE INDEX review_cases_order_id ON review_cases (order_id) WHERE order_id IS NOT NULL;

-- The latest observation of an order is read on every apply (the fingerprint skip).
CREATE INDEX order_observations_order_latest ON order_observations (order_id, id);
