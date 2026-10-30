# D59 (exact settlement matching for network payouts)

- Status: accepted
- Date: 2026-10-30
- Approved by: the project owner asked for it; the matching design is the recommended option.

## Context

The live system marks every order approved before a payout's creation time as settled, so the owner re-checks and adds up orders by hand against Shopee after every payout. The owner asked for an exact view (2026-10-30). Live code: `src/cashback/shopee/payout_sync.py` reads only the payout total
(`totalPaymentAmount`, `eligibleTotalAmount`) and `ledger.settle_orders_for_batch` settles by
`approved_at <= payout created time`.

## Decision

Each network payout is matched to exact orders, never by a date cut-off. When the network lists the orders of a payout (payout detail page read through the browser bridge, or an export), those orders are settled by id. Otherwise the payout is matched to the orders validated in its billing period: if their approved commission minus fee and tax equals the payout amount to the dong, every order is marked settled with the payout id; any difference is shown with the candidate orders and opens a review case, and nothing is guessed. FR-19 moves into the v1 cutover scope.

## Findings from the production backup (2026-10-31, Sprint 17)

The live `payout_batches` table (11 Shopee batches, 24/9 to 29/10/2026) changed how the decision is
carried out; the decision itself stands.

- Shopee makes a payout batch every three or four days (24/9, 28/9, 1/10, 5/10, 8/10, 12/10, 15/10,
  19/10, 22/10, 26/10, 29/10), not one per month. Its raw record holds `payoutId`,
  `payoutCreatedTime` (unix seconds), `eligibleTotalAmount` and `totalPaymentAmount` (both x100,000,
  so "6074300000" is 60,743 dong), `payoutPaymentStatus`, `payArrivalTime`, `invoiceStatus`,
  `accountType`.
- `totalPaymentAmount` is what the operator receives, `eligibleTotalAmount` the batch's gross
  commission. Received over gross is exactly 0.99020 (fee 0.98%, no tax) for the batches of 24/9 and
  1/10 and 0.89020 (fee 0.98% plus 10% tax, both on the gross) for all others: the FR-13 split. So a
  batch's withholding is read from its two amounts (packages/money `classifyWithholding`, tolerance
  1% of the gross, at least 2 dong, for Shopee's per-order rounding); a batch that fits neither split
  opens a review case. Real cases: 168,347 to 166,698 not withheld; 434,665 to 386,938 withheld;
  60,743 to 54,073 withheld (golden `fixtures/money/settlement-match.json`).
- Withholding is therefore per batch, not per month. An approval takes the latest batch's
  withholding of its network as the estimate; the Settings period mark is the owner's override, not
  the primary source (Story 4.18).
- The gross of all batches (1,509,019) is more than the commission of the customer-attributed paid
  orders (1,420,946): batches also pay for orders attributed to no customer (guest, unknown sub_id).
  An amount alone cannot identify orders. The matching rule is: (a) with the network's order list,
  settle exactly those orders (APPROVED or PAID only; any other, or one another batch settled, is
  refused with a case); (b) otherwise the network's approved, unsettled orders approved in the
  batch's window (from the previous batch's creation to this batch's) are settled when their gross
  fits inside the batch's gross, and the rest is recorded as unattributed; a mismatch is only orders
  that exceed the batch or rules that do not apply.
- The live ledger stored no approved commission and no approval time (`approved_commission` and
  `approved_at` NULL, every order `unsettled` with no `payout_batch_id`). Its paid and update times
  are when the operator paid the customer, always after Shopee paid, so they cannot place an order
  in a batch's window (a rehearsal on the real copy put 18 orders, 684,817 dong, into a batch of
  120,970 and none into others). Therefore:
  - Batches imported at cutover are HISTORIC: their facts, withholding, fee, tax and received amount
    are kept and shown as totals only, labelled as from before the system change; they are never
    matched, write no order lines and open no case.
  - Imported orders get no settlement link; their PAID state is the live system's. Their live
    estimated commission is shown for display only and never used in matching.
  - Window matching uses only orders whose approval this system recorded (origin REPORT) and only
    batches this system records. The first such batch's window starts at the go-live (the cutover
    import), not at the last historic batch.

## Consequences

- New story in Epic 4: network settlement matching with an exact dong check, a per-payout order
  list with product thumbnails, and settled-by-payout shown on every order and in the payout panel.
- New probe in Epic 5: read the Shopee payout detail page through the bridge if it lists orders.
- Open question for the owner: does the Shopee Affiliate payout record page offer a detail view or
  download listing the conversions of each payout? Until it does, batches are matched by window.
- Open question: is a batch's window the order's validation time at Shopee or our approval time? The
  report gives no validation time today; approval time is used.

## Links

- docs/domain-model.json (decision `d59-exact-settlement-matching`); amends D53
