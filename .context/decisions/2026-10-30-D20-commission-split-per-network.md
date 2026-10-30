# D20 (The commission split is one function in the shared money package, with a fee rate and a tax rule per network)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Found while extracting the domain from the live code (src/cashback, apps/server).

## Decision

The commission split is one function in the shared money package, with a fee rate and a tax rule per network. The customer share is 80% of net on every network.

## Rationale

Today Shopee, AccessTrade and the estimates each use a different formula.

## Links

- docs/domain-model.json (decision `d20-commission-split-per-network`)
