# D39 (Payout claims are kept and protect the transfer)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

Payout claims are kept with status OPEN, CONFIRMED or ABANDONED and a qr_shown_at time. Orders covered by an OPEN claim are not reversed: the cancel is recorded and applied by the first run after the claim ends. Confirm is idempotent by claim id and succeeds on an abandoned claim when no other claim is open and every covered order is unchanged. Each claim has its own transfer reference (customer code plus a short claim id), and opening a customer whose last claim was abandoned after the QR was shown warns that a transfer may already have been made.

## Rationale

The operator transfers before confirming; refusing to record a transfer that already left the bank invites a second transfer (review C2).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d39-payout-claim-kept`)
