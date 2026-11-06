# D66 (Daily link report to the DP Business group)

- Status: accepted
- Date: 2026-11-06
- Approved by: the project owner chose the day, the chat and the content (2026-11-06). The spec is
  `_bmad-output/implementation-artifacts/spec-operations-daily-link-report.md`. The wording in
  `packages/labels/vi/link-report.json` waits for the owner's approval with the rest of this change.

## Context

The owner could not see each morning who asked for links, how many products, and who succeeded or
failed.

## Decision

- Each day from 07:00 Vietnam time one report covers yesterday, 00:00 to 24:00 Vietnam time. It goes to
  `TELEGRAM_BUSINESS_CHAT_ID` and never falls back to the owner's chat. Without that chat there is no
  job and production logs the existing `orders.business_notice.chat_absent`.
- It counts the requests made that day (`origin` REQUEST) by their status when the report is written:
  success is DELIVERED or CONVERTED, failed is FAILED, waiting is QUEUED or ISSUED. One request is one
  product.
- The text is the totals, then one line per customer by most requests, each with products, successes
  and failures, the waiting count when it is not zero, and its failed products on the lines under it.
  A merged record counts under its survivor. The guest account is one guest line. A customer with no
  name, or an erased or unknown one, is the id alone, and the products of an erased or unknown customer
  are left out, as in D65. A failed product is its looked-up name, or the source link when the name is
  empty on one line.
- A job every 5 minutes writes one row per day in `daily_link_reports`. The first attempt stores the
  rendered messages, so a retry resumes the same text at the first unsent message. A message over
  4,096 characters of raw HTML splits at a line break, with all customers kept. A customer stays in
  one message with its failed products; only a block that alone is over the limit splits, between its
  lines. A name or product is cut to 200 characters, so one line always fits a message.
- Sends happen outside transactions. Each accepted message is counted in its own transaction. A failed
  send is retried on the next run and raises the owner alert `daily_link_report_failed` (high, under
  the kind's cooldown, no personal data).
- Only the latest yesterday is sent. When a new day's report starts, an older one not sent in full is
  dropped and its stored text cleared, and days with no report are not made up; both are counted in
  `operations.daily_link_report.earlier_days_skipped`. Nothing is backfilled, no customer is told, and
  nothing calls Shopee or Zalo.
- Log lines carry counts, HTTP statuses and error names only.

## Consequences

- `parts` holds names until the report is sent or dropped, and it is cleared only when the job runs:
  normally a little over a day at most, but as long as the job does not run if the server is down or
  the chat is unset. A customer erased in that time can still be named in the unsent report, and a
  request's status stays as it was when the text was written. The ledger's backups hold the same names
  as `customers` does anyway.
- A request still waiting at 07:00 that fails later appears in no report: that day's report counted it
  as waiting, and the next day's covers only requests made on its own day.
- A message accepted by Telegram just before a crash, or whose count cannot be written, is sent once
  more. Marking it before the send would avoid that but could lose the report, which must be retried
  until sent.
- The report's counts follow requests, not distinct products. A product asked again reuses its request
  (D6) and counts once, on the day it was first asked. A failed request is not reused, so asking again
  after a failure is a second request, and counts as a second product on the customer's line.
- A refused send (a removed bot, for example) logs `operations.daily_link_report.delivery_failed` on
  every run and keeps raising the alert until the day changes, when the report is dropped. The alert
  goes to the owner's chat, so it is not sent if the bot's Telegram access is lost altogether.
