# D49 (The public receipt page shows facts only)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

The public receipt page shows customer code, last four digits, amount, date and voided state, never the proof image. Proof images are JPEG or PNG only, re-encoded with EXIF stripped, stored in a backed-up files directory, and served only to staff and the signed-in customer with a fixed content type, nosniff and a strict CSP.

## Rationale

A proof is a bank screenshot with the full account number and holder, and an uploaded file on the customer origin is a stored-XSS vector (review H9, M12).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d49-receipt-facts-only`)
