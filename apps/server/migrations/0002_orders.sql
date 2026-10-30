-- Orders tables (AD-4 owner: orders; AD-5, AD-7, AD-8, AD-17, D4, D34; Story 2.3).
-- An order's status changes only through orders/domain/transition.ts. Amounts are whole dong,
-- stored as the network or the live system gave them and never recomputed: cashback is computed
-- once, at approval (AD-5), and an imported order keeps its stored cashback (D34). Times are AD-11
-- instants; an imported time that fit no conversion rule is NULL and listed in the import report.

CREATE TABLE orders (
  order_id TEXT PRIMARY KEY NOT NULL,
  -- The affiliate network the commission comes from; NULL only for an imported order whose live
  -- platform maps to no network (listed in the import report).
  network TEXT CHECK (network IN ('shopee', 'accesstrade')),
  -- The shop or merchant platform as recorded (shopee, tiktok, ...), kept from the live row.
  platform TEXT NOT NULL,
  customer_id TEXT REFERENCES customers (customer_id),
  -- The link request (sub_id2) the order came through; owned by linking, so no foreign key.
  request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('AWAITING_APPROVAL', 'FROZEN', 'APPROVED', 'REVERSED', 'PAID', 'REJECTED')),
  order_value INTEGER CHECK (order_value IS NULL OR order_value >= 0),
  estimated_commission INTEGER CHECK (estimated_commission IS NULL OR estimated_commission >= 0),
  approved_commission INTEGER CHECK (approved_commission IS NULL OR approved_commission >= 0),
  cashback INTEGER CHECK (cashback IS NULL OR cashback >= 0),
  rejection_reason TEXT,
  recorded_at TEXT,
  -- 1 when recorded_at was synthesized from the order SN prefix (D45, Story 2.1 AC4).
  recorded_at_approximate INTEGER NOT NULL DEFAULT 0 CHECK (recorded_at_approximate IN (0, 1)),
  approved_at TEXT,
  -- Set only by payout confirm and cleared only by payout void (AD-7); never on an unpaid order.
  paid_at TEXT,
  network_batch_id TEXT,
  settled_at TEXT,
  last_seen_in_report_at TEXT,
  -- CUTOVER: imported, amounts stored as live had them; REPORT: created by reconciliation.
  origin TEXT NOT NULL CHECK (origin IN ('CUTOVER', 'REPORT')),
  updated_at TEXT,
  CHECK (paid_at IS NULL OR status = 'PAID')
);
CREATE INDEX orders_customer_id ON orders (customer_id);
CREATE INDEX orders_status ON orders (status);
CREATE INDEX orders_request_id ON orders (request_id);

-- A paid order is never changed (D4, INV-2): only a payout void may take it out of PAID, and it
-- clears paid_at in the same statement. Its amounts and owner never change while it is paid.
CREATE TRIGGER orders_paid_amounts_unchanged BEFORE UPDATE ON orders
WHEN OLD.status = 'PAID' AND (
  NEW.cashback IS NOT OLD.cashback OR NEW.approved_commission IS NOT OLD.approved_commission
  OR NEW.customer_id IS NOT OLD.customer_id OR NEW.order_id IS NOT OLD.order_id
  OR (NEW.status = 'PAID' AND NEW.paid_at IS NOT OLD.paid_at)
  OR (NEW.status != 'PAID' AND NEW.paid_at IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT, 'a paid order never changes'); END;

-- The items of an order (R3). An imported order has exactly one item carrying the order's own
-- amounts; reconciliation stores the real items later without recomputing them (AD-8).
CREATE TABLE order_items (
  order_id TEXT NOT NULL REFERENCES orders (order_id),
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  item_id TEXT,
  name TEXT,
  image_url TEXT,
  quantity INTEGER CHECK (quantity IS NULL OR quantity >= 0),
  price INTEGER CHECK (price IS NULL OR price >= 0),
  estimated_commission INTEGER CHECK (estimated_commission IS NULL OR estimated_commission >= 0),
  approved_commission INTEGER CHECK (approved_commission IS NULL OR approved_commission >= 0),
  -- The network status map's value for the item (AWAITING, APPROVED, CANCELLED, UNKNOWN); NULL when imported.
  network_status TEXT CHECK (network_status IS NULL OR network_status IN ('AWAITING', 'APPROVED', 'CANCELLED', 'UNKNOWN')),
  origin TEXT NOT NULL CHECK (origin IN ('CUTOVER', 'REPORT')),
  PRIMARY KEY (order_id, line_no)
);

-- Every status change with its actor (AD-17): insert-only.
CREATE TABLE order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders (order_id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  changed_at TEXT NOT NULL
);
CREATE INDEX order_status_history_order_id ON order_status_history (order_id);
CREATE TRIGGER IF NOT EXISTS order_status_history_no_update BEFORE UPDATE ON order_status_history BEGIN SELECT RAISE(ABORT, 'insert_only: order_status_history'); END;
CREATE TRIGGER IF NOT EXISTS order_status_history_no_delete BEFORE DELETE ON order_status_history BEGIN SELECT RAISE(ABORT, 'insert_only: order_status_history'); END;

-- Every normalized report row seen for an order (AD-7, AD-8): insert-only. The fingerprint of
-- the last applied row lets a repeated report skip the order. Empty after the import.
CREATE TABLE order_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders (order_id),
  observed_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  observation TEXT NOT NULL,
  applied INTEGER NOT NULL CHECK (applied IN (0, 1))
);
CREATE INDEX order_observations_order_id ON order_observations (order_id);
CREATE TRIGGER IF NOT EXISTS order_observations_no_update BEFORE UPDATE ON order_observations BEGIN SELECT RAISE(ABORT, 'insert_only: order_observations'); END;
CREATE TRIGGER IF NOT EXISTS order_observations_no_delete BEFORE DELETE ON order_observations BEGIN SELECT RAISE(ABORT, 'insert_only: order_observations'); END;

-- Settlement periods (D54): a network month whose approvals count the 10% withheld tax unless
-- staff unmark it. The import adds one per (network, Vietnam month of approval) of the imported
-- approved and paid orders, withheld, because the live split always withheld it.
CREATE TABLE settlement_periods (
  network TEXT NOT NULL CHECK (network IN ('shopee', 'accesstrade')),
  period_month TEXT NOT NULL CHECK (period_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  withheld INTEGER NOT NULL DEFAULT 1 CHECK (withheld IN (0, 1)),
  origin TEXT NOT NULL CHECK (origin IN ('CUTOVER', 'STAFF')),
  PRIMARY KEY (network, period_month)
);
