# Step 3: Save, Render, Validate, or Exit

## Save Discussion

When the user chooses `[S]`:

1. Ensure `.context/discussions/domain/` and `.context/decisions/` exist. Do not overwrite
   existing files.
2. Save a concise session log to `.context/discussions/domain/<date>-<session>.md`:
   participants, loaded sources, topic, Mary/Winston positions, synthesis, open questions,
   proposed model changes, and user-approved decisions.
3. When a new decision replaces an older one, keep the old entry verbatim: set its `status` to `superseded`, point `supersededBy` at the new decision id (model) and add `supersededBy:` to the old file header. Never rewrite old decision text.
4. For each approved decision, write `.context/decisions/<id>-<slug>.md` with status, date,
   context, decision, rationale, consequences, and links to model artifacts.
5. Return to Step 2 unless the user chose exit.

## Update Model

When the user chooses `[M]`:

1. If `docs/domain-model.json` is missing, create it from `references/domain-model.template.json`.
2. Apply only the model changes supported by the current discussion.
3. Preserve IDs for existing contexts, aggregates, building blocks, events, and relations.
4. Mark uncertain facts as `unknown` or add them to `openQuestions`.
5. Validate with:

```bash
python3 {skill-root}/scripts/validate_domain_model.py {project-root}/docs/domain-model.json
```

## Render Artifacts

When the user chooses `[R]`:

```bash
python3 {skill-root}/scripts/render_domain_model.py \
  {project-root}/docs/domain-model.json \
  --out-dir {project-root}/docs/domain-viz \
  --write-map {project-root}/docs/MAP.md \
  --write-cheatsheet {project-root}/docs/CHEATSHEET.md \
  --html \
  --claude-artifact
```

Generated artifacts, under `docs/domain-viz/`:

- `README.md` — index: what each file answers, plus the context list linking to each page
- `contexts/<context-id>.md` — **one page per bounded context, this is where detail lives.**
  Nine sections, same order and same headings as the HTML dossier's `FACETS`:
  purpose & classification, ubiquitous language, aggregates (with fields), identity & building
  blocks (`KIND_ORDER` order), lifecycle, commands & use cases, events, rules & policies,
  integration & hotspots. A facet with nothing says so in a plain sentence; it is never a bare
  heading with nothing under it.
- `context-map.md` — the relation graph between contexts (global: a cross-context question)
- `strategic-map.md` — primary domain and core/supporting/generic subdomain classification (global)
- `event-flow.md` — cross-context event flow (global)
- `aggregate-map.md` — the global mermaid overview of every aggregate and the relations between
  them, **names only** — per-aggregate detail (fields, invariants, identity, lifecycle) lives on
  the context page
- `rule-catalog.md` — a cross-cutting **index**, one row per rule, linking to its context page.
  "Every authorization rule in the domain" is a real question no single context page answers;
  this file answers it without duplicating the rule's full neighbourhood (that stays on the
  context page)
- two HTML views of the same page: `domain-explorer.html` (standalone document) and
  `claude-artifact.html` (Artifact-ready fragment)

Earlier versions also wrote `building-blocks.md`, `lifecycle-map.md` and `state-machines.md`,
each slicing **by type across all contexts** — one table of every building block, every
lifecycle, every rule. That forced a reader to open six files to understand one domain, which is
exactly what the rule below forbids. Their content now lives on the context pages; the renderer
deletes these three files from `--out-dir` if it finds them left over from an older run.

The HTML page is a **review surface for a meeting**, built on two documented practices: the
ddd-crew Bounded Context Canvas (one canvas per context, business language first) and the
ddd-crew EventStorming grammar (actor -> command -> constraint -> event <- policy). The markdown
context page is a restatement of the same nine facets in table/mermaid form — `FACETS` and
`KIND_ORDER` in the renderer are the single source for both; do not restate them when touching
either surface.

**One domain at a time.** A rail lists every context grouped by `domainType`. Building blocks
without a `context` are collected under a "Shared kernel" entry so nothing is orphaned. (In the
current model every building block has a `context`, so this entry is dormant but kept for when
one doesn't.)

**No audience switch.** Every reader sees every facet. An earlier version hid facets behind a
Stakeholder/BA/Dev lens; that was removed because hiding by role means the person who needs a fact
cannot discover it exists. A long page stays usable through the sticky chip nav at the top, and
detail only some readers need — ids, scopes, field lists — drops to small mono grey instead of
disappearing. Do not reintroduce a role switch.

**EventStorming's sticky colours are the colour system**, not decoration: orange event, blue
command, yellow aggregate, lilac policy/rule, green language, pink hotspot. Anyone who has stood
at that wall reads the page without a legend. `BLOCK_TONES` in the renderer maps all 17 schema
block kinds onto those six colours.

Each domain is described by nine facets, which are **domain concepts, not code-artifact kinds** —
a stakeholder discusses Aggregates, Rules and Lifecycle, never Repository or Factory:

1. Purpose & classification — `businessCapability`, `domainType`, `strategicImportance`, subdomain
2. Ubiquitous language — value objects, domain primitives, field types
3. Aggregates — roots, `consistencyBoundary`, `invariants`, and each one's `fields`
4. Building blocks — every `buildingBlocks[]` entry of this domain, with `kind`, `scope`,
   `purpose`, `responsibilities`, `aggregate` and `id`, split into what the domain owns and what
   it borrows from the shared kernel, plus a strip naming the kinds it has none of
5. Lifecycle — states, then transitions as labelled arrows carrying guards and emitted events
6. Commands & use cases — `useCases` and transition actions
7. Events — the command -> aggregate -> event sentence read off `transition.emits`, and a warning
   row listing actions that publish nothing
8. Rules & policies — `invariants`, `rules[]` by kind, policy and specification blocks
9. Integration & hotspots — relations split into calls out to / publishes to / used by, plus
   `openQuestions` and `decisions`

Every facet reads real schema fields. Do not add a facet with no data source behind it.

The landscape view gives each domain a nine-dot strip, one dot per facet; a hollow dot is a facet
holding nothing yet, so a card reads as that domain's agenda at a glance. This is the EventStorming
hotspot discipline: flag the gap, do not resolve it on the spot.

Do not reorganize the page into one tab per entity type: that makes a reader open six tabs to
understand a single domain.

**Design reference** — the page is grounded in **Stripe** via OpenDesign MCP
(`get_design_system('stripe')`, opendesign.cc/packs/stripe): neutrals `#F8FAFD / #FFFFFF / #E5EDF5`,
ink `#061B31`, ink-soft `#50617A`, muted `#64748D`, single accent `#533AFD` used only for links and
focus rings, 1px borders, radius 4/8/12, resting shadow `0 3px 6px rgba(23,23,23,.06)`, body 16/1.5,
display 500 weight with -1px tracking, 220ms `cubic-bezier(.25,1,.5,1)` transitions, one grotesque
sans (Instrument Sans) + one mono (JetBrains Mono). EventStorming sticky colours and the
core/supporting/generic colours are **not** part of the reference — they carry meaning and stay.
Stripe's don'ts apply: no dark mode, no playful rounded type, no thick borders, no cluttered layout.
When restyling, re-fetch the tokens from OpenDesign instead of editing hex values from memory.

**Language of the model and the page (mandatory; the whole project is written in English):**

- Write for a colleague who has just joined. Standard sentence: "An order becomes payable only after
  the network approves its commission." Short sentences, one idea each, a real person or thing as the
  subject ("The reconciliation approves the order", "The assistant delivers the link"), no
  "is performed by". No long dashes, no semicolons joining clauses, no parenthesis holding a whole
  sentence. A transition side effect states the business consequence ("the customer
  balance grows"), not a technical command. The "Writing style" section in `references/glossary.md` is the
  full version.
- Business words follow the "Business language" table in `references/glossary.md`; the renderer reads
  that table. When the model needs a new word, add it to the table in the same commit.
- **DDD terms are used exactly as written** in `references/glossary.md`, in the model and on the
  page: aggregate, aggregate root, entity, value object, domain primitive, invariant, rule, policy,
  specification, lifecycle, state, transition, guard, command, event, use case, building block,
  domain service, repository, port, adapter, anti-corruption layer, process manager, read model,
  shared kernel, bounded context, subdomain core/supporting/generic. Do not coin synonyms.
- Business names and explanations are plain English business words: "link request", "approved commission",
  "payout". Technical names stay in `resource`/`id`.
- An aggregate description answers three questions in order: what it is, what it holds, what must
  never be false. `consistencyBoundary` starts with "Must be correct together: ...".
- **Events and commands keep their identifiers.** An event id is past tense
  `<context>.<aggregate>.<what-happened>` (`orders.order.approved`); a command is an imperative verb
  (`approve_order`). Every event in `events[]` has a one-sentence `description`: when it happens and
  who listens. The page draws the EventStorming sentence with the role labels
  `command · aggregate · event` so the reader does not have to guess.
- **A code always carries its content.** In model text, logs and decisions: "D3 (cashback is calculated
  from the approved commission only)". The renderer annotates every `D<n>`/`OQ<n>` on the page
  from `decisions[]`/`openQuestions[]`, but the source text must still read on its own in JSON or a log.
- Displayed statuses use the English keyword with a short gloss: `observed · exists in code`,
  `target · agreed goal`, `proposed · suggested`, `unknown · not yet known`. A domain name never
  carries a "(target)" suffix.
- The page chrome (`VI_STATUS` and `GLOSSARY` in the renderer) is the single source for labels;
  a new kind goes there and into `references/glossary.md`, never as a label scattered in a template.

**Q&A view (keep):** the rail has a "Q&A" entry and `qa.md` is generated at the same time. Every open
question is grouped by who must answer (open first, deferred and resolved folded), then the decision
log newest first, with the date taken from the file name in `sources`
(`.context/decisions/YYYY-MM-DD-...`) and `proposed` shown in red. The meeting works off this list.
Answers go into `.context/decisions/` and the model's `decisions[]`/`openQuestions[]` (with
`contexts`); never edit `qa.md` by hand.

**Page structure (do not regress to a type catalogue):**

- *Landscape* = a **strategic map**: three bands (Core / Supporting / Generic) of domain tiles,
  each tile with a 9-facet coverage ring; relations drawn as an SVG overlay computed from tile
  positions (deterministic, not auto-layout), dimmed at rest and lit on hover. Shared-kernel edges
  are implied, not drawn. Hotspots (open questions) follow the map.
- *Dossier* = header (name, type, status, addon, patterns, 9-segment coverage strip) → sticky
  section nav → **Bounded Context Canvas** (Inbound | Purpose · classification · ubiquitous
  language · business decisions | Outbound) → Aggregates (identity key first, boundary quote,
  invariants, fields folded) → Lifecycle (Mermaid state diagram + folded transition table) →
  Event flow (EventStorming sentences) → Identity & blocks (DDD order) → Rules by kind →
  Integration table, hotspots, decisions.
- EventStorming colours appear only where the grammar applies (canvas in/out, event strip,
  block rows); everything else is Stripe neutrals with one accent.

**Responsive contract** (verified with chrome-devtools at 390px and 1280px; keep it when editing
`_ARTIFACT_STYLE`):

- Nothing may push the content below the first screen on a phone. The domain rail becomes a
  one-row horizontal strip (`≤900px`), never a column of fifteen items above the dossier.
- The facet chip nav is one scrolling row and stays sticky; it is the only sticky bar on mobile.
- Lifecycle (`≤640px`) is a vertical chain: the arrow becomes a left rule carrying action + guard
  with an arrowhead, so "from → action → to" never wraps with the arrow pointing at nothing.
- EventStorming rows stack full-width with a dashed separator between sentences.
- No horizontal page scroll at any width; only `.tablewrap` may scroll sideways.

## Publish the shared Artifact page

When the user chooses `[P]`, or right after `[R]` when `docs/domain-viz/artifact.json` exists
(the user expects the shared link to stay current):

1. Validate first; never publish an invalid model.
2. Render with `--claude-artifact` (command above) using **this project's copy** of the skill.
3. Read `docs/domain-viz/artifact.json`:

```json
{
  "url": "https://claude.ai/artifact/…",
  "title": "Cashback Domain Map",
  "favicon": "💎",
  "page": "docs/domain-viz/claude-artifact.html",
  "model": "docs/domain-model.json",
  "lastPublished": { "at": "YYYY-MM-DD", "modelVersion": "0.1.0", "label": "…" }
}
```

4. Publish with the Artifact tool, passing `url` from the config and `file_path` = `page`, plus a
   short `label` (model version + what changed). Omit `favicon`/`icon` so the artifact keeps its
   identity. If the tool refuses because this session has not read the artifact yet, call
   `action: "read"` on that `url` once, then publish again with `url`. **Never publish without
   `url` when a config exists** — that creates a second link and splits the discussion.
5. No config → first publish with `favicon`, one-sentence `description`, `label`; then write
   `artifact.json` with the returned URL.
6. Update `lastPublished`, report the URL. The link is private until shared from the page menu.
7. Comments on the page arrive as `[Artifact comment sent to Claude]` turns — discussion input
   for Step 2, not approved decisions.

Commit `artifact.json` together with `domain-model.json`; it is what lets the next session (or a
teammate) update the same page.

## Validate

When the user chooses `[V]`, run the validator and report both errors and warnings. Warnings
about missing `domainType`, `aggregateRoot`, `consistencyBoundary`, or transition guards are
important DDD review prompts, not noise.

## Exit

If there is unsaved discussion content, ask whether to save before exiting. Otherwise summarize:

- loaded sources;
- model status;
- decisions saved;
- artifacts rendered;
- open questions or blocked DDD decisions.
