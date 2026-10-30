# D42 (A clawback is a sum of insert-only ledger entries)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

A clawback's open amount is the sum of its insert-only ledger entries: the negative original (stored cashback plus any paid bonus, D35) and positive netting and write-off entries. A payout nets open clawbacks up to the gross payable and carries the rest forward; when the clawbacks cover the whole gross, a netting-only payout (transfer 0, no QR, no message) marks the orders paid. A merge moves no ledger entry; balances resolve through aliases. The payable balance is defined as the net figure and the deduction is shown to the customer.

## Rationale

Ledger entries are insert-only, partial netting was undefined, and with a 0 floor a customer whose clawbacks exceeded the cashback could never be paid or cleared (review H3, M17).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d42-clawback-entry-sum`)
