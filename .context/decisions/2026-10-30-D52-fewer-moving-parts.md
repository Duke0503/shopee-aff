# D52 (Fewer moving parts in the server)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

Modules have a pure domain folder plus plain module files and http routes, without separate application and infrastructure layers; packages/time, packages/text and packages/domain merge into packages/core, and packages/money stays separate. An OS lock file and in-memory running flags replace job_leases and job_runs. The assistant pulls notifications from the internal listener and keeps a local sent-ids file instead of serving a loopback listener. Each backup is restore-checked automatically; a manual drill runs at cutover and quarterly.

## Rationale

For about 30 orders a day and one developer, four layers, a PID lease, a second token boundary and a monthly manual drill add work without protecting against the real hazards (review S1 to S4).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d52-fewer-moving-parts`)
