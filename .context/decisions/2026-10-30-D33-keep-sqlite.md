# D33 (The new platform keeps SQLite in WAL mode with the server as the only writer (AD-2))

- Status: accepted
- Date: 2026-10-30
- Approved by: Approved by the project owner on 2026-10-30.

## Decision

The new platform keeps SQLite in WAL mode with the server as the only writer (AD-2). PostgreSQL only if a second writer process is ever needed.

## Rationale

Low volume, one operator, one home machine; the live system already runs on SQLite.

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/domain-model.json (decision `d33-keep-sqlite`)
