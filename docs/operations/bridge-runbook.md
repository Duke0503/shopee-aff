# Browser bridge runbook

What the owner does when the link queue raises a bridge alert (AD-14, AD-27, Story 5.5). The
affiliate browser is the `apps/bridge` extension in the affiliate Chrome profile; the server never
signs in to Shopee itself (D8).

| Alert | Severity | What the server did | What to do |
|---|---|---|---|
| `bridge_captcha` | high | The job met a verification page, looked again once in a fresh tab and was still blocked (D68). Held the Shopee link queue for 5 minutes, uncounted; it tries one job again after that, or at once when the verification is cleared | [Clear the verification](#clear-the-verification) |
| `bridge_page_error` | warning | Held the queue for 1 minute, uncounted (the custom-link page did not load, or its script broke). The same request breaking the page again right after backs off alone and the others go first; a request still breaking it 30 minutes after its first page error is FAILED and its customer told | Look at the bridge tab; if it repeats, [restart the bridge tab](#restart-the-bridge-tab) |
| `bridge_login_lost` | critical | Paused the Shopee link queue until it is resumed; nothing more goes to the browser | [Sign in again](#sign-in-again) |
| `bridge_short_link_unresolved` | warning | The browser could not follow a returned short link to its target, so its sub_ids could not be checked; that request is retried after 1 minute, uncounted and never FAILED for it | Check the affiliate Chrome is online; if it repeats, [restart the bridge tab](#restart-the-bridge-tab) |

While the queue is held for a captcha or paused, a customer who sends a Shopee link is told at once
that the system has trouble making it (`link_queue_stopped`), and the owner's chat gets one
`link_request_stuck` message per waiting request, with the customer's name and id, the product and
the reason (D65). Neither happens for a page error hold, which lasts one minute. A stuck Zalo request
follows by its usual notification when the queue reopens, once. A customer who resends a link that is
still waiting on the same channel gets the same request back (`reused`), so one link and one
notification follow however many times it was sent, and on the website the resend costs no quota
(D68). A resend on the other channel (Zalo and the website) makes a new request, and guests, who are
strangers sharing the HOUSE account, keep new requests. A product link already asked for inside the
reuse window still follows the older reuse rule, on any channel.

TikTok Shop requests go through the AccessTrade API, not the browser, and are served while the
Shopee queue is held or paused. Each alert kind is sent at most once per cooldown (critical 5
minutes, high 15, warning 30); repeats inside it are counted on the alert.

## Sign in again

1. Open the affiliate Chrome (the production profile on the operator's machine, never a dev one).
2. In the pinned `affiliate.shopee.vn` tab, sign in to the affiliate account by hand. Clear any
   verification Shopee shows on the way.
3. Open `https://affiliate.shopee.vn/offer/custom_link` and check the form shows.
4. Resume the queue: `cd apps/server && CASHBACK_ENV=prod pnpm link-queue:resume --as <admin>` (asks
   the admin's password). The answer is one JSON line, `{"ok":true,"command":"link-queue",
   "resumed":true,"pausedReason":"login_redirect"}`. The resume is written to the audit trail.
5. Within 5 seconds the link job serves the queue again, oldest request of the highest priority
   (Zalo, web, guest) first. The request that met the login page was not counted.

## Clear the verification

1. In the affiliate Chrome, look at the pinned tab. A `/verify/` page is a captcha or traffic check.
2. Solve it by hand at a person's pace; do not reload repeatedly.
3. Nothing else is needed. When the tab leaves `/verify/` for a Shopee page, the extension tells the
   server and the hold ends at once: links start within 5 seconds, and if the latest Shopee
   reconciliation run failed, one reconcile starts at once. The audit trail shows
   `linking.link_queue.captcha_cleared`.
4. If that did not happen (the extension was reloaded while the tab was on `/verify/`, or the server
   could not be reached), the hold ends by itself at `held_until`. To serve the queue at once, resume
   it with the same command as above (`link-queue resume`), which also clears a hold.

While you are solving it, keep the tab active and Chrome in the foreground. The bridge does not close
that tab; a job that meets a block on it answers at once instead of opening a fresh tab. It spares one
tab for at most 10 minutes from when it first spared it, then treats it as unattended, so a tab left in
front with nobody there cannot keep a frozen bridge tab. A tab active in a Chrome that is in the
background has no such protection. Clearing a captcha never lifts a lost-login pause, and a page error
hold keeps its own rule.

## One bridge tab

The bridge keeps one `custom_link` tab. At each job it closes any other `custom_link` tab, pinned or
not, and any other pinned Shopee tab, except the owner's tab as above. It never touches
another unpinned Shopee tab, so work in those if you need the affiliate site.

On a captcha or a frozen page a job opens a fresh tab, closes the old one and runs once more; only a
second block is reported. A job gets one such retry, none when more than half of its time is used,
and the bridge replaces a tab at most once every 5 minutes.

## After a deploy that changes the extension

Reload the extension at `chrome://extensions` in the affiliate Chrome, and check the version on its
card there: 0.2.0 or later has the D68 rules (one tab, the fresh-tab retry, the instant resume), which
run only after that reload. The extension talks to the same server until then, so the server can be
deployed first.

## Restart the bridge tab

1. Close the pinned `affiliate.shopee.vn` tab. The next job opens it again by itself.
2. If page errors continue, reload the extension at `chrome://extensions` and check its options
   (server address and bridge token).

## Counted failures

Any other failure (the form was missing, Shopee refused the link, no link came back, the returned
link failed the server's host or sub_id check, or the AccessTrade API failed) is counted. The third
counted failure fails the request (FAILED) and tells the customer once ("link failed"); a guest
request is never told. A TikTok Shop product that AccessTrade says is outside its programme fails
at once, with its own message to the customer. In production without `ACCESSTRADE_API_KEY`,
TikTok Shop links are refused when they are submitted.
