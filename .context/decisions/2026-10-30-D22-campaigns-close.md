# D22 (A campaign closes automatically at the end of its window, and the window end is exclusive everywhere)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Found while extracting the domain from the live code (src/cashback, apps/server).

## Decision

A campaign closes automatically at the end of its window, and the window end is exclusive everywhere.

## Rationale

Today nothing closes a campaign and the v2 code disagreed with Python on the window end.

## Links

- docs/domain-model.json (decision `d22-campaigns-close`)
