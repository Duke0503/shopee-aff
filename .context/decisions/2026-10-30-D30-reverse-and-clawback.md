# D30 (An order cancelled after approval and before payout becomes REVERSED and leaves every payout)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner (recommended option), from the status-flows party session.

## Context

The owner reported a cancelled order still shown as money owed in the payout screen. See `.context/discussions/domain/2026-10-30-status-flows-party.md`.

## Decision

An order cancelled after approval and before payout becomes REVERSED and leaves every payout. An order cancelled after payout stays PAID and gets a clawback entry that is netted against the customer's next payout; an admin may write it off with a reason.

## Rationale

Today a cancel after approval is silently skipped; the customer could be paid for a cancelled order. Asking customers to send money back loses them.

## Links

- docs/operations/status-flows.md
- docs/domain-model.json (decision `d30-reverse-and-clawback`)
