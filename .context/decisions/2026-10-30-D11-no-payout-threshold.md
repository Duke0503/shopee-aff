# D11 (Every approved, unpaid order is payable, grouped by customer)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Carried over from the live system (docs/reference/v1-handover.vi.md).

## Decision

Every approved, unpaid order is payable, grouped by customer. The operator decides when to pay, so no message promises a date.

## Rationale

The old 50,000 dong threshold was a rule customers could not see or act on.

## Links

- docs/domain-model.json (decision `d11-no-payout-threshold`)
