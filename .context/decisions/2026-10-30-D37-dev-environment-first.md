# D37 (A dev environment with its own Zalo account, ports, database and Chrome profile exists before the cutover rehearsal)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the architecture run).

## Decision

A dev environment with its own Zalo account, ports, database and Chrome profile exists before the cutover rehearsal. Loss or compromise of the operator machine is accepted with full-disk encryption and a production-only OS account.

## Rationale

Running dev against the production Zalo account kicks the assistant's session.

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/domain-model.json (decision `d37-dev-environment-first`)
