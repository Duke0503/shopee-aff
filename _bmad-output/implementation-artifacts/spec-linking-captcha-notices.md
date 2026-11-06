---
title: 'Tell customers and the owner why a Shopee link is stuck'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '4ceb4b1beaedf687770348117ae7622d7feff40a'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** During a captcha a customer who sends a link hears only "about one minute", and the owner's alert does not say who is waiting or which step found the captcha.

**Approach:** The customer is told at once that the system has trouble creating the link. Each captcha alert names the step that found it, and each stuck request sends the owner one message with the customer's name and id.

## Boundaries & Constraints

**Always:**
- Owner decision (2026-11-06): these alerts go to the owner chat (`TELEGRAM_CHAT_ID`), one message per stuck request. They may carry a customer's name and id, which changes AD-27's "no personal data" for these kinds only; record it in D65.
- A stuck request still follows by the existing notification when the queue reopens. A link goes out once.
- Customer text has no date or time promise (D11). All text lives in `packages/labels/vi/`. Owner-approved wording of `link_queue_stopped`, exactly: "⏳ Hệ thống đang gặp trục trặc khi tạo link từ Shopee, có thể do đường truyền chưa ổn định.\n\nBạn chờ mình một chút nhé, tạo xong mình sẽ gửi link ngay."
- Log lines carry ids and kinds only.

**Never:**
- No new Shopee page visit to detect anything, and no automatic captcha solving (D8).
- No message for a page error hold, which lasts one minute.
- No change to the website's link flow, money or matching. No merge or deploy before the owner approves.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Link sent while stopped | Queue held by captcha or paused by a lost login, no link yet | Customer gets `link_queue_stopped` on the first poll, without waiting out the reply wait; a group reply still tags them | Server not reachable: existing `link_on_its_way` |
| Link already made | Share link exists | Normal link reply | N/A |
| Captcha during the wait | Queue stops while the assistant polls | `link_queue_stopped` on the next poll | N/A |
| Queue reopens | Request issued | Link arrives by the existing notification, once | N/A |
| Captcha on a link request | A request's submission meets it | `bridge_captcha` says the customer's name, id and product | Customer erased or unknown: the id alone |
| Captcha on another step | Conversion report, payout record or lookup | `bridge_captcha` names that step | N/A |
| Found by the health check | Health sees the bridge down | Says the health check saw it; the first detail of a cooldown is kept | N/A |
| Stuck request | QUEUED Shopee request while stopped | One `link_request_stuck` message per request: name, id, product, reason | Telegram down: existing retry and 24 h expiry |
| Repeat checks | Same request still stuck | No second message | N/A |
| Lost login | Queue paused | Same customer message and stuck messages, with the reason lost login | N/A |

</frozen-after-approval>

## Code Map

Work in the worktree `C:\Project\shopee\wt-captcha-report`, branch `feature/linking-captcha-notices-daily-report`.

- `apps/server/src/platform/ports/alert.port.ts` -- add an optional detail (`source`, optional `requestId`) to `alert`; existing callers stay valid.
- `apps/server/src/modules/operations/alert.command.ts`, `alert-delivery.job.ts`, `telegram.adapter.ts` -- store the detail; render it at send time inside the claim. Add a keyed raise for `link_request_stuck` that bypasses the kind cooldown and never repeats. Operations may import identity and linking.
- `apps/server/migrations/0036_alert_detail.sql`, `apps/server/src/modules/operations/schema.ts` -- `detail` and a nullable unique `dedup_key` on `alerts`.
- `apps/server/src/modules/linking/link-result.command.ts:151`, `link-lookup.command.ts:189`, `shopee-bridge.adapter.ts:98`, `operations/health.job.ts:60` -- the four raise sites; each passes its source. `blockOnSessionPage` is shared by the conversion report and the payout record, so it takes the source from its caller.
- `apps/server/src/modules/linking/link-queue.command.ts` -- `shopeeQueueGate` says whether the queue is stopped; a small query lists QUEUED Shopee requests.
- `packages/contracts/src/assistant-chat.schema.ts:79`, `apps/server/src/links/assistant-chat.routes.ts`, `modules/linking/link-reply.query.ts` -- add optional `queueStopped` to the link reply.
- `apps/assistant/src/chat-reply.ts:100-156` -- stop waiting and send `link_queue_stopped`.
- `packages/labels/vi/messages.json`, `packages/labels/vi/alerts.json` -- new text.

## Tasks & Acceptance

**Execution:**
- [x] Migration, schema, port, alert command and delivery -- detail and keyed raise.
- [x] `apps/server/src/platform/jobs/job-schedules.ts`, `apps/server/src/health/owner-jobs.ts` -- a job every 30 s raises one stuck message per request.
- [x] Contract, server route, assistant reply and labels -- the customer message.
- [x] `apps/server/tests/link-stuck-notices.test.ts`, `apps/assistant/tests/link-queue-stopped.test.ts` -- cover the matrix; extend exact-list tests.
- [x] `docs/operations/message-parity.md`, `docs/operations/backup-and-alerts-runbook.md`, `docs/operations/bridge-runbook.md`, `.context/decisions/2026-11-06-D65-captcha-notices.md` -- record them.

**Acceptance Criteria:**
- Given no captcha, when a link is sent, then the customer's messages are unchanged.
- Given a captcha alert at a report read, when it is sent, then its text names that step and no customer.

## Implementation Notes

- Outside the Code Map: `modules/linking/link-delivery.command.ts`. A request stuck over 2 hours would have been closed with no message once its link was made, which breaks "a stuck request still follows". A Zalo request made late by the browser now counts its 2 hours from when the link was made; every other channel is unchanged. Recorded in D65; the owner should confirm it.
- Choices the spec left open: `link_request_stuck` is severity high. A QUEUED request has no product name yet, so the message shows the pasted link; the name or link is cut to 200 characters. "The id alone" for an erased or unknown customer also leaves out the product. A key never repeats, even across a later stop.
- The alert wording other than `link_queue_stopped` is new and has not been read by the owner.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Stuck alert and runbook promise a link "sent to the customer" for web and guest requests | medium | `queuedShopeeRequests` does not filter them; `checkLinkDeliveries` closes those silently | patch |
| `madeAt` treats a null channel as Zalo | medium | `NULL = 'web'` falls to the ELSE branch; older rows may have no channel | patch |
| Correlated subquery on `bridge_jobs` has no usable index | medium | Only partial PENDING indexes exist; runs every 5 s | patch |
| Two tests cannot fail (stale limit, reopened queue), expiry test's last raise is after the hold | medium | Read at the cited lines | patch |
| Job `run`, product name and cut, merged owner, null channel, no-stop retry untested | gap | Filed by verification-gap and reviewers | patch |
| A cut can split an emoji in a product name and Telegram may refuse the alert | low | `.slice` cuts by UTF-16 unit; the fix is a direct correction | patch |
| Keyed alert given up after 5 tries and never raised again | medium | Same rule as every alert; D65 wrongly says retried up to 24 h | patch (D65 wording) |
| Spine and parity counts out of date | low | `ARCHITECTURE-SPINE.md:286`, `message-parity.md:72` | patch |
| Stale stuck message or delayed critical alert from a backlog | low | Link requests run about 5 a day, so 10 per 30 s does not back up | rejected |
| Display name over Telegram's limit | false | Names are capped at registration | rejected |
| Unknown request labelled as a customer id | low | Needs a deleted request; requests are not deleted | rejected |
| Customer already told "one minute" hears nothing more | low | They still get the link when the queue reopens; a guard needs a new message path | rejected |
| Resending a link while stopped repeats the message | false | Each message answers a message the customer sent | rejected |
| D65 parts not yet owner approved | rejected | The owner reviews the delivery rule and wording before merge | rejected |
| Daily report spec in this diff; its retry can shift parts | medium | Committed separately; Code Map amended to store rendered parts | fixed in that spec |

## Verification

**Commands:**
- `pnpm --filter @cashback/server exec vitest run --changed origin/main --maxWorkers=2 --testTimeout=30000` -- expected: all pass, except `module-boundaries` AC1 on a CRLF checkout.
- `pnpm --filter @cashback/assistant exec vitest run` -- expected: all pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm depcruise` -- expected: each exits 0.
