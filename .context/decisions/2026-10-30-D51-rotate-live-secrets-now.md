# D51 (Rotate the exposed secrets now, without code changes)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

The owner rotates the two secrets committed on main now, in the live environment and in Cloudflare, without any code change on main, and makes the GitHub repository private. History scrubbing is left to the owner. The new platform never reuses those values.

## Rationale

If the repository is public the secrets are exposed today, not at cutover; main is not touched by the re-plan (review H11, OQ8, D16).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d51-rotate-live-secrets-now`)
