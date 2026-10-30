# D38 (Shopee UNPAID is not a cancel signal)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

Every network adapter reads statuses through an explicit status map (raw value to AWAITING, APPROVED or CANCELLED; anything else is unknown and freezes the order), golden-tested on real report rows. Shopee UNPAID means the buyer has not paid yet and maps to AWAITING. Staff can move a wrongly REJECTED order back to AWAITING_APPROVAL through a review case when the latest report row shows no cancel signal.

## Rationale

In the Shopee report UNPAID describes the buyer's payment, and the live reader maps it to awaiting; listing it as a cancel signal would reject normal and COD orders permanently (review C1).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d38-shopee-unpaid-not-cancel`)
