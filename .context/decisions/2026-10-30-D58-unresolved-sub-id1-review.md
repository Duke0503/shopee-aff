# D58 (An unresolved sub_id1 is a review case, never credited to the sub_id2 owner)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the Sprint 4 code review).

## Context

The live system (`src/cashback/shopee/reconciliation.py:60-80`) credits the owner of the sub_id2
link request whenever sub_id1 does not resolve, including when sub_id1 is present. Story 2.7
first copied that fallback.

## Decision

When a report row carries a sub_id1 that resolves to no known, non-erased customer, the order is
not credited to the sub_id2 request's owner automatically: a review case `unattributed_sub_id1`
opens with that owner as the suggested candidate. When sub_id1 is empty (legacy links), the
sub_id2 owner may still be used, as the live system does. A raw id that resolves to no known,
non-erased customer is never credited, and the `DEV` guard applies to the sub_id2 owner as well.

## Rationale

A present but unknown sub_id1 means the link's customer is not who the request says, or the data
is damaged. Crediting the request owner silently could pay the wrong person (INV-1, D6).

## Links

- docs/domain-model.json (decision `d58-unresolved-sub-id1-review`, rule `orders.order.attribution-order`)
- apps/server/src/modules/orders/domain/attribution.ts
- packages/golden/fixtures/attribution/attribution.json
