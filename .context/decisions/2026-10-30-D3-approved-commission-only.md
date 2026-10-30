# D3 (Cashback is calculated from the approved commission only, never from the estimate shown to the customer)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Carried over from the live system (docs/reference/v1-handover.vi.md).

## Decision

Cashback is calculated from the approved commission only, never from the estimate shown to the customer.

## Rationale

The estimate changes or disappears after returns; paying from it loses money.

## Links

- docs/domain-model.json (decision `d3-approved-commission-only`)
