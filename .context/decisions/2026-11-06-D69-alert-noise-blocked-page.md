# D69 (Owner alerts drop what is already over, one captcha raises one alert, the alert names the blocked page)

- Status: accepted
- Date: 2026-11-06
- Approved by: the project owner (2026-11-06). The spec is
  `_bmad-output/implementation-artifacts/spec-operations-alert-noise-blocked-page.md`.

## Context

On 2026-11-06 a `bridge_captcha` raised at 17:36:57 was held by its cooldown and sent at 17:45:17, eight
minutes after the captcha was cleared and everything worked again. One captcha could also send up to
three alerts for one cause. No log or alert said which page was blocked, so the cause had to be guessed.

## Decision

- **Drop what is over.** Before sending, in the claim's transaction, an alert whose condition has ended
  is marked `EXPIRED`, never sent, and counted by kind in one log line
  (`operations.alert.ended_alerts_dropped`). The check runs again on a retry. Only evidence from the
  ledger ends an alert; with none it is sent as before:
  - `bridge_captcha`: the browser made a link, a Shopee reconciliation run that succeeded started, or the
    captcha was cleared, after the alert was raised and after the latest captcha on record.
  - `reconciliation_failed`: each network the health model watches has, as its latest hourly run, one
    that succeeded after the alert was raised. A watched network with no run is no evidence, because the
    health check raises only on a change, so an alert dropped wrongly would not come back.
  - `link_request_stuck`: the request is no longer QUEUED.
  - Every other kind is sent as today.
- **What counts as evidence for a captcha.** A link job DONE, because only the browser can finish one. A
  lookup does not count: it also ends DONE from the third party or from fresh shared facts, with the
  session still blocked. A run counts from when it started, so a read finished before the captcha and
  applied after it does not count.
- **A later captcha keeps the alert.** A repeat is counted on the waiting row without moving `raised_at`,
  so a success between two captchas would otherwise end the second one. `link_queue_state` keeps
  `last_captcha_at`, written on every captcha hold, and `captcha_cleared_at`, written when the bridge sees
  the tab leave the verification page or the owner's resume lifts a captcha hold (migration 0038). No
  other hold changes them, and they cover a report or a payout read, which leave no `bridge_jobs` row.
- **One captcha, one alert.** No `reconciliation_failed` when this failure's reason is `captcha`, which is
  also the reason of a read refused during a captcha hold; the run and the log are unchanged. The health
  check never raises `bridge_captcha`: every captcha hold raised it at the job that met it, and that message
  has the step and the page. No stale `reconciliation_failed` from the health check while the queue is held
  by a captcha and Shopee alone is stale, so an AccessTrade outage is still told; the Overview still shows
  it down, and if it is still down when the hold has ended the alert goes out then. No payout alert when a captcha stopped the read, whether the queue was held for one
  (`shopee_payout_record_unavailable`) or the read met one itself (`shopee_payout_record_failed`); the job
  tries again the next hour as today. `PayoutRecordError` carries a marker rather than a parsed message.
- **The blocked page.** The bridge's failed answer may carry `blockedAt`, the page's origin and path, at
  most 512 characters. Never a query string, a fragment or credentials, checked by the extension, by the
  contract and again when the alert is stored. The server logs it, and `bridge_captcha` shows it as a line
  `Trang: {page}`; a repeat counted on a waiting alert writes its page on, keeping the row's source and request.
  A retry answers with the last blocked address; a frozen page with what the fresh tab's address shows.
  `bridge_login_lost` is logged with the page, and its text is unchanged.

## Consequences

- **Deploy the server first, then reload the extension** (`chrome://extensions`, version 0.3.0). A server
  older than D69 refuses an answer that carries `blockedAt`. The new server accepts an answer without the
  page, so until the reload the alert simply has no page line.
- A captcha cleared with nothing after it is not told, including one cleared after its hold ran out.
- A browser lookup succeeding after a captcha does not drop the alert; the alert goes out, as it would
  without evidence.
- A read refused during a page error hold or a pause keeps `queue_held` or `queue_paused` and alerts as today.
- A dropped alert counts as `EXPIRED` for the cooldown, so the next captcha goes out at once.
