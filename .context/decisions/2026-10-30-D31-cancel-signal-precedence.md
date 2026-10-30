# D31 (A cancel signal is checked in a fixed order: order-level status, then each item, then a commission of 0)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner (recommended option), from the status-flows party session.

## Context

The owner reported a cancelled order still shown as money owed in the payout screen. See `.context/discussions/domain/2026-10-30-status-flows-party.md`.

## Decision

A cancel signal is checked in a fixed order: order-level status, then each item, then a commission of 0. An unknown status, a missing order id or a report page cap freezes the order (FROZEN), excludes it from every total and opens a review case.

## Rationale

The live reader uses only the first item's status, so a cancelled order stayed awaiting and was shown as money owed.

## Links

- docs/operations/status-flows.md
- docs/domain-model.json (decision `d31-cancel-signal-precedence`)
