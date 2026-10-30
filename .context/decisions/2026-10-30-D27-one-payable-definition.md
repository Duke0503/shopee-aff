# D27 (Payable means approved and not paid, whether or not the network has settled it)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Raised by the PRD review and the audit of list defects (`_bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/`).

## Decision

Payable means approved and not paid, whether or not the network has settled it. Settlement is separate information. Every screen, chat reply and export uses this one definition.

## Rationale

Today 'ready' has three definitions and the customer page, the customer list and the payments queue disagree.

## Links

- docs/domain-model.json (decision `d27-one-payable-definition`)
