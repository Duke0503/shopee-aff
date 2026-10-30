# Developer brief (used for every sprint)

You implement the stories of one sprint of the cashback platform re-build in this repository
(branch `main-v2`, pnpm workspace), test-first, and stop.

## Read first (binding)

- The story sections in `_bmad-output/planning-artifacts/epics/epics-cashback-2026-10-30/epics.md`.
  Every acceptance criterion needs a named test, or is reported open with the reason.
- `docs/rules/code.md`, `CLAUDE.md` (money rules), `docs/operations/status-flows.md`.
- `_bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md`
  (the ADs the story cites) and the Resolution table in `review-independent.md`.
- Decisions D1–D58 in `docs/domain-model.json` and `.context/decisions/`.
- `SECURITY_MODEL.md` when the story touches sessions, tokens, personal data or money.

## Build on the existing code

Match its style: short module docs that explain why, kebab-case files with role suffixes, no
comments that restate code, test-first. Respect `apps/server/src/modules/module-edges.json` and
dependency-cruiser. Business tables are SQL migrations in `apps/server/migrations/NNNN_name.sql`,
owned by one module (AD-4), with Drizzle definitions in that module's `schema.ts`. Every write
goes through `tx()`. Money only through `packages/money`; time only through `packages/core`.

## The live system is read-only

Read `src/cashback/`, `zalo_assistant/`, `web/`, `extension/`, `resources/` to learn behaviour;
never modify them. There is no copy of the live database in the repository; tests build one from
`apps/server/tests/fixtures/live-schema.sql` and `live-rows.sql` (extend the rows, keep data fake).

## Never

- Touch the production paths above, the `main` branch or `.github/workflows/deploy.yml`.
- Stage the untracked `.github/workflows/ci.yml`. Commit or push (the lead reviews and commits).
- Put Vietnamese text or emoji in `.ts` files (JSON fixtures and `packages/labels` may).

## Environment

Git Bash: `cp` is a shell function that launches another program, use `/usr/bin/cp`. pnpm 12.16.1
is on PATH. Python needs `C:/` paths. Write files with the Write tool; heredocs with apostrophes
fail. Verify any new dependency version with `npm view <pkg>@<version> version` first.

## Definition of done

`pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`, `pnpm guard:paths`
all pass; set the sprint's story keys in `_bmad-output/implementation-artifacts/sprint-status.yaml`
to `review`. Report back: files added/changed, test counts per package, ACs not satisfied and why,
decisions the stories did not specify. Under 450 words.
