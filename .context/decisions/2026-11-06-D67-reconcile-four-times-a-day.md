# D67 (Reconciliation runs four times a day)

- Status: accepted
- Date: 2026-11-06
- Approved by: the project owner asked for three or four runs a day, because Shopee kept showing a
  captcha (2026-11-06).

## Context

The conversion report was read every hour through the affiliate browser. Shopee showed a captcha again
about one hour after the owner cleared one. Whether the read rate causes it is not proven.

## Decision

- The reconcile job runs every 6 hours, four times a day, plus 3 minutes after each server start.
- `reconciliation_failed` for a stale run now fires after 8 hours without a success, not 3.
- The nightly sweep at 02:00 and the daily payout record read are unchanged.

## Consequences

- A new order, approval or rejection can reach the ledger, the customer and the DP Business group up to
  6 hours later. No money rule changes: each run still covers the overlapping window.
- Two failed runs in a row now take 6 hours to raise `reconciliation_failed`. A captcha still raises
  `bridge_captcha` at the first failed read.
- After the owner clears a captcha, the next read can be up to 6 hours away.
