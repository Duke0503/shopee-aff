# D32 (Payout confirmation re-reads every covered order inside the transaction and fails if any is not APPROVED, unpaid and owned by that customer)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner (recommended option), from the status-flows party session.

## Context

The owner reported a cancelled order still shown as money owed in the payout screen. See `.context/discussions/domain/2026-10-30-status-flows-party.md`.

## Decision

Payout confirmation re-reads every covered order inside the transaction and fails if any is not APPROVED, unpaid and owned by that customer. Awaiting money is never shown as owed, in any total, QR or selection.

## Rationale

The live payments screen showed awaiting money by default and the confirm endpoint did not check status.

## Links

- docs/operations/status-flows.md
- docs/domain-model.json (decision `d32-confirm-rereads-orders`)
