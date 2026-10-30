# D55 (FROZEN suspends awards; a commission drop is reviewed)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

A FROZEN order suspends its campaign award instead of voiding it; only REJECTED or REVERSED voids an award. An approved commission that drops but stays above 0 freezes an approved unpaid order for review and creates a partial clawback for a paid one.

## Rationale

A transient unknown status should not cost the customer the bonus, and a partial refund after approval had no defined transition (review M2, M3).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d55-frozen-is-a-hold`)
