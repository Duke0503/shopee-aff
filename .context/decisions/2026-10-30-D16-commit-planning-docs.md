# D16 (planning documents are committed)

- Status: accepted
- Date: 2026-10-30
- Approved by: the project owner, in the setup session

## Context

The earlier rule kept `docs/architecture-v2/` and `_bmad-output/` out of git because the GitHub
repository is public. As a result the v2 design documents exist on no machine at hand.

## Decision

Planning documents (`docs/`, `.context/`, `_bmad-output/`) are committed. The owner makes the
GitHub repository private before they are pushed.

## Consequences

`_bmad-output/` is removed from `.gitignore`. Secrets, the database, backups, the browser profile
and Zalo credentials stay ignored.

## Links

- docs/domain-model.json (decision `d16-commit-planning-docs`)
- docs/rules/git.md
