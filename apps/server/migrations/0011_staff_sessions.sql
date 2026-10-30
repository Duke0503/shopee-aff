-- Staff and sessions (AD-4 owner: identity; AD-18, D48, FR-24, INV-8; Story 4.2).
-- Staff are seeded by command (Story 4.20); there is no staff screen in v1. A staff member is an
-- ADMIN or an EMPLOYEE. The root admin is the one row with is_root = 1: it stays an active admin
-- and is never deleted. Passwords are argon2id hashes in PHC form; nothing stores a password.
CREATE TABLE staff (
  staff_id TEXT PRIMARY KEY NOT NULL CHECK (staff_id GLOB '[a-z0-9]*' AND staff_id NOT GLOB '*[^a-z0-9-]*'),
  -- The sign-in name, lowercase.
  username TEXT NOT NULL CHECK (username = lower(username) AND length(username) BETWEEN 3 AND 64),
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'EMPLOYEE')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  is_root INTEGER NOT NULL DEFAULT 0 CHECK (is_root IN (0, 1)),
  password_hash TEXT NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  password_set_at TEXT NOT NULL,
  last_sign_in_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (is_root = 0 OR (role = 'ADMIN' AND status = 'ACTIVE'))
);
CREATE UNIQUE INDEX staff_username ON staff (username);
CREATE UNIQUE INDEX staff_one_root ON staff (is_root) WHERE is_root = 1;
CREATE TRIGGER staff_root_kept BEFORE UPDATE OF is_root, role, status ON staff
WHEN OLD.is_root = 1 AND (NEW.is_root != 1 OR NEW.role != 'ADMIN' OR NEW.status != 'ACTIVE')
BEGIN SELECT RAISE(ABORT, 'the root admin is never demoted or disabled'); END;
CREATE TRIGGER staff_root_not_deleted BEFORE DELETE ON staff
WHEN OLD.is_root = 1
BEGIN SELECT RAISE(ABORT, 'the root admin is never deleted'); END;

-- The doubling sign-in delay of AD-18 for staff, per submitted name and Cloudflare Access identity
-- (the JWT's subject id, never its email). Keyed by the name as typed, so an unknown or disabled
-- name waits exactly like a real one and the answer never tells which names exist; keyed by the
-- Access identity too, so one identity's failures never delay another's sign-in to the same
-- account. A success removes its row.
CREATE TABLE staff_sign_in_throttles (
  username TEXT NOT NULL CHECK (length(username) BETWEEN 1 AND 64),
  access_subject TEXT NOT NULL CHECK (length(access_subject) BETWEEN 1 AND 128),
  failures INTEGER NOT NULL CHECK (failures >= 1),
  locked_until TEXT,
  last_failed_at TEXT NOT NULL,
  PRIMARY KEY (username, access_subject)
);

-- One row per signed-in browser, customer or staff (AD-18). Only the SHA-256 of the random 32-byte
-- token is stored, as 64 hex characters; the token itself lives only in the HttpOnly cookie. A
-- session belongs to exactly one customer or one staff member, as its kind says, so a customer
-- session can never pass for a staff one. Ending a session sets ended_at; rows are not deleted.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  kind TEXT NOT NULL CHECK (kind IN ('CUSTOMER', 'STAFF')),
  customer_id TEXT REFERENCES customers (customer_id),
  staff_id TEXT REFERENCES staff (staff_id),
  created_at TEXT NOT NULL,
  -- NULL: valid until signed out or ended by a new password (a customer's trusted phone, FR-9).
  expires_at TEXT,
  ended_at TEXT,
  end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('SIGNED_OUT', 'NEW_PASSWORD', 'STAFF_DISABLED')),
  CHECK ((kind = 'CUSTOMER' AND customer_id IS NOT NULL AND staff_id IS NULL) OR (kind = 'STAFF' AND staff_id IS NOT NULL AND customer_id IS NULL)),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE INDEX sessions_customer_id ON sessions (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX sessions_staff_id ON sessions (staff_id) WHERE staff_id IS NOT NULL;
CREATE TRIGGER sessions_owner_unchanged BEFORE UPDATE OF token_hash, kind, customer_id, staff_id, created_at ON sessions
BEGIN SELECT RAISE(ABORT, 'a session never changes its token or owner'); END;
