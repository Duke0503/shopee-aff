# Network report fixtures

Golden cases for the network status maps and report readers (Story 1.11, AD-22, D38). Each
file holds raw report data in the exact shape the network sends and what it must produce:
the mapped statuses, the commission parts in whole dong, and the report signal (await,
approve, cancel or freeze). `apps/server/tests/network-golden.test.ts` runs every case
through the linking module's readers and the orders module's `reportSignal`.

| File | Rule | What a case holds |
|---|---|---|
| `shopee-status-map.json` | `statusMap` | one raw Shopee status string and its meaning |
| `shopee-conversions.json` | `shopeeConversion` | one item of `/api/v3/report/list` `data.list` (a conversion with its `orders` and `items`) |
| `accesstrade-status-map.json` | `accesstradeLine` | one line's `status` and `is_confirmed` and its meaning |
| `accesstrade-transactions.json` | `accesstradeTransactions` | the `data` lines of `/v1/transactions`, grouped per `transaction_id` |

## Provenance

Every case carries `"provenance"`:

- `synthetic-from-code`: written from the field shapes and status strings the live readers
  use (`src/cashback/shopee/report_reader.py`, `src/cashback/providers/accesstrade_reconciler.py`)
  and the measured figures in `tests/test_report_reader.py`. Every case today is synthetic.
- `real-anonymised`: a real report row with personal data removed.

**Open:** Story 1.11 asks for golden tests on real report rows (AC1 to AC3, code.md §4). That
criterion stays open until the owner adds `real-anonymised` cases; the server test shows it
as a `todo` until then.

## Adding real rows (owner)

1. Copy rows from the live system: for Shopee, one element of `data.list` from the report page
   (the browser bridge result, or the dashboard's network tab); for AccessTrade, the lines of
   one or more transactions from `/v1/transactions`. Pick at least one row each for unpaid,
   paid, completed, validated, cancelled and invalid (Shopee), and for status 0, 1 confirmed,
   1 unconfirmed and 2 (AccessTrade), plus any status you have never seen before.
2. Remove personal data before the file is saved anywhere in the repository: replace sub_ids
   with `C0001`-style and `R0001`-style values, replace order numbers and checkout ids with
   `REAL0001`-style ids, replace item names with `Item 1`, and delete any buyer, phone,
   address or shop field. Keep every status field and every amount exactly as sent.
3. Add the case to the matching file with `"provenance": "real-anonymised"`, a `name`, the
   `story` it covers, the raw data as `input` and the `expected` result you read on the
   network's own page (the status shown and the commission in dong).
4. Run `pnpm test`. A real row that disagrees with the map is a finding: record it and
   change the map (and status-flows.md if a new status appears), never the expected value.
