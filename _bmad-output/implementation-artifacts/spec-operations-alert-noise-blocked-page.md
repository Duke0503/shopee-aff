---
title: 'Owner alerts stop reporting what is already over, stop repeating a captcha, and name the blocked page'
type: 'bugfix'
created: '2026-11-06'
status: 'done'
baseline_commit: 'a7a5def8ce14774a98b31b7a6af0f7edd1b18675'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On 2026-11-06 a `bridge_captcha` alert raised at 17:36:57 was held by its cooldown and sent at 17:45:17, eight minutes after the captcha was cleared and everything worked again. One captcha also sends up to three alerts for one cause. And no log or alert says which page was blocked, so the cause has to be guessed.

**Approach:** Before sending, drop an alert whose condition has already ended. Raise no separate reconciliation or payout alert when the cause is a captcha, which already has its own. Record the blocked page's address in the bridge answer, the log and the captcha alert.

## Boundaries & Constraints

**Always:**
- Owner decision (2026-11-06); record it in D69.
- An alert is dropped only on evidence that its condition ended, read from the ledger at send time, in the claim's transaction. With no such evidence it is sent as before.
- A dropped alert becomes EXPIRED, is never sent, and is counted in one log line by kind.
- The captcha alert itself is never suppressed by these rules while no evidence shows it ended.
- The page is origin and path only, never a query string or fragment. It holds no customer data.

**Never:**
- No new Shopee request. No change to the hold, the retry, the queue or the watcher of D68.
- No change to money, matching or customer messages.
- A real reconciliation failure with another cause still alerts as today.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Captcha ended while waiting | Pending `bridge_captcha`; a bridge job finished DONE, or a Shopee run SUCCEEDED, after `raised_at` | Dropped, not sent | N/A |
| Captcha still there | Pending `bridge_captcha`, no such evidence | Sent, with the page when known | Existing retry |
| Failed job after the alert | Only FAILED jobs since `raised_at` | Sent | N/A |
| Reconciliation recovered | Pending `reconciliation_failed`; each network's latest run SUCCEEDED after `raised_at` | Dropped | N/A |
| One network still failing | Latest run of one network failed | Sent | N/A |
| Request no longer stuck | Pending `link_request_stuck`, request not QUEUED | Dropped | N/A |
| Other kinds | Any other kind | Sent as today | N/A |
| Two failed runs, cause captcha | `reconciliation_failed` due, this failure's reason is `captcha` | Not raised; the run and the log are unchanged | N/A |
| Two failed runs, other cause | Any other reason | Raised as today | N/A |
| Stale health while held by captcha | Reconciliation component down, queue held by captcha | No `reconciliation_failed`; the desk still shows it down | N/A |
| Stale health, no hold | Component down, queue not held | Raised as today | N/A |
| Payout read while held by captcha | `payout_record_unavailable` because of a captcha hold | No alert; the job tries again the next hour as today | N/A |
| Payout read, other cause | No browser, paused by a lost login, or any other reason | Alert as today | N/A |
| Blocked page known | Bridge answers captcha or a lost login | Answer carries the page; log and `bridge_captcha` show it | N/A |
| Old extension | Answer without the page | Accepted; the alert has no page line | N/A |
| Frozen page | Fresh tab's address shows a block | Carries that address | N/A |

</frozen-after-approval>

## Code Map

Work in the worktree `C:\Project\shopee\wt-alerts`, branch `fix/operations-alert-noise-blocked-page`.

- `apps/server/src/modules/operations/alert-delivery.job.ts`, `alert-render.query.ts`, `alert.command.ts` -- check at claim time; mark EXPIRED; one log line per run. Operations may import linking and orders through their indexes.
- `apps/server/src/modules/orders/reconciliation-run.command.ts:155-158` -- `alertFor` has `e.reason`; skip `reconciliation_failed` when it is `captcha`. Keep `reconciliation_page_cap` and `reconciliation_source_stale`.
- `apps/server/src/modules/operations/health.job.ts:60` -- skip the stale reconciliation alert while the Shopee queue is held by a captcha (`shopeeQueueStopReason` in linking). The model's state is unchanged, so the Overview still shows it.
- `apps/server/src/reconcile/payout-record.job.ts:34,65`, `apps/server/src/modules/linking/shopee-payout.adapter.ts:57` -- tell a captcha hold apart from other `payout_record_unavailable` causes, adding a marker to the error rather than parsing its message.
- `packages/contracts/src/bridge.schema.ts:122` -- optional `blockedAt`, a bounded string, on the failed answer. Server must accept an answer without it.
- `apps/bridge/src/shopee-page.ts`, `bridge-tab.ts` (`Blocked`, `frozenAnswer`, `FreshTab`), `link-job.ts`, `lookup-job.ts`, `report-job.ts`, `payout-record-job.ts`, `bridge-loop.ts` -- carry origin and path from `pageBlock`'s input to the answer. A retry answers with the last blocked address.
- `apps/server/src/modules/linking/link-result.command.ts:151`, `link-lookup.command.ts:189`, `shopee-bridge.adapter.ts:98` -- pass the page into the alert detail and the log line. `AlertDetail` in `platform/ports/alert.port.ts` gains optional `page`.
- `apps/server/src/modules/operations/telegram.adapter.ts`, `packages/labels/vi/alerts.json` -- a line `Trang: {page}`, escaped.
- `apps/bridge/public/manifest.json` -- bump to 0.3.0.

## Tasks & Acceptance

**Execution:**
- [x] The send-time check and the EXPIRED log line.
- [x] The three raise sites that skip a captcha's duplicates.
- [x] The blocked page through the contract, bridge, server, alert text and labels.
- [x] Tests covering the matrix in `apps/server/tests/` and `apps/bridge/tests/`.
- [x] `docs/operations/backup-and-alerts-runbook.md`, `docs/operations/bridge-runbook.md`, `docs/operations/message-parity.md`, `.context/decisions/2026-11-06-D69-alert-noise-blocked-page.md`.

**Acceptance Criteria:**
- Given a `bridge_captcha` held by its cooldown and a link job DONE before it is due, when the delivery job runs, then no message is sent and the row is EXPIRED.
- Given one captcha during a reconcile and a payout read, when both fail, then the owner gets the captcha alert only.

## Implementation Notes

- Link job DONE is the only bridge job counted as captcha evidence: a lookup also ends DONE from the third party or from fresh shared facts, with the session still blocked. This narrows the matrix's "a bridge job finished DONE" towards sending.
- Captcha evidence must also be later than the latest captcha on record (`last_captcha_at`, migration 0038), because a repeat does not move `raised_at`. A Shopee run counts from `started_at`.
- After review (coordinator, 2026-11-06), a clear is also evidence (`captcha_cleared_at`), which adds to the matrix's list of evidence; the health job no longer raises `bridge_captcha`; a read refused during a captcha hold has the reason `captcha`. See D69.
- The health check does not note the state while it skips, or a part still down after the hold would never alert.
- A payout read that met a captcha itself (`payout_record_failed`) is also silent, as the second acceptance criterion needs; the matrix names only the hold.
- `page`, not `blockedAt`, is the name past the bridge port: in the alert detail and the log lines.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| A cleared captcha with nothing after it is still sent; the 17:45 complaint can repeat | high | Clearing is not evidence; the implementer flagged it | patch |
| The captcha time is lost when the hold record is overwritten, so a later captcha can be dropped | high | `holdShopeeQueue` and `clearCaptchaHold` overwrite the only record | patch, adds a column |
| Recovery check differs from the health model, so a dropped alert may never be raised again | high | Any run kind and only networks with rows; health reads HOURLY for a fixed list and raises on change | patch |
| Health raises its own `bridge_captcha`, a second message with no page | medium | `health.job.ts:68` | patch |
| A repeat keeps the waiting row's old page or none | medium | The suppressed branch ignores `detail` | patch |
| A run refused during a captcha hold fails as `queue_held` and raises a second alert | medium | `alertFor` matches `captcha` only | patch |
| The stale-health skip also hides an AccessTrade outage | medium | The entry covers both networks | patch |
| Server must go before the extension | medium | The old schema is strict; the runbook calls it optional | patch |
| Blocked page accepts credentials in the address; dropped-alert log has no ids; misplaced comment | low | Direct corrections | patch |
| Overlapping run, a run between captchas, lookup and payout page, and report page after the request are untested | gap | Filed by verification-gap | patch |
| Loose `toMatchObject` in older bridge tests | low | Exact addresses are checked in `blocked-page.test.ts`, extended above | rejected |
| Copied helpers | low | Separate refactor | rejected |

## Verification

**Commands:**
- `pnpm --filter @cashback/server exec vitest run --changed origin/main --maxWorkers=2 --testTimeout=30000` -- expected: all pass, except `module-boundaries` AC1 on a CRLF checkout.
- `pnpm --filter @cashback/bridge exec vitest run` -- expected: all pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm depcruise` -- expected: each exits 0.
