# D23 (A link request has no expired state)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Found while extracting the domain from the live code (src/cashback, apps/server).

## Decision

A link request has no expired state. Being outside the attribution window is derived from the request time.

## Rationale

The expired state was bookkeeping only, misled readers into thinking the link stopped working, and its job ran only in one entry point.

## Links

- docs/domain-model.json (decision `d23-no-expired-state`)
