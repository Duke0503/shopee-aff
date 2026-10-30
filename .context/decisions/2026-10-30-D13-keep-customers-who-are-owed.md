# D13 (A customer who is still owed money is never deleted, except by an explicit forced action of the operator)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Carried over from the live system (docs/reference/v1-handover.vi.md).

## Decision

A customer who is still owed money is never deleted, except by an explicit forced action of the operator.

## Rationale

Deleting such a customer loses a debt the operator must still pay.

## Links

- docs/domain-model.json (decision `d13-keep-customers-who-are-owed`)
