# D41 (Payout void restores the state the report gives)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

Voiding a payout sets each covered order to the state transition() gives from its latest report row (REVERSED if a cancel was seen, else APPROVED), closes that order's clawback with an offsetting entry, reverses the netting entries the payout wrote, and returns bonuses to CONFIRMED, or VOID when their order is now REVERSED. All four combinations are golden-tested.

## Rationale

Returning every covered order to APPROVED would make an order the network cancelled payable again (review H2).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d41-void-restores-observed-state`)
