-- Linking tables (AD-4 owner: linking; AD-14, D5, D6, D47, D56; Story 2.5).
-- A link request belongs to one customer for good (D6); HOUSE is the guest account (D5). Its
-- product snapshot (name, image, price, rates) is taken once when the link is made and never
-- resolved again at read time (D56). Request ids and share codes keep their live form, so every
-- link and share page already handed out keeps working.

-- One product as a network lists it. Rates are integer basis points of the price.
CREATE TABLE product_offers (
  product_offer_id TEXT PRIMARY KEY NOT NULL,
  shop_id TEXT,
  name TEXT,
  image_url TEXT,
  price INTEGER CHECK (price IS NULL OR price >= 0),
  shopee_rate_bps INTEGER CHECK (shopee_rate_bps IS NULL OR shopee_rate_bps >= 0),
  seller_rate_bps INTEGER CHECK (seller_rate_bps IS NULL OR seller_rate_bps >= 0),
  canonical_url TEXT,
  first_seen_at TEXT,
  updated_at TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('CUTOVER', 'LOOKUP'))
);
CREATE INDEX product_offers_canonical_url ON product_offers (canonical_url);

CREATE TABLE link_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers (customer_id),
  network TEXT CHECK (network IN ('shopee', 'accesstrade')),
  platform TEXT NOT NULL,
  channel TEXT,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'ISSUED', 'DELIVERED', 'CONVERTED', 'FAILED')),
  source_url TEXT NOT NULL,
  affiliate_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- The estimate quoted when the link was made, in dong; never the basis of cashback (D3).
  estimated_commission INTEGER CHECK (estimated_commission IS NULL OR estimated_commission >= 0),
  product_offer_id TEXT REFERENCES product_offers (product_offer_id),
  product_name TEXT,
  product_image_url TEXT,
  product_price INTEGER CHECK (product_price IS NULL OR product_price >= 0),
  shopee_rate_bps INTEGER CHECK (shopee_rate_bps IS NULL OR shopee_rate_bps >= 0),
  seller_rate_bps INTEGER CHECK (seller_rate_bps IS NULL OR seller_rate_bps >= 0),
  created_at TEXT,
  delivered_at TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('CUTOVER', 'REQUEST'))
);
CREATE INDEX link_requests_customer_id ON link_requests (customer_id);
CREATE INDEX link_requests_status ON link_requests (status);
CREATE INDEX link_requests_source_url ON link_requests (customer_id, source_url);

-- One share code per link request (AD-14): `/s/<code>`. New codes are 10 base62 characters; the
-- live 8-character codes are kept. A code never moves to another request.
CREATE TABLE share_codes (
  code TEXT PRIMARY KEY NOT NULL CHECK (length(code) IN (8, 10) AND code NOT GLOB '*[^A-Za-z0-9]*'),
  request_id TEXT NOT NULL UNIQUE REFERENCES link_requests (request_id),
  created_at TEXT
);
CREATE TRIGGER share_codes_unchanged BEFORE UPDATE ON share_codes
BEGIN SELECT RAISE(ABORT, 'a share code never changes'); END;
