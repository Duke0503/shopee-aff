---
title: 'One queued request per link, one bridge tab, a fresh tab before a captcha is reported, and an instant resume'
type: 'bugfix'
created: '2026-11-06'
status: 'done'
baseline_commit: 'db407ad12af2b430fddedda5c01745f573dbe1bc'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** During a captcha a customer who resends a link adds another request and later gets repeated links. The owner sees two `custom_link` tabs. One captcha answer or a frozen tab is reported at once, with no second look in a fresh tab. After the owner clears a captcha, the queue waits for its 5-minute hold to end.

**Approach:** Hand back the customer's own waiting request. Keep one `custom_link` tab. On a captcha or a frozen tab, open a fresh tab, close the old one and run the job once more, reporting only if it is still blocked. When a Shopee tab leaves the verification page, the bridge tells the server and the queue resumes at once.

## Boundaries & Constraints

**Always:**
- All four are owner requests (2026-11-06); record them in D68.
- Same customer means any of the customer's merged keys, as link reuse does. Same link means the same stored `source_url`. Only QUEUED requests match.
- A job gets at most one fresh-tab retry. A hold still follows a second captcha answer, so a real captcha is retried at most once per hold.
- A tab that is the active tab of the focused window is never closed by the bridge: the owner may be solving the captcha in it. The job then answers its block at once.
- The resume clears only a captcha hold. It never lifts a lost-login pause, and a page error hold keeps its own rule.
- Owner decision (2026-11-06): when a resume clears a hold and the latest Shopee reconciliation run failed, one reconcile starts at once through the scheduler's `trigger`. It adds at most one read per clear. A clear with no hold, or after a successful run, starts none.
- Evidence (2026-11-06, production): after the owner cleared a captcha, Zalo and Telegram kept reporting trouble until `held_until` at 16:39:28, then four link jobs succeeded within nine seconds. The waiting state must end when the captcha is cleared, not only when the timer ends.

**Never:**
- No new Shopee request to detect a cleared captcha, and no automatic solving (D8).
- No change to money, matching or the reuse rule of a link already made.
- No change to existing rows: the requests already queued stay as they are.
- No merge or deploy before the owner approves.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same link resent | Customer's QUEUED request with the same source URL, product key or none | The same request id, `reused` true, no new row; the customer gets the normal waiting reply | N/A |
| Another customer | Same link, other customer | A new request (D6) | N/A |
| Earlier one FAILED | Same link, not QUEUED | Existing rules apply | N/A |
| Website quota | Resent on the website | Costs no quota | N/A |
| Two link tabs | Another `custom_link` tab, pinned or not | Closed at the next job, except the active tab of the focused window | Close failure ignored |
| Other Shopee tab | Unpinned, not `custom_link` | Never touched | N/A |
| Captcha, fresh tab clean | First run answers captcha | Fresh tab, old closed, job runs again and succeeds; no hold, no alert | N/A |
| Captcha, still blocked | Second run answers captcha | Answers captcha: hold and alert as today | N/A |
| Frozen tab | Page script does not answer | Fresh tab, job runs again once | Still frozen: `page_not_ready` as today |
| Owner on the tab | Bridge tab is active in the focused window | No replacement; answers captcha at once | N/A |
| Late retry | Too little of the job's time is left for a second run | Answers the first result | N/A |
| Login page | Answer is a lost login | No retry, pause as today | N/A |
| Captcha cleared | A Shopee tab goes from `/verify/` to a non-verify Shopee page | Bridge posts once; server clears the captcha hold; links start within seconds | Post fails: the hold ends by itself |
| Not on a hold | Post with no captcha hold | No change | N/A |
| Worker restarted | Tab left `/verify/` after a restart of the service worker | Still detected, from stored state | Missed: the hold ends by itself |

</frozen-after-approval>

## Code Map

Work in the worktree `C:\Project\shopee\wt-link-queue`, branch `fix/linking-queue-dedup-bridge-tab`.

- `apps/server/src/modules/linking/link-request.command.ts:90-125` -- add the QUEUED match before `beforeNew`, using `customerKeys`, also when `productKey` is null. Returns the same shape as `reusableRequest`.
- `apps/bridge/src/bridge-tab.ts` -- `closeExtraTabs` also closes `custom_link` tabs that are not pinned, sparing the active tab of the focused window; add `replaceTab` to `PageDriver`, sharing `replaceFrozenTab`. A frozen tab already replaced in this job must not be replaced again. `REPLACE_TAB_EVERY_MS` keeps a freezing page from looping.
- `apps/bridge/src/bridge-loop.ts` `jobWorker` -- the one place all four job kinds pass: on `captcha` or `page_not_ready` from a frozen page, replace and run once more. Report jobs have a 90 s server limit and a 45 s answer limit (`report-job.ts`), so skip the retry when the first run used more than half of the job's time.
- `apps/bridge/src/bridge-service.ts`, `chrome-api.types.ts` -- `chrome.tabs.onUpdated` tracks tabs on `/verify/` in `chrome.storage.local`; on leaving it for a Shopee page, post once. Reuse `pageBlock`.
- `packages/contracts/src/bridge.schema.ts`, `apps/bridge/src/server-client.ts`, the bridge routes in `apps/server/src/modules/linking/` -- `POST /internal/bridge/verification-cleared` behind the bridge token.
- `apps/server/src/modules/linking/link-queue.command.ts` -- clear a captcha hold only, with one audit entry; `resumeShopeeQueue` stays for the admin command.
- `apps/server/src/platform/jobs/scheduler.ts` `trigger`, `apps/server/src/reconcile/reconcile-jobs.ts`, `apps/server/src/main.ts` -- the route's callback starts `reconcile` when due; `reconciliation_runs` gives the latest Shopee outcome. A job already running is left alone.
- `apps/bridge/tests/fakes.ts`, `bridge-tab.test.ts`, `bridge-loop.test.ts`, existing link request tests -- extend.

## Tasks & Acceptance

**Execution:**
- [x] Server: the QUEUED match, the hold-clearing command, the route and the contract.
- [x] Bridge: tab cleanup, `replaceTab`, the retry in `jobWorker`, the verification watcher.
- [x] Tests covering the matrix in `apps/server/tests/` and `apps/bridge/tests/`.
- [x] `docs/operations/bridge-runbook.md`, `.context/decisions/2026-11-06-D68-queue-dedup-bridge-tab.md` -- record the rules, and that the extension must be reloaded after this deploy.

**Acceptance Criteria:**
- Given three sends of one short link while the queue is held, when the queue reopens, then one link is made and one notification goes out.
- Given a captcha cleared in the pinned tab, when the tab leaves `/verify/`, then the next link job starts without waiting for `held_until`.

## Implementation Notes

- `PageDriver` also gets `replacements()`, so `jobWorker` can tell a frozen page's replacement (made inside `run`) from none, without a job boundary in the driver.
- A fresh tab whose address already shows a block answers it without a second run: that is the second look, and it saves one page load behind a captcha.
- The second run gets what is left of `timeoutMs`, so the job still ends before the server stops waiting.
- The reconcile is not started while a lost login keeps the queue paused: the read would refuse and record one more failed run.
- Review changes (coordinator, 2026-11-06): the waiting match excludes guests and needs the same channel; the owner's tab needs a really focused window and is spared at most 10 minutes; a move during a job tells nothing; a captcha is not hidden by a second run's page failure; the post has a 10 s timeout; the assistant's link answer carries `status`. These narrow the frozen text's "any of the customer's merged keys" match and "never closed" rule; the owner should confirm.
- A frozen tab the owner is on answers from its address (`captcha`, `login_redirect`) or `page_not_ready`.
- Beyond the Code Map: `chrome.tabs.onRemoved` and `runtime.onStartup` forget remembered tabs, because tab ids restart with the browser. The watcher lives in `apps/bridge/src/verification-watch.ts`.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| A resend of a waiting request still sends the link again in chat | high | `handOver` sends on `delivered` when `reused`; a QUEUED hand-back now sets `reused` | patch |
| The bridge's own navigation can end a hold with the captcha unsolved | high | The gate is checked only at claim; a queued job can open a page from `/verify/` | patch |
| `lastFocusedWindow` does not mean the owner is there, so a frozen tab may never recover | high | Query matches with Chrome unfocused; an unattended bridge tab is spared forever | patch |
| A second failure replaces a captcha: counts against the customer, loses the hold and alert | medium | `no_link` is counted; `script_error` raises nothing | patch |
| Guests share one waiting request | medium | All web guests resolve to HOUSE; the assertion was removed | patch |
| A Zalo resend matches a web request, breaking the D65 promise and priority | medium | `checkLinkDeliveries` and priority read the stored channel | patch |
| A non-Shopee `/verify/` address is remembered and can clear a hold | medium | `block` is checked before `BRIDGE_TAB_SITE` | patch |
| Time for the second run is measured before the replacement | medium | Replacement can take 30 s | patch |
| `onCleared` throw gives a false 500; no record of the reconcile; no fetch timeout | medium | Read at the cited lines | patch |
| Extension version unchanged after a required reload | low | Direct correction | patch |
| Route wiring and focused-window rule untested; guest case unpinned | gap | Filed by verification-gap | patch |
| A clear inside the cooldown holds back the next captcha alert | low | The repeat waits for the cooldown and stuck messages still go out | rejected |
| Reconcile only re-reads hourly, not a failed nightly | low | The next nightly covers it | rejected |
| Owner switches tab between the check and the close | low | A very short window; the fresh tab shows the same page | rejected |
| Report retry can exceed the server wait | low | Only if the first run stays under half and the second takes its worst case; the job is given out again | rejected |

## Verification

**Commands:**
- `pnpm --filter @cashback/server exec vitest run --changed origin/main --maxWorkers=2 --testTimeout=30000` -- expected: all pass, except `module-boundaries` AC1 on a CRLF checkout.
- `pnpm --filter @cashback/bridge exec vitest run` -- expected: all pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm depcruise` -- expected: each exits 0.
