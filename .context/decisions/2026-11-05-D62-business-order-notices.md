# D62 (Telegram order notices to the DP Business group)

- Status: accepted
- Date: 2026-11-05
- Approved by: the project owner confirmed the message format with a screenshot of the group and
  chose the cashback figure on the new-order message (2026-11-05). The spec is
  `_bmad-output/implementation-artifacts/spec-orders-telegram-business-alerts.md`.

## Context

Since the 2026-11-02 cutover the DP Business Telegram group gets no order messages: the new platform
never ported the live system's four order notices (`src/cashback/core/telegram_alerts.py`), and a
frozen order raises no owner alert.

## Decision

- Every order step to a notified status (recorded, approved, rejected, reversed, paid) writes one row
  in `order_business_notices` in the step's own transaction, keyed `order:<id>[@<reopens>]:<event>`,
  so one order, event and lifecycle is told once however often a report is re-read. A restore after
  a freeze, a reopen and a voided payout are not told. Guests are told, as the live system did.
- A job every 30 seconds expires rows pending over 24 hours, then claims, sends and records at most
  10 per run outside any transaction, and stops at the first failure. An accepted send is never
  repeated. Rows hold no names or amounts; the text is rendered from the order at send time.
- The chat is the optional `TELEGRAM_BUSINESS_CHAT_ID`. Without it no job runs, rows are stored and
  production logs an error at start; there is no fallback to the owner's chat. The dev isolation
  check refuses a production chat.
- **Owner decision:** the new-order message shows the estimated cashback the customer is told
  (`estimatedCashback`, after the fee and withheld tax), labelled without "(80%)", not the old plain
  80%.
- A new owner alert `order_frozen` (high) is raised on every step to FROZEN. It carries no personal
  data.
- No bulk backfill and no notice for an order that took no new step after deploy, except one approved
  catch-up row for the frozen order ending `381J` (`docs/operations/production-host-runbook.md`,
  section 10).

## Consequences

- A notice's customer name and id reach the business chat only, never a log line or the owner alert.
- A payout voided and confirmed again is told once: the `paid` key belongs to the lifecycle.
- A notice that Telegram refuses for good blocks the ones behind it until it expires after 24 hours,
  because sends keep their order.
- A send whose answer is lost (a timeout after Telegram accepted it) counts as failed and is retried,
  so that one case can repeat. A process that dies between the claim and the send loses that notice.
