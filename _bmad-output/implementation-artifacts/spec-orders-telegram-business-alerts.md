---
title: 'Restore Telegram order notices to the DP Business group'
type: 'bugfix'
created: '2026-11-05'
status: 'done'
baseline_commit: 'd48e393dfe9399bf4988ddc24a225d6c47735c45'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since the 2026-11-02 cutover the DP Business Telegram group gets no order messages: the new platform never ported the live system's four order notices, and a frozen order raises no owner alert.

**Approach:** Every order step to a notified status writes one notice row in the step's own transaction; a job sends pending rows to the business chat outside any transaction, in the live system's wording. A new `order_frozen` owner alert covers freezes.

## Boundaries & Constraints

**Always:**
- Messages match the live format in `src/cashback/core/telegram_alerts.py` (owner confirmed the format with a screenshot of the group, 2026-11-05), including customer name and ID in the business chat only.
- One notice per order, event and lifecycle: re-running reconciliation over overlapping windows sends nothing new.
- Sends happen outside transactions. A send the API accepted is never repeated.
- Log lines carry ids and kinds only, never names, tokens or chat ids.

**Never:**
- No bulk backfill and no notice for an order that did not take a new step after deploy, except the single approved catch-up for the frozen order ending `381J`.
- No merge to `main` or deploy before the owner approves. No fallback to the owner chat when the business chat is unset.
- No personal data in the owner alert `order_frozen`.

**Decision (owner, 2026-11-05):** the new-order message shows the estimated cashback the customer is told (`estimatedCashback`, after the fee and withheld tax), labelled without "(80%)", not the old plain 80%.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New order | `null -> AWAITING_APPROVAL` | "ĐƠN HÀNG MỚI GHI NHẬN" | Failed send stays pending |
| Approved | `AWAITING_APPROVAL -> APPROVED` | "ĐƯỢC DUYỆT" with official commission and cashback | As above |
| Restored after freeze | `FROZEN -> APPROVED` | No notice | N/A |
| Rejected or reversed | `-> REJECTED`, `-> REVERSED` | "BỊ HỦY / TỪ CHỐI" with a reason label | As above |
| Reopened then rejected again | New lifecycle | A second rejected notice | N/A |
| Paid | `APPROVED -> PAID` | "HOÀN TIỀN THÀNH CÔNG" with amount | As above |
| Guest or no customer | HOUSE or null customer | Sent, "Chưa gắn mã (Khách vãng lai)", as the live system did | N/A |
| Recorded and frozen at once | `null -> AWAITING -> FROZEN` | New-order notice whose status line says under review, plus `order_frozen` alert | N/A |
| Telegram down | Send fails | Run stops, retried next run in order | Pending over 24 h becomes EXPIRED, counted in one log line |
| Chat unset | No `TELEGRAM_BUSINESS_CHAT_ID` | No job; rows stored; prod logs an error at start | Server still starts |
| Dev config | Dev chat is a production chat | Isolation check refuses the start | Existing check |

</frozen-after-approval>

## Code Map

- `apps/server/src/modules/orders/order-steps.command.ts` -- `recordSteps`, the one place every status step passes; `stepEvent`, `orderEventKey` give the event and lifecycle key to reuse.
- `apps/server/src/modules/orders/report-apply.command.ts:254` -- `carryOut` holds `deps.alerts`; freezes come only through this path. Leave the pure `transition` and its tests unchanged.
- `apps/server/src/modules/operations/alert-delivery.job.ts` -- the claim, send, record pattern to follow.
- `apps/server/src/modules/operations/telegram.adapter.ts` -- `telegramSender`, reused with the business chat id. Orders may not import operations (`modules/module-edges.json`), so the job takes a structural sender.
- `apps/server/src/health/owner-jobs.ts` -- composition point for the new job.
- `apps/server/src/modules/orders/order-import.command.ts` -- the cutover import writes history directly, not through `recordSteps`, so imported orders create no notices.
- `apps/server/src/platform/config/isolation.config.ts:127,198` -- production chat checks; the business chat is already in `production-identifiers.json`.
- `apps/server/tests/module-schemas.test.ts:78`, `tests/job-scheduler.test.ts:180`, `tests/owner-alerts.test.ts:264` -- exact lists to extend.

## Tasks & Acceptance

**Execution:**
- [x] `apps/server/migrations/0034_order_business_notices.sql`, `apps/server/src/modules/orders/schema.ts` -- add `order_business_notices` (id, unique dedup_key, order_id, event, raised_at, delivery, attempts, send_attempt, delivered_at) -- the store of what is owed and what was sent.
- [x] `apps/server/src/modules/orders/order-steps.command.ts` -- insert-or-ignore a notice per notified step, ignoring `silentEvents` -- atomic with the step.
- [x] `apps/server/src/modules/orders/order-business-notice.job.ts` -- expire, then claim, send and record, at most 10 per run, stopping at the first failure -- delivery.
- [x] `apps/server/src/modules/orders/order-business-notice.text.ts`, `packages/labels/vi/order-notices.json` -- render from the current order row with HTML escaping -- wording lives in labels.
- [x] `apps/server/src/modules/orders/report-apply.command.ts`, `packages/labels/vi/alerts.json` -- raise `order_frozen` (high) on a step to FROZEN.
- [x] `apps/server/src/platform/config/env.config.ts`, `isolation.config.ts`, `.env.example` -- optional `TELEGRAM_BUSINESS_CHAT_ID`, same format as the owner chat, isolated in dev.
- [x] `apps/server/src/platform/jobs/job-schedules.ts`, `apps/server/src/health/owner-jobs.ts`, `apps/server/src/modules/orders/index.ts` -- schedule every 30 s and wire.
- [x] `apps/server/tests/order-business-notices.test.ts` -- cover the I/O matrix; extend the exact-list tests.
- [x] `docs/operations/backup-and-alerts-runbook.md`, `docs/operations/message-parity.md`, `docs/operations/production-host-runbook.md`, `.context/decisions/2026-11-05-D62-business-order-notices.md` -- record the key, the alert and the owner's decision.

**Acceptance Criteria:**
- Given an hourly run re-reads the same report, when it finishes, then no new notice row exists.
- Given a send succeeded and recording it failed, when the next run starts, then the message is not sent again.
- Given an imported order, when the server starts on the new build, then no message goes out for it.

## Implementation Notes

- File name: the renderer is `order-business-notice.query.ts`, not the `.text.ts` this spec names: the lint file-name rule has no `text` role, and `pnpm lint` must pass. The lint rule was not changed.
- Label file: the frozen status line reuses the platform's word for FROZEN ("Dang kiem tra lai" in Vietnamese, `status_frozen`), with "(Under Review)" after it.
- `reversed` uses the rejected text with its own reason label; the time line is the step's time, not the send time.
- Catch-up and chat id steps are written in `docs/operations/production-host-runbook.md` section 10; not executed (no deploy before owner approval).

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Runbook step 1: blank key, quoted value, no trailing newline, "not found" has no next step | medium | Script copies the raw line and matches a blank key as set; the schema requires `^-?\d+$` | patch |
| Runbook step 3: no tool named, status missing from the SELECT, no check of the outcome | medium | Read section 10: the insert can add nothing silently | patch |
| Runbook says rows expire after 24 h without a chat | medium | Expiry runs only inside the job, which is not registered without a chat | patch |
| Failure log omits the HTTP status | medium | `errorName` logs only the name; 400/403 versus 429 cannot be told apart while the queue is blocked | patch |
| `chat_absent` logged when only the bot is missing | low | `businessNoticeJob` checks both; `telegram_absent` already covers the bot | patch |
| `order_frozen` runbook row names only two causes | low | `report-signal.ts` has other freeze reasons | patch |
| `telegram.adapter.ts` header says owner chat only, no personal data | low | The sender now also carries business text | patch |
| Paid re-confirm after a void is untested | gap | Filed by verification-gap | patch |
| `order_frozen` untested on an existing order | gap | Filed by verification-gap | patch |
| 24 h expiry has no literal two-sided test | gap | Filed by verification-gap | patch |
| Stale paid or approved notice after an undo during an outage | low | Reachable only inside the send delay or an outage; a guard adds branches | rejected |
| Recorded notice says awaiting when approved in the same row | false | The approved notice follows at once; the sequence is true history | rejected |
| Rejected reason read after a reopen | low | Needs a reopen before the send; rare | rejected |
| Render throw blocks the queue | low | Needs an unreadable stored time; the row expires after 24 h and the scheduler logs it | rejected |
| SENDING rows invisible, abort signal unused | low | Accepted in D62; a batch of 10 finishes inside the stop timeout | rejected |
| Timeout after acceptance repeats | low | Unknown outcome; repeat preferred to loss, recorded in D62, same as owner alerts | rejected |
| "Never repeated" wording | false | The comments say accepted by the sender, which is an answered OK | rejected |
| Owner alert on sustained failure or expiry | rejected | The frozen matrix says counted in one log line; raised to the owner as a follow-up | rejected |
| Correction notice for a changed restore, void or clawback | rejected | The frozen matrix says a restore has no notice; raised to the owner as a follow-up | rejected |
| Business chat equal to owner chat in production | low | Needs an operator mistake; the runbook copies the separate key | rejected |
| Retention, security doc home, parity wording | low | No named harm in everyday use | rejected |

## Design Notes

Rows carry no names or amounts: the text is rendered from the order at send time, so an erased customer's name never waits in a queue. Deploy order: add the chat id to `prod.env` by a script that copies it from `C:\Project\mmo\.env` without printing it, then deploy, then insert the single catch-up row for the order ending `381J`.

## Verification

**Commands:**
- `pnpm --filter @cashback/server exec vitest run --changed` -- expected: all pass.
- `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm guard:paths` -- expected: all pass.
