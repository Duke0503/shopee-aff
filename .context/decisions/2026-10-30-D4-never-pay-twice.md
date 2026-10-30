# D4 (An order with a payout time (paid_at) is never changed or paid again)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Carried over from the live system (docs/reference/v1-handover.vi.md).

## Decision

An order with a payout time (paid_at) is never changed or paid again.

## Rationale

Reconciliation runs over overlapping periods; without this lock one order is paid two or three times.

## Links

- docs/domain-model.json (decision `d4-never-pay-twice`)
