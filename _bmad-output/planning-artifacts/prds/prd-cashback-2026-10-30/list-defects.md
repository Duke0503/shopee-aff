# Catalogue of list defects in the current web (2026-10-30)

Code audit of `web/src` and `src/cashback/web/dashboard.py` on `main-v2` (same code as production).
Each line becomes a regression test for FR-37 and FR-38. Severity: high = wrong data shown or a
wrong action possible.

## Root causes

1. Timestamps are stored in three formats (`+07:00`, `+00:00`, naive UTC) and compared as text;
   SQLite date functions convert to UTC. No Vietnam business-day helper.
2. Money is derived in about six places (SQL and Python, per platform or not, with or without
   bonus); totals and rows use different formulas.
3. Sorting uses a different expression from the value displayed.
4. No shared status vocabulary: "ready", "has bank", "settled" have two or three definitions.
5. Payment actions trust the browser: typed amounts, no server check of status or paid time.
6. Summaries come from a different set than the table (`LIMIT 100`, `LIMIT 3`, unfiltered badges,
   filtered totals labelled "All").
7. Search is not normalised: ASCII-only `LOWER()`, no diacritic folding, raw JSON searched,
   wildcards not escaped, different fields per screen.
8. List state is local and copied per view: no URL state, no debounce, no page clamping, swallowed
   errors.
9. Placeholder numbers shown as real data.

## Orders

- high: the end date excludes its own day (text comparison of `T` vs space); "Today" and "Yesterday"
  return nothing (`dashboard.py:2017`).
- high: "commission" sorts by the estimate while showing the approved figure (`dashboard.py:2026`).
- high: "cashback" sorts by the stored value while blanks are filled later in Python (`:2028`, `:2090`).
- high: Vietnamese search does not fold case or diacritics (`:1984`, `:1994`).
- medium: search runs over raw estimate JSON and does not escape `%` and `_` (`:1994`).
- high: one-click "refund" marks an order paid with no confirmation or amount, also for HOUSE
  (`OrdersView.tsx:716`).
- medium: "All (N)" shows the filtered count; status chips have no counts (`OrdersView.tsx:315`).
- medium: two different filters are both labelled "all platforms" (`OrdersView.tsx:384`, `:270`).
- medium: status sorts alphabetically, not in lifecycle order; names use binary collation (`:2033`).
- medium: the page is not clamped after the result shrinks ("41 - 40 of 40") (`PaginationBar.tsx:24`).
- medium: no debounce and no kept previous data; the table flashes a spinner on every key.
- low: short dates drop the year (`web/src/lib/format.ts:30`).
- medium: profit always deducts the Shopee fee, also for TikTok (`dashboard.py:349`).

## Payments

- high: confirm marks any listed order paid, including awaiting and already-paid (`dashboard.py:2903`).
- high: "select all" includes awaiting orders; the typed amount is not checked (`PaymentsView.tsx:1121`).
- high: the QR amount falls back to unsettled, then awaiting money (`dashboard.py:2759`).
- high: desktop and phone show different amounts for the same customer (`PaymentsView.tsx:676`, `:530`).
- high: "total paid" counts only the last 100 transfers (`dashboard.py:2628`).
- high: the bonus "paid" card shows unpaid bonuses (`PaymentsView.tsx:286`).
- medium: the "show awaiting orders (test)" toggle is on by default (`PaymentsView.tsx:70`).
- medium: cards and badges use the unfiltered set while the table is filtered.
- medium: "needs bank" filter and card count different people.
- medium: "settled" means fully settled; partly settled customers are hidden.
- high: the dialog keeps a stale copy while the list refetches every 30 seconds; no double-pay guard.
- medium: only one campaign award per order is kept.
- medium: search does not fold diacritics or cover the Zalo id.

## Customers (admin)

- high: list and detail dialog use different money formulas for the same customer (`dashboard.py:1797`, `:2461`).
- high: "ready" counts unsettled approved orders, unlike Payments (`:1799`).
- medium: the code column sorts by Zalo id; "last web visit" falls back to the join date; bot
  activity uses text MAX over mixed formats; "has bank" checks only the number; a badge capped at 3
  reads as a total.

## Customer detail dialog

- high: recording a transfer with no order ids pays every approved order against a typed amount
  (`dashboard.py:2579`).
- high: the previous customer's amount carries over to the next customer (`UserDetailDialog.tsx:85`).
- medium: after a transfer, Payments and metrics are not refreshed; link counts capped at 100 read as totals.

## Products, logs, staff

- high: request and order counts are recomputed after sorting with different rules (`dashboard.py:2211`).
- high: "last requested" sorts by update time (`:2147`).
- high: log times mix naive UTC and offset stamps; they sort wrongly and show 7 hours off.
- medium: errors are swallowed and shown as "no rows"; customer sorts use ids while names are shown;
  role and status sort by code.

## Campaigns

- high: start and end are typed in Vietnam time, stored without a zone, read as UTC: campaigns open
  and close 7 hours late (`CampaignsView.tsx:510`, `ledger/campaigns.py:80`).
- low: the expanded campaign is hard-coded.

## Dashboard

- high: "today" and "month" are computed in UTC, so 00:00 to 07:00 Vietnam time lands on the wrong
  day; the trend chart uses local time and disagrees with the cards.
- high: campaign bonuses are not filtered by period but are subtracted from period profit.
- high: all-time numbers stay on screen under the new period label while it loads.
- high: made-up fallback numbers (37 members, 15 users, 15.2%) are shown as real.
- medium: top customers include HOUSE; approval rate defaults to 100%; empty days are skipped.

## Customer site

- medium: sortable headers that do nothing (`MyOrders.tsx:155`).
- medium: the date column mixes paid, approved and recorded dates per row.
- high: balance cards include bonuses that rows never show; the awaiting card applies the Shopee fee
  to TikTok; "ready" includes unsettled orders the desk will not pay.
- low: "automatic transfer" is false; Vietnamese hard-coded in the component.
