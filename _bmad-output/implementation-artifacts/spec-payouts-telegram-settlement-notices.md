---
title: 'Telegram notices for network settlements to the DP Business group'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '5f75338047904cec9e9fa1132db57f2c5f16074e'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The DP Business group hears about orders (D62) but not about money the network pays: a new settlement batch, its status changes and its match result reach no one unless they open the admin desk.

**Approach:** Each settlement change writes one notice row in the same transaction; a job sends pending rows to the business chat outside any transaction, as the order notices do.

## Boundaries & Constraints

**Always:**
- One notice per settlement and event: a report that repeats a batch sends nothing.
- Sends happen outside transactions, under the delivery rules of D62: at most 10 per run, stop at the first failure, pending over 24 h becomes EXPIRED and is counted in one log line.
- Amounts come from the stored settlement. Log lines carry ids and kinds only.
- The chat is `TELEGRAM_BUSINESS_CHAT_ID`, with no fallback.

**Never:**
- No backfill of existing settlements: an old batch sends a notice only when it takes a new change after deploy.
- No change to matching, money or order logic. No customer names in these notices.
- No merge or deploy before the owner approves.

**Decision (owner, 2026-11-05):** the scope is network settlement batches and their match result. Review cases are not notified.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New batch | First record of a payout id | "created" notice: network, payout id, status, gross, received, fee and tax when known, creation time | Failed send stays pending |
| Paid | `PROCESSING -> PAID` | "paid" notice with paid time | As above |
| Failed | `PROCESSING -> FAILED` | "failed" notice | As above |
| Matched | Match becomes MATCHED | "matched" notice: orders settled, matched gross, unattributed | As above |
| Mismatch | Match becomes MISMATCH | "mismatch" notice pointing at the review case | As above |
| First seen already paid | First record with status PAID | "created" notice showing PAID, then the match notice; no separate "paid" | N/A |
| Repeat report | Same facts | Nothing | N/A |
| Paid time or order list only | Status and match unchanged | Nothing | N/A |
| Cutover import | Imported batches | Nothing | N/A |
| Telegram down | Send fails | Retried next run in order | Pending over 24 h becomes EXPIRED |
| Chat unset | No chat id | No job; rows stored | Existing `chat_absent` error |

</frozen-after-approval>

## Code Map

All work happens in the worktree `C:\Project\shopee\wt-settlement-notices`, branch `feature/payouts-telegram-settlement-notices`; dependencies are installed there.

- `apps/server/src/modules/payouts/network-settlement.command.ts` -- `recordNetworkPayout`, the one write path; `existing`, `after` give the change to detect. `insert`, `update` stay as they are.
- `apps/server/src/modules/payouts/network-settlement-import.command.ts` -- the cutover path, which writes no notice.
- `apps/server/src/modules/orders/order-business-notice.job.ts`, `order-business-notice.query.ts` -- the pattern to follow, including escaping and dotted dong. Do not change the order notices.
- `apps/server/src/health/owner-jobs.ts` -- `businessNoticeJob` composition; add the second job beside it with the same sender.
- `apps/server/tests/module-schemas.test.ts`, `tests/job-scheduler.test.ts`, `tests/owner-alerts.test.ts` -- exact lists to extend.

## Tasks & Acceptance

**Execution:**
- [x] `apps/server/migrations/0035_settlement_business_notices.sql`, `apps/server/src/modules/payouts/schema.ts` -- add `settlement_business_notices` (id, unique dedup_key `settlement:<id>:<event>`, settlement_id, event, raised_at, delivery, attempts, send_attempt, delivered_at).
- [x] `apps/server/src/modules/payouts/network-settlement.command.ts` -- insert-or-ignore a notice per detected change, in the caller's transaction.
- [x] `apps/server/src/modules/payouts/settlement-business-notice.job.ts`, `settlement-business-notice.query.ts`, `packages/labels/vi/settlement-notices.json` -- delivery and text; wording lives in labels.
- [x] `apps/server/src/platform/jobs/job-schedules.ts`, `apps/server/src/health/owner-jobs.ts`, `apps/server/src/modules/payouts/index.ts` -- schedule every 30 s and wire.
- [x] `apps/server/tests/settlement-business-notices.test.ts` -- cover the I/O matrix; extend the exact-list tests.
- [x] `docs/operations/message-parity.md`, `docs/operations/status-flows.md`, `.context/decisions/2026-11-05-D63-settlement-notices.md` -- record the notices and the owner's request.

**Acceptance Criteria:**
- Given an hourly payout-record read repeats 13 batches unchanged, when it finishes, then no notice row exists.
- Given a batch moves to PAID and matches in one record, when the job runs, then the group receives "paid" before "matched".

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| A listed batch with refused orders or orders above its gross reads as a clean match | high | `planListed` always returns MATCHED; the notice has no pointer to the open case | patch |
| Negative "other orders" amount under a matched header | medium | `batchCoverage` can return a negative value; `amountLine` prints it | patch |
| A failed notice says the network paid an amount | medium | `line_received` is rendered under the failed header | patch |
| Runbooks, `.env.example`, config and adapter comments name order notices only | medium | Read `backup-and-alerts-runbook.md:59,66-69`, `.env.example:154` | patch |
| Settled count not pinned for a batch with refused lines | gap | Filed by verification-gap | patch |
| Amount and time lines checked by label only | gap | Filed by verification-gap | patch |
| Delayed notice rendered after the state moved on | low | Needs an outage between the change and the send; a guard adds branches | rejected |
| Lost SENDING rows, unused abort signal, repeat after a timeout | low | Same accepted rules as D62 | rejected |
| Owner alert on a blocked or expiring queue | rejected | The frozen rule counts expiry in one log line; raised to the owner as a follow-up | rejected |
| Combined rate over Telegram's group limit | false | Settlements produce a few rows every three or four days, so the two jobs do not reach the limit together | rejected |
| Delivery job copied from the order notices | low | Two files to keep in step; the spec chose this pattern; extraction is a separate refactor | rejected |
| Spec stale against the code | rejected | The fix edits this build's spec; tasks are ticked at the end of the step | rejected |

## Verification

**Commands:**
- `pnpm --filter @cashback/server exec vitest run --changed origin/main --maxWorkers=2 --testTimeout=30000` -- expected: all pass, except `module-boundaries` AC1 when the checkout uses CRLF.
- `pnpm typecheck && pnpm lint && pnpm depcruise` -- expected: all pass.
