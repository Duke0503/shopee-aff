# D24 (An admin can void a payout recorded by mistake)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Raised by the PRD review and the audit of list defects (`_bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/`).

## Decision

An admin can void a payout recorded by mistake. The covered orders return to approved and their bonuses to confirmed, with history and audit. Reconciliation still never changes a paid order.

## Rationale

A mistaken payout otherwise has no correction path; a compensating command keeps D4 intact for every automatic path.

## Links

- docs/domain-model.json (decision `d24-payout-void`)
