# D19 (Every payout goes through one command)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Found while extracting the domain from the live code (src/cashback, apps/server).

## Decision

Every payout goes through one command. It covers only approved orders without a paid time and only confirmed bonuses, and it writes the order history.

## Rationale

The live admin confirm-payment screen skips these checks and can pay awaiting or already-paid orders.

## Links

- docs/domain-model.json (decision `d19-one-payout-path`)
