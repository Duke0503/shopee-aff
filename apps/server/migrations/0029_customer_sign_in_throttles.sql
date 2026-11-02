-- The doubling sign-in delay of AD-18 for customers (AD-4 owner: identity; FR-9, NFR-5; Story 7.2).
-- A delay keyed by the code alone would let anyone keep any customer locked out, so the wait is
-- kept per (code as the server compares it, client key): the client key is an HMAC of the
-- caller's address, never the address itself. A code that belongs to nobody waits exactly like a
-- real one, so the answer never tells which codes exist. Every throttle lives here; the columns
-- customers.failed_sign_ins and customers.locked_until (0001, carried from the live system) are
-- no longer read. /matkhau deletes the customer's rows; rows quiet for 24 hours are pruned by
-- the hourly sign-in job, which also caps the table.
CREATE TABLE customer_sign_in_throttles (
  customer_code TEXT NOT NULL CHECK (customer_code GLOB 'DP[0-9]*' AND length(customer_code) BETWEEN 3 AND 11),
  client_key TEXT NOT NULL CHECK (length(client_key) = 32 AND client_key NOT GLOB '*[^0-9a-f]*'),
  failures INTEGER NOT NULL CHECK (failures >= 1),
  locked_until TEXT,
  last_failed_at TEXT NOT NULL,
  PRIMARY KEY (customer_code, client_key)
);
CREATE INDEX customer_sign_in_throttles_last_failed ON customer_sign_in_throttles (last_failed_at);

-- One client's failed customer sign-ins across every code, in a 10-minute window: 20 failures
-- make that client wait until the window ends, which bounds spraying one password over many codes
-- and the rows a single client can add above.
CREATE TABLE customer_sign_in_clients (
  client_key TEXT PRIMARY KEY NOT NULL CHECK (length(client_key) = 32 AND client_key NOT GLOB '*[^0-9a-f]*'),
  window_started_at TEXT NOT NULL,
  failures INTEGER NOT NULL CHECK (failures >= 1),
  locked_until TEXT
);
