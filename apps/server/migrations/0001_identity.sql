-- Identity tables (AD-4 owner: identity; AD-23, AD-17, D6, D10, D13, D26; Story 2.2).
-- customer_id is the live id carried in sub_id1 and never changes. customer_code is DP plus five
-- digits, issued once from customer_code_counter, which only goes up. Staff and HOUSE have no code.
-- The guest account is the row with role HOUSE (D5): the one place guest status is decided.
-- Times are AD-11 instants; an imported time that fit no conversion rule is NULL and listed in the
-- import report (D45), which is why the imported time columns allow NULL.

CREATE TABLE customers (
  customer_id TEXT PRIMARY KEY NOT NULL,
  customer_code TEXT,
  role TEXT NOT NULL CHECK (role IN ('USER', 'ADMIN', 'EMPLOYEE', 'HOUSE')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED', 'MERGED', 'ERASED')),
  zalo_user_id TEXT,
  private_chat_id TEXT,
  display_name TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  sort_key TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  password_set_at TEXT,
  failed_sign_ins INTEGER NOT NULL DEFAULT 0 CHECK (failed_sign_ins >= 0),
  locked_until TEXT,
  last_sign_in_at TEXT,
  created_at TEXT
);
CREATE UNIQUE INDEX customers_customer_code ON customers (customer_code) WHERE customer_code IS NOT NULL;
CREATE UNIQUE INDEX customers_zalo_user_id ON customers (zalo_user_id) WHERE zalo_user_id IS NOT NULL AND zalo_user_id != '';
CREATE INDEX customers_sort_key ON customers (sort_key);

-- Old Zalo ids and retired codes that resolve to the surviving customer (AD-23).
CREATE TABLE customer_aliases (
  alias TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers (customer_id),
  created_at TEXT,
  note TEXT
);
CREATE INDEX customer_aliases_customer_id ON customer_aliases (customer_id);

-- One row; `last` is the highest number ever issued and never goes down (FR-8).
CREATE TABLE customer_code_counter (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  last INTEGER NOT NULL CHECK (last >= 0)
);
CREATE TRIGGER customer_code_counter_never_down BEFORE UPDATE ON customer_code_counter
WHEN NEW.last < OLD.last
BEGIN SELECT RAISE(ABORT, 'customer_code_counter: last never goes down'); END;
CREATE TRIGGER customer_code_counter_no_delete BEFORE DELETE ON customer_code_counter
BEGIN SELECT RAISE(ABORT, 'customer_code_counter: never deleted'); END;
-- A code issued once is never handed to another customer, nor taken while it is an alias.
CREATE TRIGGER customers_code_not_alias BEFORE INSERT ON customers
WHEN NEW.customer_code IS NOT NULL AND EXISTS (SELECT 1 FROM customer_aliases WHERE alias = NEW.customer_code)
BEGIN SELECT RAISE(ABORT, 'customer code is a retired alias'); END;
CREATE TRIGGER customers_code_not_alias_on_update BEFORE UPDATE OF customer_code ON customers
WHEN NEW.customer_code IS NOT NULL AND EXISTS (SELECT 1 FROM customer_aliases WHERE alias = NEW.customer_code)
BEGIN SELECT RAISE(ABORT, 'customer code is a retired alias'); END;
CREATE TRIGGER customers_code_unchanged BEFORE UPDATE OF customer_code ON customers
WHEN OLD.customer_code IS NOT NULL AND NEW.customer_code IS NOT OLD.customer_code
BEGIN SELECT RAISE(ABORT, 'customer code never changes'); END;
CREATE TRIGGER customers_id_unchanged BEFORE UPDATE OF customer_id ON customers
WHEN NEW.customer_id IS NOT OLD.customer_id
BEGIN SELECT RAISE(ABORT, 'customer id never changes'); END;

-- One bank account per customer, saved with consent (FR-10). The fingerprint is HMAC-SHA-256 of
-- the normalised number under the fingerprint key; audit entries carry only it (AD-17).
CREATE TABLE bank_accounts (
  customer_id TEXT PRIMARY KEY NOT NULL REFERENCES customers (customer_id),
  bank_name TEXT,
  account_number TEXT NOT NULL,
  holder_name TEXT,
  fingerprint TEXT NOT NULL,
  consent_at TEXT,
  pending_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (pending_confirmation IN (0, 1))
);
CREATE INDEX bank_accounts_fingerprint ON bank_accounts (fingerprint);
