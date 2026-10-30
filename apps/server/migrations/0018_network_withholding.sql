-- The withholding the networks actually applied (AD-4 owner: orders; FR-13, D54, D59; Stories 4.18
-- and 4.21). A network payout batch shows whether its tax was withheld (packages/money reads it
-- from the gross and what was paid). Orders are approved before the batch that pays them exists,
-- so an approval takes the latest batch's withholding of its network as the estimate; a staff mark
-- on the period (settlement_periods, origin STAFF) overrides it, and without either a Shopee period
-- is withheld (D54). One row per network: the latest batch, by the network's creation time.
CREATE TABLE network_withholding (
  network TEXT PRIMARY KEY NOT NULL CHECK (network IN ('shopee', 'accesstrade')),
  withheld INTEGER NOT NULL CHECK (withheld IN (0, 1)),
  network_payout_id TEXT NOT NULL CHECK (network_payout_id != ''),
  -- The batch's creation time at the network.
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
