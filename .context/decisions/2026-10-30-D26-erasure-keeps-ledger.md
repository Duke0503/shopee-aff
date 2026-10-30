# D26 (Erasing a customer removes the personal data and keeps the orders, payouts and audit entries under the permanent customer id)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Raised by the PRD review and the audit of list defects (`_bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/`).

## Decision

Erasing a customer removes the personal data and keeps the orders, payouts and audit entries under the permanent customer id.

## Rationale

Deleting ledger rows breaks D4 and the append-only audit trail; the privacy law needs the personal data gone, not the money record.

## Links

- docs/domain-model.json (decision `d26-erasure-keeps-ledger`)
