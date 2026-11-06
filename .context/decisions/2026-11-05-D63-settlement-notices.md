# D63 (Telegram settlement notices to the DP Business group)

- Status: accepted
- Date: 2026-11-05
- Approved by: the project owner asked for these notices and set their scope to network settlement
  batches and their match result; review cases are not notified (2026-11-05). The spec is
  `_bmad-output/implementation-artifacts/spec-payouts-telegram-settlement-notices.md`.

## Context

The DP Business group hears about orders (D62) but not about money the network pays: a new batch, its
status changes and its match result reach no one unless they open the admin desk.

## Decision

- Each change of a settlement that is told writes one row in `settlement_business_notices` in the
  record's own transaction, keyed `settlement:<id>:<event>`, so one settlement and event is told once
  however often the payout record page is re-read. The events are `created`, `paid`, `failed`,
  `matched` and `mismatch`, written status before match, so `paid` goes before `matched`.
- A batch first seen already paid is told as `created` showing PAID, then by its match, with no
  separate `paid`.
- A later paid time or order list, changed facts and the cutover import tell nothing. There is no
  backfill: an old batch is told only when it takes a new change after deploy.
- A job every 30 seconds delivers under the rules of D62: at most 10 per run, outside any transaction,
  stopping at the first failure; a row pending over 24 hours becomes EXPIRED and is counted in one log
  line. Rows hold no amounts; the text is rendered from the stored settlement at send time. Log lines
  carry notice ids and events only.
- The chat is `TELEGRAM_BUSINESS_CHAT_ID`, with no fallback. Without it neither notice job runs, rows
  are stored and production logs the existing `orders.business_notice.chat_absent` error once.

## Consequences

- No notice names a customer. Matching, money and order logic are unchanged, and so are the order
  notices.
- Because the text is rendered at send time, a `created` notice delayed by a Telegram outage shows the
  batch's status at send time, which may already be PAID, followed by its `paid` notice.
- A listed batch whose match is `MATCHED` can still open a `settlement_mismatch`, `settlement_conflict`
  or `settlement_not_approved` case. It sends `matched`, with a warning line naming the batch's open
  cases; a clean match has no such line. The case itself raises no notice.
- Orders and settlements are delivered by two jobs, so their notices keep their order within each kind
  only.
