# D68 (One queued request per link, one bridge tab, a fresh tab before a captcha is reported, an instant resume)

- Status: accepted
- Date: 2026-11-06
- Approved by: the project owner asked for all four (2026-11-06) and decided the reconcile after a
  cleared captcha. The spec is
  `_bmad-output/implementation-artifacts/spec-linking-queue-dedup-bridge-tab.md`.

## Context

During a captcha a customer who resent a link added another request and later got repeated links. The
owner saw two `custom_link` tabs. One captcha answer or a frozen tab was reported at once, with no
second look in a fresh tab. After the owner cleared a captcha the queue waited for its 5-minute hold:
in production (2026-11-06) Zalo and Telegram kept reporting trouble until `held_until` at 16:39:28,
then four link jobs succeeded within nine seconds.

## Decision

- **One queued request per link.** A request from the same customer (any of the merged keys) on the
  same channel for the same stored `source_url` gets the waiting request back, with `reused` true and no
  new row, also when the link names no product. Only a QUEUED request of origin REQUEST matches; dev sees
  dev requests only. Another customer gets a request of their own (D6). A resend on the other channel
  makes a new request. Guests are excluded and keep new requests, because they are strangers sharing the
  HOUSE account. A resend costs no website quota. Requests already queued stay as they are. The reuse
  rule of a made link is unchanged, so a product link inside its window still follows that rule on any
  channel.
- **One link goes out.** The assistant's link answer carries the request's status. A hand-back that was
  QUEUED when asked sends nothing once the link is delivered; only one that already had its link may send
  it again.
- **One bridge tab.** At each job the bridge closes every other `custom_link` tab, pinned or not, as
  well as other pinned Shopee tabs as before. Another unpinned Shopee tab is never touched.
- **The owner's tab.** The active tab of a window that really has the focus is not closed by the bridge:
  the owner may be solving the captcha in it. A job answers its block at once there. One tab is spared
  for at most 10 minutes from when it was first spared, then counts as unattended, because a tab left in
  front with nobody there must not keep a frozen bridge tab for ever.
- **A fresh tab before reporting.** On a captcha or a frozen tab the job opens a fresh tab, closes the
  old one and runs once more, reporting only if it is still blocked. At most one retry per job, none
  when the first run used more than half of the job's time, and none inside `REPLACE_TAB_EVERY_MS`. A
  hold still follows a second captcha answer, so a real captcha is retried at most once per hold. A
  login page is never retried. A page that loaded without its form is not a frozen page. When the first
  answer was a captcha and the second is `no_link`, `page_not_ready`, `form_missing` or `script_error`,
  the captcha is answered, so the hold and alert follow and the customer is not counted against.
- **An instant resume.** When a Shopee tab goes from `/verify/` to a non-verification Shopee page, the
  extension posts `POST /internal/bridge/verification-cleared` once, and the server ends a captcha hold
  still running, with one audit entry (`linking.link_queue.captcha_cleared`). It never lifts a
  lost-login pause; a page error hold keeps its own rule. The state survives a stopped service worker,
  in `chrome.storage.local`. A move made while a job is in hand is the bridge's own and tells the server
  nothing; a job that ends on a verification page leaves its tab remembered. No Shopee request is made to
  detect this and nothing solves a captcha (D8).
- **One reconcile after a clear (owner decision).** When a clear ended a hold and the latest Shopee
  reconciliation run, of any kind, failed, one reconcile starts at once through the scheduler's
  `trigger`. At most one read per clear. A clear with no hold, or after a successful run, starts none; a
  job already running is left alone; none starts while a lost login keeps the queue paused, because the
  read would refuse and record one more failed run.

## Consequences

- **The extension must be reloaded after this deploy** (`chrome://extensions`, version 0.2.0). Until then the old
  extension runs against the new server, which still works: the queue dedup applies, the rest does not.
- A captcha now reaches the owner a few seconds later, after the second look.
- A retry may submit the form a second time when a block appears after the first submit. The sub_ids are
  the same, so it makes no second request row and no other customer's link.
- A second run has only what is left of the job's time. After a captcha a late `no_link` answers the
  captcha instead, so nothing is counted against the customer; after a frozen page, with no captcha seen,
  a very late `no_link` is still counted, rather than an answer the server no longer waits for.
- A triggered reconcile restarts the 6-hour count of that job (D67), as the scheduler does for any run.
- A tab that leaves `/verify/` for any reason counts as cleared. If Shopee still distrusts the session
  the next job meets the captcha again and a new hold follows; no customer data is at risk.
- A captcha cleared while the extension was being reloaded is missed; the hold then ends by itself.
- An unpinned `custom_link` tab the owner opened and left in the background is closed at the next job.
- An owner still solving after 10 minutes on one tab can have it replaced. The time restarts only when a
  check finds the owner has left the tab.
- The extension's version is now 0.2.0, shown at `chrome://extensions`.
