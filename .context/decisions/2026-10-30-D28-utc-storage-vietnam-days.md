# D28 (Every instant is stored as UTC in one format)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Raised by the PRD review and the audit of list defects (`_bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/`).

## Decision

Every instant is stored as UTC in one format. Business days, weeks, months and campaign windows are computed in Asia/Ho_Chi_Minh, and a date range includes its whole end day.

## Rationale

Three stored time formats compared as text make date filters return nothing and campaigns open 7 hours late.

## Links

- docs/domain-model.json (decision `d28-utc-storage-vietnam-days`)
