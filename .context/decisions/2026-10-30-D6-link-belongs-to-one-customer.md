# D6 (A link belongs to exactly one customer through sub_id1)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Carried over from the live system (docs/reference/v1-handover.vi.md).

## Decision

A link belongs to exactly one customer through sub_id1. A link is reused only for the same customer; product facts (price, rates) may be shared.

## Rationale

Reusing a link by product sent customer B's money to customer A in production (fixed on 2026-09-25).

## Links

- docs/domain-model.json (decision `d6-link-belongs-to-one-customer`)
