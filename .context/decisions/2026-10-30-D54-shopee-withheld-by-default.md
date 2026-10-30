# D54 (Shopee periods are withheld by default)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

A Shopee settlement period counts as withheld (10% tax) unless staff unmark it. Unmarking affects only approvals after it; stored cashback is never recomputed.

## Rationale

At 30 orders a day almost every Shopee period reaches the 2,000,000 dong withholding threshold, but staff learn it only after approval, so a not-withheld default makes the operator absorb the tax (review M1).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d54-shopee-withheld-by-default`)
