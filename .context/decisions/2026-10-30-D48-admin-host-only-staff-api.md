# D48 (Staff API exists only on the admin host)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

The staff route group is registered only for the admin host, and every staff route verifies the Cloudflare Access JWT in addition to the staff session. Sign-in failures use a doubling delay per code instead of a fixed lock, Cloudflare rate-limit rules guard sign-in and link endpoints, and CF-Connecting-IP is only a rate-limit key.

## Rationale

Both hostnames reach one public listener, so without a host check Access is bypassed through hoantiendp.com/api/admin (review H8, M10).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d48-admin-host-only-staff-api`)
