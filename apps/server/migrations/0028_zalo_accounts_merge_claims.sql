-- The assistant's Zalo accounts and customers' claims of an old code (AD-4 owner: identity; FR-11,
-- FR-36, D9, D10; Story 6.11). Zalo ids differ per viewing account, so connecting a new account
-- registers known customers again; `zalo_accounts` keeps the first time the assistant reported each
-- account it runs on, and the latest one is when the switch happened. `merge_claims` records a
-- customer who wrote an older customer code in the private chat: a proposal for the admin merge
-- command, never a merge by itself.
CREATE TABLE zalo_accounts (
  account_id TEXT PRIMARY KEY NOT NULL,
  first_seen_at TEXT NOT NULL
);

CREATE TABLE merge_claims (
  claimant_id TEXT NOT NULL REFERENCES customers (customer_id),
  claimed_id TEXT NOT NULL REFERENCES customers (customer_id),
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (claimant_id, claimed_id),
  CHECK (claimant_id != claimed_id)
);
