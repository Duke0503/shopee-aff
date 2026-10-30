# D45 (Cutover converts times by column)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

The cutover import converts timestamps with a per-column table (column, source zone, fallback), each entry fixture-tested: CURRENT_TIMESTAMP columns are UTC, campaign windows are Vietnam time, dates synthesized from the order SN prefix are flagged approximate. A value that fits no rule is reported, never guessed.

## Rationale

Live naive timestamps differ by column; one rule would move campaign windows, and so bonus slots, by 7 hours without an error (review H6).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d45-cutover-time-provenance`)
