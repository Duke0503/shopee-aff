# D43 (Hourly 7-day read plus a nightly sweep; a page cap freezes nothing)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

The hourly reconciliation reads the last 7 days by purchase time. A nightly paced sweep reads, one day at a time with a page cap per slice, every day that still holds an awaiting or approved unpaid order; each order stores last_seen_in_report_at for aging. A read that hits a page cap fails the run and alerts the owner but freezes no order, which replaces the page-cap part of D31.

## Rationale

Shopee approves 30 to 70 days after purchase; reading 90 days every hour exceeds the page cap or pages the report into captcha (review H4, M4).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d43-reconciliation-read-window`)
