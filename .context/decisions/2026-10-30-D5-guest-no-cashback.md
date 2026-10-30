# D5 (A link made without a customer code belongs to the guest account HOUSE)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Carried over from the live system (docs/reference/v1-handover.vi.md).

## Decision

A link made without a customer code belongs to the guest account HOUSE. A guest link never earns cashback, and its orders are never moved to a customer who registers later.

## Rationale

All guests are the same payee, so one link per product is enough and the operator keeps the commission.

## Links

- docs/domain-model.json (decision `d5-guest-no-cashback`)
