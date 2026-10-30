# D1 (Every amount is a whole number of dong)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Carried over from the live system (docs/reference/v1-handover.vi.md).

## Decision

Every amount is a whole number of dong. Money rounds half-up through one shared helper.

## Rationale

Python round() and JS Math.round() round half to even or toward infinity; every tool in the market shows 9,263 for 9,262.5.

## Links

- docs/domain-model.json (decision `d1-whole-dong-half-up`)
