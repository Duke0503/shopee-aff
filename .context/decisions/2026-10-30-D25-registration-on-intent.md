# D25 (The assistant registers a person on the first private message or the first product link pasted in the community group)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Raised by the PRD review and the audit of list defects (`_bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/`).

## Decision

The assistant registers a person on the first private message or the first product link pasted in the community group. Group membership alone registers no one.

## Rationale

Most group members never request a link; registering them creates empty rows and noise in merges. Answers OQ7.

## Links

- docs/domain-model.json (decision `d25-registration-on-intent`)
