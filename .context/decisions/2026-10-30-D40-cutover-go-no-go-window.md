# D40 (Cutover rollback only inside a 72-hour no-payout window)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

For 72 hours after the tunnel switch the new system records no payouts. Rollback to the live system is allowed only inside that window; after it the new system is final.

## Rationale

Payouts, customers and share codes recorded only in the new system would be missing after a rollback, which reopens double payment; a no-payout window is simpler than a write-back tool for one operator (review C3).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d40-cutover-go-no-go-window`)
