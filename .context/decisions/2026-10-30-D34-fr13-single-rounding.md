# D34 (New approvals follow FR-13: cashback is the only rounding step (half-up))

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the architecture run).

## Decision

New approvals follow FR-13: cashback is the only rounding step (half-up). The live half-even rounding of fee and tax is retired; imported amounts stay unchanged.

## Rationale

One formula everywhere; the difference is at most 1 dong per new approval.

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/domain-model.json (decision `d34-fr13-single-rounding`)
