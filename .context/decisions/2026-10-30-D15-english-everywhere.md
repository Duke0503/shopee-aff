# D15 (project files are written in English)

- Status: accepted
- Date: 2026-10-30
- Approved by: the project owner, in the setup session

## Context

Code was already English, but the docs were Vietnamese. The domain model needs one ubiquitous
language shared by documents and code.

## Decision

Code, docs, the domain model, decisions and logs are written in English. Chat with the team
follows the person's language. Customer-facing text is Vietnamese and lives only in
`resources/messages.vi.json` and `resources/dashboard.vi.json`.

## Consequences

The existing Vietnamese docs stay as reference input. New planning documents are English.

## Links

- docs/domain-model.json (decision `d15-english-everywhere`)
- docs/rules/writing.md
