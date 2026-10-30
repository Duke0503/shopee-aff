# D14 (the platform is re-planned from scratch)

- Status: accepted
- Date: 2026-10-30
- Approved by: the project owner, in the setup session

## Context

The live system is Python (`src/cashback/`), a Node Zalo assistant, a React web and a Chrome
bridge. Branch `main-v2` holds 85 commits of an earlier TypeScript v2 rewrite. Its design
documents (`docs/architecture-v2/`) were never committed and are not in the repository. The owner
wants the web and the architecture redesigned and optimized.

## Decision

The platform is re-planned from scratch. The domain model, PRD, UX design and architecture come
before any code. The current Python system and the earlier v2 code are reference only.

## Consequences

- No implementation starts until the plan is approved.
- The rules learned in production are carried over as D1 to D13, proposed until the owner
  confirms them (OQ6).
- Whether the v2 stack is kept is open (OQ2).

## Links

- docs/domain-model.json (decision `d14-replan-from-scratch`)
