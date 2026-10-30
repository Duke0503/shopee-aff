# Cashback Platform Documentation Index

This file is the entry point to the documentation. Read it first, then open only the documents the
task needs.

The cashback platform (hoantiendp.com) turns a product link from Shopee, TikTok Shop or Lazada
into an affiliate link for one customer, follows the order through the affiliate network, and
pays the customer a share of the approved commission. Customers reach it through a Zalo chat and
the website; the operator runs it from the admin desk.

The platform is being **re-planned from scratch** (D14 (domain model, UX, architecture and PRD come
before any code)). New documents are written in English (D15). The live system keeps running from
the Python code on `main` until the new platform replaces it.

## Planning workflow

Run these BMAD skills in order. Each one writes into `_bmad-output/planning-artifacts/` and the
next one reads it. Record every approved decision in `.context/decisions/` and in
`docs/domain-model.json`.

| Step | Skill | Output |
|---|---|---|
| 1. Domain model | `bmad-domain-driven` | `docs/domain-model.json`, `docs/domain-viz/` |
| 2. Product brief (optional) | `bmad-product-brief` | `planning-artifacts/briefs/` |
| 3. PRD | `bmad-prd` | `planning-artifacts/prds/` |
| 4. UX design | `bmad-ux` | `planning-artifacts/ux-designs/` (`DESIGN.md`, `EXPERIENCE.md`, `.memlog.md`) |
| 5. Architecture | `bmad-architecture` | `planning-artifacts/architecture/` (spine and C4 diagrams) |
| 6. Security model | `cashback-security-model` | `SECURITY_MODEL.md` |
| 7. Epics and stories | `bmad-create-epics-and-stories` | `planning-artifacts/epics/` |
| 8. Sprint planning, build | `bmad-sprint-planning`, `bmad-build` | `implementation-artifacts/` |

`bmad-help` says what to run next at any point.

## Current planning artifacts

| Artifact | Location | Status |
|---|---|---|
| Domain model | [domain-model.json](domain-model.json), views in [domain-viz/](domain-viz/README.md) | v0.7.0: 7 contexts, D1 to D55 accepted (D38 to D55 from the independent architecture review), OQ1 and OQ2 resolved by the architecture spine, OQ5 and OQ8 open |
| PRD | [prd-cashback-2026-10-30/prd.md](../_bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/prd.md) | Final: FR-1 to FR-38, UJ-1 to UJ-8; list defects in `list-defects.md`; §8.3 Release scope (v1 cutover vs after cutover) |
| UX workspace | [ux-cashback-2026-10-30/](../_bmad-output/planning-artifacts/ux-designs/ux-cashback-2026-10-30/) (`DESIGN.md`, `EXPERIENCE.md`, `.memlog.md`, `mockups/`) | Final: both spines, List Contract for FR-37/FR-38, 3 key-screen mocks |
| Architecture spine | [architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md](../_bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md) (C4 diagrams in `diagrams/`, STRIDE in `stride.md`, independent review and its resolution in `review-independent.md`, `.memlog.md`) | Final, revised after the independent review: AD-1 to AD-29 (AD-28 v1 cutover scope and build order, AD-29 external liveness); OQ1 (SQLite) and OQ2 (TypeScript monorepo, Fastify) resolved; code rules in [rules/code.md](rules/code.md) |
| Security model | [../SECURITY_MODEL.md](../SECURITY_MODEL.md) | Draft: INV-1 to INV-13, all planned enforcement; accepted risks from D37; owner review pending |
| Epics and stories | [epics-cashback-2026-10-30/epics.md](../_bmad-output/planning-artifacts/epics/epics-cashback-2026-10-30/epics.md) | Final (headless run, choices logged in the file): 9 epics, 85 v1 stories (S 25, M 60, 145 points) plus 9 sketched "After cutover" stories; follows the spine build order (AD-28) with adjustments A1 to A4 |
| Sprint plan | [sprint-status.yaml](../_bmad-output/implementation-artifacts/sprint-status.yaml) (`sprint_plan` key) | 34 one-week sprints for one developer at 5 points (S=1, M=2); Sprint 1 is the walking skeleton with money and time golden tests; all stories `backlog` |

Update this table when an artifact is created, so every skill can find the current one.

## Owner actions open now

- **Rotate the exposed secrets (OQ8, D51).** The deploy webhook secret and the third-party lookup
  key committed on `main` are exposed if the repository is public. Rotate both values in the live
  environment and in Cloudflare, without any code change on `main`, and make the GitHub repository
  private (D16). Scrubbing history is optional and is left to the owner.

## Rules

| Document | Read it to learn |
|---|---|
| [rules/index.md](rules/index.md) | Git, writing standard, and how to work in this repository |
| [../CLAUDE.md](../CLAUDE.md) | The money rules, the hard-won pitfalls, and the project layout |

## The current system (reference input, Vietnamese)

These documents describe the live Python system. They are input for the re-plan, not a design to
keep. The hard-won rules in them are carried into the domain model as D1 to D13.

| Document | Read it to learn |
|---|---|
| [reference/v1-handover.vi.md](reference/v1-handover.vi.md) | The original handover guide: money rules, dead ends, every trap already hit |
| [reference/v2-agent-rules.md](reference/v2-agent-rules.md) | Conventions of the earlier v2 TypeScript attempt (layering, naming, money checklist) |
| [README.md](README.md) | Index of the Vietnamese documents below |
| [01-business/](01-business/) | Business model, rollout plan, accounts and costs |
| [02-architecture/](02-architecture/) | Current layers, ledger and reconciliation, provider refactoring plan |
| [03-operations/](03-operations/) | Runbook and Zalo group setup |
| [04-reference/](04-reference/) | CLI commands, customer messages, database schema, Shopee API findings |
| [diagrams/](diagrams/) | Sequence diagrams of the main flows |
| [tiktok-accesstrade-integration-plan.md](tiktok-accesstrade-integration-plan.md) | TikTok Shop through AccessTrade |

## Domain model (managed by `bmad-domain-driven`)

| File | Status |
|---|---|
| `domain-model.json` | Source of truth for the domain model. Never edited by hand outside the skill |
| `domain-viz/` | Generated views (`make domain-render`). Never edited by hand |
| `../.context/decisions/` | One file per approved decision |
| `../.context/discussions/` | Logs of domain and design discussions |
