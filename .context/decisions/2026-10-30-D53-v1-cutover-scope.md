# D53 (v1 ships only what money depends on)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

The v1 cutover scope is what paying, attributing and reconciling depend on. Deferred until after cutover, without deleting the FRs: FR-27 metrics beyond the Overview line, FR-31 flags except the shared bank account, the FR-19 settlement screen, the FR-23 campaign creation UI, the FR-11 merge UI, the FR-24 staff UI, the FR-29 audit screen and the Guide redesign. Merge, campaign and staff work is done by admin command until then. The build follows a walking skeleton starting with money, the cutover import and shadow reconciliation.

## Rationale

Cutover is big-bang, so the minimum cutover set bounds v1; none of the deferred items is on the pay, attribute or reconcile path (review section 6).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d53-v1-cutover-scope`)
