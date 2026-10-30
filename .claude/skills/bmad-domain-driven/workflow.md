---
name: bmad-domain-driven
description: "Party-mode DDD workflow with Mary (Business Analyst) and Winston (Architect), producing a domain-model.json and derived artifacts."
---

# Domain Driven Discussion Workflow

**Goal:** Rebuild or organize a project's domain-driven design through a focused two-agent
discussion, then persist the outcome as JSON and generated artifacts.

**Your Role:** You are the facilitator. You orchestrate Mary (BA/Analyst) and Winston
(Architect), keep the conversation grounded in project docs, and prevent the session from
collapsing into generic DDD theory.

## Workflow Architecture

- Step 01: Load project context, prioritizing `{project-root}/docs/index.md`
- Step 02: Run domain party mode with Mary + Winston
- Step 03: Save discussion, validate/render artifacts, or exit

## Initialization

### Resolve Project Root

`{project-root}` = current working tree:

```bash
git rev-parse --show-toplevel 2>/dev/null || pwd
```

Do not broad-search the machine. If `_bmad/` exists, use its config and agent manifest. If it
does not exist, continue with built-in Mary/Winston defaults; this workflow is allowed to run in
projects that have not been BMAD-materialized.

### Priority Context Loading

Load these in order when they exist:

1. `{project-root}/AGENTS.md` or `CLAUDE.md`
2. `{project-root}/docs/index.md` — this is the preferred router and must be read before scanning
   other docs
3. docs linked from `docs/index.md` that look domain/architecture relevant
4. `{project-root}/docs/domain-model.json`
5. `{project-root}/docs/MAP.md`, `docs/CHEATSHEET.md`, `docs/ARCHITECTURE.md`
6. `.context/README.md`, `.context/decisions/`, `.context/discussions/` when present

If `docs/index.md` is missing, say so and fall back to the existing docs layout. Do not create it
unless the user asks.

### Agent Roster

Use exactly two domain agents:

| Agent | Display Name | Role |
|---|---|---|
| `analyst` | Mary | Business capability, ubiquitous language, subdomain classification, rules, edge cases |
| `architect` | Winston | Bounded contexts, aggregate roots, consistency boundaries, lifecycle/state machine, integration patterns |

If `{project-root}/_bmad/_config/agent-manifest.csv` exists, load Mary and Winston personality
from it. Otherwise use these defaults:

- Mary: curious business analyst, sharp about language, goals, rules, and hidden policy.
- Winston: calm architect, pragmatic about boundaries, consistency, trade-offs, and implementation consequences.

### Domain Sources

Skill-owned references:

- `references/ddd-patterns.md`
- `references/glossary.md` — Cashback business language, DDD terms, writing style, and the rule for mentioning D/OQ codes
- `references/domain-model.schema.json`
- `references/domain-model.template.json`

Outputs:

- `docs/domain-model.json`
- `docs/domain-viz/README.md` — index of the files below, with the context list
- `docs/domain-viz/contexts/<context-id>.md` — one page per bounded context; this is where
  detail lives (nine facets, same order as the HTML dossier)
- `docs/domain-viz/qa.md` — Q&A: open questions grouped by who must answer, and the decision log
  newest first; the same list is the "Q&A" view in the rail of the HTML page. Meetings run off it;
  answers go back into `.context/decisions/` and the model, never into this file
- `docs/domain-viz/{context-map,strategic-map,aggregate-map,event-flow,rule-catalog}.md` — the
  cross-context views genuinely global in scope; see `steps/step-03-save-render.md`
- `docs/domain-viz/domain-explorer.html` — standalone document, opens straight off disk
- `docs/domain-viz/claude-artifact.html` — the same page as an Artifact-ready fragment (no
  `<html>`/`<body>` wrapper, because the Artifact host supplies one)

- `docs/domain-viz/artifact.json` — publish config: the hosted `claude.ai/artifact/...` URL this
  project's page lives at, so `[P]` republishes to the same link instead of creating a new one

This is the project-local copy of the skill (`.claude/skills/`); it overrides the harness copy and
owns the responsive fixes in `_ARTIFACT_STYLE`.
- optionally `docs/MAP.md` and `docs/CHEATSHEET.md`
- `.context/discussions/domain/<date>-<session>.md`
- `.context/decisions/<id>-<slug>.md` for user-approved decisions

## Execution

Load step: `./steps/step-01-load-context.md`

## Conversation Rules

- **The project is written in English**: docs, model, decisions, discussion logs and generated
  pages. Talk to the user in their own language, but everything saved is English.
- **Use DDD terms exactly as written** in `references/glossary.md`: domain, bounded context,
  aggregate, invariant, rule, policy, lifecycle, command, event, building block, port, adapter,
  read model... Do not coin synonyms.
- **Mention a code, mention its content.** Every time Mary, Winston or the facilitator says "D3" or
  "OQ4", add its short content in parentheses right after it: "D3 (cashback is calculated from the
  approved commission only)". This applies to speech, synthesis, discussion logs, decision files
  and text in the model. The reader never has to ask or look it up.
- **Style: one sentence, one idea, a subject.** Standard sentence: "An order becomes payable only
  after the network approves its commission." Applies to everything generated: description, invariant,
  rule, transition, event, use case, relation. Details are in the "Writing style" section of
  `references/glossary.md`. Business words (link request, sub_id, approved commission, payout, HOUSE...)
  keep the meaning in the "Business language" table; when a new word appears, add it to the table
  instead of inventing another name.
- **Events and commands play their own roles.** A command is imperative (`confirm`, `invalidate`).
  An event is past tense `<context>.<aggregate>.<what-happened>` (`orders.order.approved`), with one
  sentence saying when it happens and who listens.
- Always distinguish `observed`, `target`, `proposed`, and `unknown`.
- Mary and Winston may disagree. Surface the disagreement instead of averaging it away.
- A user-approved decision can be saved. An agent suggestion is not a decision until the user
  accepts it.
- Keep data artifacts JSON-only. Markdown/HTML are derived views.
- Keep the Claude artifact self-contained: embed the JSON model and inline CSS/JS; no backend
  endpoints or project runtime state. Workflow-shaped facets (lifecycle, context map, integration)
  are drawn with Mermaid loaded from `cdn.jsdelivr.net` (allowed by the Artifact CSP) into
  `<pre class="mmd">` blocks — a class the host's own mermaid pass ignores, so the page renders
  the same on disk and as an Artifact.
- The page is organized for a meeting, not for browsing a type catalogue. Never regress it to one
  tab per entity type: that forces a reader to visit six tabs to understand one domain.
- Never hide facets behind an audience/role switch. Everyone sees everything; density is handled
  by the sticky chip nav and by muting detail, not by removing it.
- Do not implement code, migrations, or server changes unless the user explicitly pivots to
  implementation.

## Options After Each Round

Show:

```text
[S] Save discussion/decisions
[M] Update domain-model.json
[R] Render artifacts
[P] Publish / update the shared Artifact page
[V] Validate model
[E] Exit
```
