---
title: 'Daily link report to the DP Business group at 07:00'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '2387ed4ca15b15880ace4ccc96565a228394929b'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The owner cannot see each morning who asked for links, how many products, and who succeeded or failed.

**Approach:** Each day from 07:00 Vietnam time one report covering yesterday goes to the DP Business group, sent once a day and retried until sent.

## Boundaries & Constraints

**Always:**
- Owner decisions (2026-11-06): yesterday means 00:00 to 24:00 Vietnam time; the chat is `TELEGRAM_BUSINESS_CHAT_ID`; the report gives totals, then one line per customer, with the failed product names.
- Requests made that day (`origin` REQUEST), counted by their status when the report is written: success is DELIVERED or CONVERTED, failed is FAILED, waiting is QUEUED or ISSUED.
- One report per day however often the job runs or the server restarts. Sends happen outside transactions.
- A message over Telegram's 4,096 characters splits at a line break, with all customers kept. Names are escaped. Log lines carry counts only.
- All text lives in `packages/labels/vi/`.

**Never:**
- No backfill of earlier days. No customer message. No new Shopee or Zalo call. No merge or deploy before the owner approves.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal day | Requests yesterday | Totals, then customers by most requests, each with products, successes, failures and failed product names | Failed send retried on the next run |
| Quiet day | No requests | A short "no requests" report | As above |
| Before 07:00 | 06:59 | Nothing | N/A |
| Server down at 07:00 | Starts at 09:00 | Report goes out at the next run | N/A |
| After 24:00 unsent | A day never sent | Only the latest yesterday is sent | Logged |
| Long report | Over 4,096 characters | Several messages, in order, none repeated on retry | Retry resumes at the unsent part |
| No product name | Lookup found none | The source link's product stands as a fallback label | N/A |
| Web guest | Request with no named customer | Shown as a guest line | N/A |
| Chat unset | No chat id | No job | Existing `chat_absent` error |

</frozen-after-approval>

## Code Map

- `apps/server/src/modules/operations/` -- owns the report; may import identity and linking. Add a query for the counts in `linking`, exported through its index, and the job here.
- `apps/server/src/reconcile/payout-record.job.ts` -- the once-a-day-from-a-time pattern to follow.
- `apps/server/migrations/0037_daily_link_reports.sql`, `apps/server/src/modules/operations/schema.ts` -- `daily_link_reports` (report_date primary key, parts as JSON, parts_sent, sent_at). The parts are written once, on the first attempt, so a retry resumes the same text; they hold names, so clear them when the report is sent.
- `apps/server/src/platform/jobs/job-schedules.ts`, `apps/server/src/health/owner-jobs.ts` -- every 5 minutes, with the business sender beside `businessNoticeJobs`.
- `packages/labels/vi/link-report.json` -- the wording.
- `apps/server/tests/module-schemas.test.ts`, `tests/job-scheduler.test.ts`, `tests/owner-alerts.test.ts` -- exact lists to extend.

## Tasks & Acceptance

**Execution:**
- [x] Migration, schema, counts query -- the data.
- [x] `apps/server/src/modules/operations/daily-link-report.job.ts`, `daily-link-report.query.ts`, `packages/labels/vi/link-report.json` -- text, splitting, once-a-day delivery.
- [x] Schedules and `owner-jobs.ts` -- wire it.
- [x] `apps/server/tests/daily-link-report.test.ts` -- cover the matrix; extend exact-list tests.
- [x] `docs/operations/message-parity.md`, `.context/decisions/2026-11-06-D66-daily-link-report.md` -- record it.

**Acceptance Criteria:**
- Given a restart after a report was sent, when the job runs, then nothing is sent again that day.
- Given a request at 23:59 and one at 00:01 Vietnam time, when the report runs, then each counts on its own day.

## Implementation Notes

Implemented uncommitted in this worktree; awaits owner review. Choices the spec left open are recorded in D66: failed products sit on the lines under their customer and stay in one message with it when they fit; the products of an erased or unknown customer are left out, as in D65; a customer line adds its waiting count when it is not zero; a failed send raises the owner alert `daily_link_report_failed`.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| A split can leave failed products with no customer above them | medium | `splitReportLines` splits at any line | patch |
| A failed send raises no alert, so a report can be lost silently | medium | Only a warn line; the same silence hid the order notice gap | patch |
| An unresolved owner shows a stored name and products | medium | `ledgerOwnerOf` null is not treated as erased, unlike `alert-render.query.ts:34` | patch |
| A product name of control characters prints a blank line | low | `trim` keeps it, `oneLine` empties it; direct correction | patch |
| A customer line's numbers do not add up | low | Waiting is left out; adding it when not zero is a direct correction | patch |
| Docs: production runbook row, log events, D66's name retention claim | low | Read at the cited lines; `parts` are cleared only when the job runs | patch |
| Customer counts, merged failures, the 200 cut and its order, bookkeeping failure, the job's chat untested | gap | Filed by verification-gap | patch |
| A request waiting at 07:00 that fails later appears in no report | medium | Each report selects its own day; the frozen matrix sets this rule | raised to the owner |
| Erased after the parts are stored, repeat after a crash, unused abort signal | low | Recorded in D66; rare, and a guard adds re-rendering | rejected |
| No "part 2" marker, Telegram entity limit, copied helpers, retry_after | low | Extra bold is only dropped; a report rarely splits | rejected |
| No retry from 00:00 to 07:00 | false | The matrix says only the latest yesterday is sent | rejected |

## Design Notes

A product asked again reuses its request (D6), so it counts once, on the day it was first asked.

## Verification

**Commands:**
- `pnpm --filter @cashback/server exec vitest run --changed origin/main --maxWorkers=2 --testTimeout=30000` -- expected: all pass, except `module-boundaries` AC1 on a CRLF checkout.
- `pnpm typecheck`, `pnpm lint`, `pnpm depcruise` -- expected: each exits 0.
