# Shadow run (cutover sign-off)

The shadow run tells the owner what the new reconciliation would do to every live order before
the cutover, without changing anything (D44, Stories 2.8 and 2.9). It reads a copy of the live
ledger and saved network reports, applies the new rules in memory (attribution, report signal,
`transition`, the split), and writes a report the owner signs off. It writes nothing to the
live copy and makes no call to Shopee.

## What it does

1. Reads every report file first, once (its checksum is of the bytes read). A file that holds
   fewer rows than its own total fails with `report_page_cap`; a page saved twice with
   `report_duplicate_page`; numbered pages that do not run from 1 without a gap with
   `report_page_missing`. Nothing else happens after such a failure.
2. Opens the live ledger copy read-only and refuses the production file itself
   (`LIVE_LEDGER_PATH`). It imports the copy into a throwaway in-memory ledger with the cutover
   import's readers, so it judges exactly what the cutover would import.
3. Applies each report row to its order. A PAID order never changes state; a cancel after payout
   shows only as a would-be clawback. An awaiting or approved unpaid order missing from the report
   would be FROZEN with a review case; one recorded after the report window ends is listed as
   not judged and left as it is.
4. Writes `shadow-report.json` and `shadow-report.md` into the out folder. The same inputs always
   give byte-identical files. The live copy's checksum is checked before and after.

## Before you start

- A copy of the live database (`DB_PATH`, by default `cashback.db` in the live folder), taken while the live
  system is stopped or with SQLite's backup command. Never point the run at the live file.
- `~/.config/cashback/dev.env` (or `prod.env` with `CASHBACK_ENV=prod`) with `INTERNAL_TOKEN`
  and `LIVE_LEDGER_PATH` set to the absolute path of the live production file, so it is refused.
- The Shopee report, one of:
  - the conversion report CSV from affiliate.shopee.vn/report/conversion_report (choose
    English or Vietnamese, switch on the additional information with the sub_ids). Status
    words are read as the live importer reads them (`Pending`, `Validated`, `Cancelled`,
    `Returned`, `Đã hủy`, `Chờ duyệt`, ...); an unknown word freezes the order. Amounts must be
    plain (`27.000`, `27,000`, `27000.50`); anything else freezes the order. The columns are guessed
    from the headers; give `--shopee-mapping report_mapping.json` (the live `cashback
    inspect-report` file) when the guess is wrong. Add an item status and an item id column
    when the export offers them: a cancelled item is then seen.
  - or the report page answers saved as JSON (`{ "data": { "list": [...], "total": N } }`, one
    per page, in an array). This is the better source: every order and item of a conversion
    is kept.
- The AccessTrade report: the `/v1/transactions` answers saved as JSON
  (`{ "data": [...], "total": N }`, one per page, in an array), or `--accesstrade-api` with
  `ACCESSTRADE_API_KEY` in the env file (read-only, at most 30 days, at most 10 pages of 100).
- Cover the same period in both reports. By default the report window runs from the earliest to
  the latest purchase in each report; `--window-from YYYY-MM-DD` and `--window-to YYYY-MM-DD`
  (Vietnam dates, both whole days) set it. With `--accesstrade-api` the AccessTrade window is
  `--since` to the end of `--until`, the period fetched.

## Run

```bash
pnpm --filter @cashback/server shadow:run \
  --live-copy D:/cutover/cashback-copy.db \
  --shopee D:/cutover/shopee-report.json \
  --accesstrade D:/cutover/accesstrade-transactions.json \
  --out D:/cutover/shadow-2026-11-01
```

It prints one JSON line: `ok`, the two report paths, the paid parity result, the number of
orders with a difference and of customers live would have overpaid. Exit 1 names the refusal
(`report_page_cap`, `report_mapping_incomplete`, `live_production_file`, `signed_off`, ...);
exit 2 is a usage error. A failed run writes no report.

## Read the report

`shadow-report.md` holds, in order:

- **Verdict**: paid parity (must be PASS: paid cashback, payouts and paid bonuses match the live
  copy to the dong per customer), orders with a difference, customers live would have overpaid.
- **Differences by reason**, with the payable, waiting and clawback totals per reason.
- **Customers live would have overpaid**: live payable above the shadow payable.
- **Orders not judged**: no report for the network, or recorded after the report window ends.
- **Live orphan orders owed**: approved unpaid live orders whose customer id is no customer
  (a merged alias or a gone id). Live payouts never list them, so they are not in live payable;
  the new ledger owes them to the survivor.
- **Per customer**: live payable (`LIVE_PAYABLE_SQL`, exactly the live payout list: approved,
  unpaid, an existing customer, plus confirmed bonuses), shadow payable (confirmed bonuses only,
  after would-be clawbacks), waiting on both sides (each awaiting order's estimate through the split
  with 10% withheld), paid on both sides.
- **Orders with a difference**, grouped by reason: live state and cashback, new state and
  cashback, the payable and waiting difference in dong, clawback, review cases.

The reasons that point at the cancelled-but-payable incident come first:

| Reason | Meaning |
|---|---|
| live first-item status ignored an order-level cancel | Shopee cancelled the order, live read the first item's status and kept it owed |
| live counted the commission of a cancelled item | A cancelled item's commission was in the live amount |
| live rejected the whole order on its cancelled first item | Other items are still live; a wrong-rejection review case |

`shadow-report.json` holds the same data, every order included, for checks by script.

## Sign off

When the differences are understood, record the sign-off:

```bash
pnpm --filter @cashback/server shadow:sign-off --out D:/cutover/shadow-2026-11-01 --name "Owner name"
```

It writes `shadow-sign-off.json` with the name, the time and the checksums of both report files.
A folder can be signed once, and a signed folder is never written over: a new run goes to a new
folder.
