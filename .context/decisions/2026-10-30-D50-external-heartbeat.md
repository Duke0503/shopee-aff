# D50 (Liveness is checked from outside the machine)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

The server pings an external heartbeat checker (healthchecks.io free tier or a Cloudflare Worker cron) that alerts the owner on Telegram when pings stop. The Mac never sleeps and restarts after power failure (pmset), sits on a UPS if possible, starts Chrome as a LaunchAgent, and the runbook covers the FileVault reboot.

## Rationale

Every alert is sent by the same Mac, so power loss, sleep, an ISP outage or the FileVault pre-boot screen means total silence (review H10).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d50-external-heartbeat`)
