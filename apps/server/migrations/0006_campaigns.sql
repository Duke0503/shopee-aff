-- Campaign tables (AD-4 owner: campaigns; AD-11, AD-24, D22, D35, D55, M14; Story 2.4).
-- A campaign gives a fixed number of bonus slots to the earliest orders recorded inside its
-- window. The window is two AD-11 instants, start inclusive and end exclusive (D22); staff type
-- it in Vietnam time. Slot mechanics come with the campaign stories; the cutover imports every
-- campaign and award as the live system left it, and imported awards are honoured (M14).
-- Times that fit no conversion rule are NULL and listed in the import report.

CREATE TABLE campaigns (
  campaign_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  slots INTEGER NOT NULL CHECK (slots >= 0),
  bonus INTEGER NOT NULL CHECK (bonus >= 0),
  min_order_value INTEGER NOT NULL DEFAULT 0 CHECK (min_order_value >= 0),
  -- The shop platforms whose orders can win a slot, comma separated as live stored them.
  platforms TEXT NOT NULL DEFAULT '',
  -- Customer ids that never win a slot, comma separated.
  excluded_customers TEXT NOT NULL DEFAULT '',
  -- Slots one customer may hold; 0 is no cap.
  per_customer INTEGER NOT NULL DEFAULT 0 CHECK (per_customer >= 0),
  -- 0 when staff stopped the live campaign: it gives no new slot whatever its window says.
  accepts_awards INTEGER NOT NULL DEFAULT 1 CHECK (accepts_awards IN (0, 1)),
  created_at TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('CUTOVER', 'STAFF')),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

-- One award per slot (status-flows.md section 5): HELD -> CONFIRMED -> PAID, or VOID. A HELD award
-- is never payable, and one whose order is FROZEN is suspended (D55). Imported awards keep the
-- live award id, so a dedup key the live system already used still names the same award.
CREATE TABLE campaign_awards (
  award_id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES campaigns (campaign_id),
  customer_id TEXT NOT NULL REFERENCES customers (customer_id),
  order_id TEXT NOT NULL REFERENCES orders (order_id),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('HELD', 'CONFIRMED', 'PAID', 'VOID')),
  created_at TEXT,
  confirmed_at TEXT,
  paid_at TEXT,
  voided_at TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('CUTOVER', 'RULE'))
);
-- One live slot per order and campaign, as live enforced it.
CREATE UNIQUE INDEX campaign_awards_one_live_slot ON campaign_awards (campaign_id, order_id) WHERE status != 'VOID';
CREATE INDEX campaign_awards_order_id ON campaign_awards (order_id);
CREATE INDEX campaign_awards_customer_id ON campaign_awards (customer_id);
