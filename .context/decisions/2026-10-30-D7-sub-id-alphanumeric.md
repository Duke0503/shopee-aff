# D7 (Every sub_id holds letters and digits only, and one link batch never mixes customers)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Carried over from the live system (docs/reference/v1-handover.vi.md).

## Decision

Every sub_id holds letters and digits only, and one link batch never mixes customers.

## Rationale

A dash silently breaks attribution; the network applies one sub_id to every link in a batch.

## Links

- docs/domain-model.json (decision `d7-sub-id-alphanumeric`)
