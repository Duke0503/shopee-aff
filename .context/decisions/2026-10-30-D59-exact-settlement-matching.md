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

## Consequences

- New story in Epic 4: network settlement matching with an exact dong check, a per-payout order
  list with product thumbnails, and settled-by-payout shown on every order and in the payout panel.
- New probe in Epic 5: read the Shopee payout detail page through the bridge if it lists orders.
- Open question for the owner: does the Shopee Affiliate payout record page offer a detail view or
  download listing the conversions of each payout?

## Links

- docs/domain-model.json (decision `d59-exact-settlement-matching`); amends D53
