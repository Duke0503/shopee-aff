# D10 (Only the Zalo assistant creates customers)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Carried over from the live system (docs/reference/v1-handover.vi.md).

## Decision

Only the Zalo assistant creates customers. The public web signs in or accepts an existing code; an unknown code is not found.

## Rationale

The assistant has just seen the person in Zalo; the web cannot prove who someone is.

## Links

- docs/domain-model.json (decision `d10-only-assistant-creates-customers`)
