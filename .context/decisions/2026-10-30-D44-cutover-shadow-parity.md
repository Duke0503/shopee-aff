# D44 (Cutover parity by shadow reconciliation)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

At cutover, paid totals per customer must match the live system to the dong. Payable and waiting amounts are checked by a shadow run of the new reconciliation on the rehearsal copy over the full report window, producing a per-order diff the owner signs off. Live payable is one named SQL in the cutover tool. An unresolved order older than the report can verify becomes FROZEN with a review case.

## Rationale

The live payable figures carry known defects (three definitions of ready, the first-item-only status bug); parity with them would import cancelled orders as payable (review H5).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d44-cutover-shadow-parity`)
