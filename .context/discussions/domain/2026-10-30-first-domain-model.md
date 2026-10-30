# Domain session: first domain model (2026-10-30)

- Participants: Mary (analyst), Winston (architect), facilitated by Claude. The project owner
  delegated every choice to the recommended option.
- Sources: `CLAUDE.md`, `docs/index.md`, `docs/reference/v1-handover.vi.md`,
  `docs/reference/v2-agent-rules.md`, `src/cashback/`, `zalo_assistant/`, `apps/server/src/modules/`.
- Result: `docs/domain-model.json` version 0.2.0. Eight bounded contexts, D1 to D23, OQ1 to OQ8.

## Positions

**Mary** classified the business as attribution and exact payment. Linking, Order Tracking and
Cashback Payouts are core, because a wrong link or a double payout loses money and trust.
Identity, Campaigns and Customer Conversation support them. Deals and Operations are generic.

**Winston** kept the v2 module split where it matched the language, with three changes:

- Campaigns leave Order Tracking. A campaign owns its slots and has its own lifecycle; it reacts
  to order events.
- Payouts is its own context. It owns the one payout command (D19 (every payout covers only
  approved, unpaid orders and confirmed bonuses)) and the network settlement track.
- AccessTrade reconciliation moves out of Linking into Order Tracking, behind a report translator.
  In v2 it wrote orders from the affiliate module.

They disagreed on the expired state of a link request. Mary wanted it for the operator's list;
Winston showed it was bookkeeping only and misleading. Resolved by D23 (being outside the
attribution window is derived, not stored).

## Findings in the live code (main)

1. The admin confirm-payment screen (`src/cashback/web/dashboard.py`, `_admin_payment_confirm`)
   marks orders paid without checking status or paid time, can pay awaiting orders, fills missing
   cashback from the estimate, writes no history, and pays held bonuses. This breaks D3 (cashback
   from the approved commission only) and D4 (never pay twice). Recorded as D19 for the new
   platform. Not fixed on `main`, because `main` is production and out of scope.
2. Shopee, AccessTrade and the estimates use three different commission formulas. Recorded as D20
   (one split function, rates per network).
3. A hard-coded deploy webhook secret and a third-party lookup key are in the public repository
   (OQ8).

## Decisions taken (delegated, recommended option)

D1 to D13 confirmed (OQ6 resolved). D17 to D23 accepted. Each has a file in
`.context/decisions/`.

## Open

OQ1 (storage), OQ2 (stack) go to the architecture step. OQ5 (earlier v2 docs), OQ7 (group sync
creates customers) and OQ8 (hard-coded secrets) need the owner.
