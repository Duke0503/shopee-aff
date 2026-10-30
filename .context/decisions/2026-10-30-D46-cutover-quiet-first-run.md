# D46 (The first run after cutover sends no messages)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

The import seeds a dedup key as already sent for every event the live system already notified. The first reconciliation after import runs with messaging silent and reports the would-be sends. Proactive Zalo sends have a hard daily cap (default 150) with an owner alert when reached.

## Rationale

New dedup keys and the stricter cancel rules would otherwise fire every notification at once on the personal Zalo account, which risks a lock on day one (review H7).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d46-cutover-quiet-first-run`)
