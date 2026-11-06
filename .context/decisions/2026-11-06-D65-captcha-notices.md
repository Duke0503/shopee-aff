# D65 (Telling customers and the owner why a Shopee link is stuck)

- Status: accepted
- Date: 2026-11-06
- Approved by: the project owner chose the owner chat, one message per stuck request, and approved
  the wording of `link_queue_stopped` (2026-11-06). The spec is
  `_bmad-output/implementation-artifacts/spec-linking-captcha-notices.md`.

## Context

During a captcha a customer who sent a link heard only "about one minute", and the owner's alert did
not say who was waiting or which step found the captcha.

## Decision

- **This changes AD-27's "no personal data" for these kinds only:** `bridge_captcha` on a link
  request and `link_request_stuck` may carry a customer's name and id and the product. They go to the
  owner chat (`TELEGRAM_CHAT_ID`) only. Every other alert kind still carries no personal data.
- The queue counts as stopped while it is held by a captcha or paused by a lost login. A page error
  hold does not count, because it lasts one minute; no customer message and no stuck message comes
  from it. Its existing `bridge_page_error` alert stays.
- While the queue is stopped and a Shopee request has no link, the link reply says `queueStopped`. The
  assistant stops waiting at that poll and sends `link_queue_stopped`, tagging the sender in a group.
  A TikTok Shop request is served all the same and is not told this. The link still follows by the
  existing notification when the queue reopens, once.
- Every `bridge_captcha` raised names the step that found it: link request, product lookup, conversion
  report, payout record or the health check. A repeat inside the cooldown keeps the first detail.
- A job every 30 seconds raises one `link_request_stuck` (high) per QUEUED Shopee request while the
  queue is stopped, keyed `link_request_stuck:<requestId>`. The kind's cooldown does not apply and the
  key never repeats, even across a later stop.
- `alerts.detail` holds ids and the step only. The name and product are read in the claim's transaction
  at send time. An erased or unknown customer is named by the id alone, without the product.
- The product text is the looked-up name, or the pasted link without one. Either is cut to 200
  characters, never inside an emoji.
- **Delivery rule changed:** a Zalo request made late by the browser counts its 2 hours "stale" limit
  from when the link was made, not from the request's time. Without this, a link made after a stop
  longer than 2 hours would be closed with no message, after the customer was told it would follow.
  A web request, or one with no channel recorded, keeps the request's time.

## Consequences

- A name reaches the owner chat and never the table or a log line; log lines carry ids and kinds.
- A long stop with many requests is one message each. At 10 alerts per delivery run a large backlog
  takes time, and other alerts wait their turn behind it, oldest first.
- A stuck message delayed by Telegram can still go out after its request got its link. A failed send
  is retried on the next delivery runs, every 30 seconds, up to `ALERT_MAX_ATTEMPTS` (5), so an outage
  of a few minutes gives it up as FAILED; one not sent within 24 hours is EXPIRED. Either way its key
  stays, so it is never raised again and the owner never hears about that request.
- The delivery rule above also covers a Zalo request that was only retrying for over 2 hours, with no
  stop: it now gets its link instead of being closed silently.
- Nothing visits a Shopee page to detect anything and nothing solves a captcha (D8).
