# D21 (Issuing a new password ends every other session of that customer)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Found while extracting the domain from the live code (src/cashback, apps/server).

## Decision

Issuing a new password ends every other session of that customer.

## Rationale

A customer who asks for a new password expects the old access to stop.

## Links

- docs/domain-model.json (decision `d21-password-reissue-ends-sessions`)
