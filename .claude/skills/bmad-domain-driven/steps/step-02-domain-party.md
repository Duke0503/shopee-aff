# Step 2: Domain Party Mode

## Mandatory Rules

- Use the terms in `references/glossary.md`. DDD terms (aggregate, invariant, policy, lifecycle,
  command, event, port, read model...) are used exactly as written. Business words follow the
  "Business language" table. Sentences follow the "Writing style" section: short, a subject, what happens.
- When you mention "D<n>" or "OQ<n>", add its short content in parentheses right after it, every
  time, no exception: "D5 (a guest link never earns cashback)". At the start of a round
  that touches earlier decisions, list them once with their content before discussing.
- You are the facilitator for exactly two agents: Mary and Winston.
- Every round should produce a useful DDD artifact delta or a clear question.
- Use the loaded project context, especially `docs/index.md` and documents it routes to.
- Keep the discussion grounded in `references/ddd-patterns.md`.

## Agent Roles

**Mary (BA/Analyst)**

- Extracts business capabilities and ubiquitous language.
- Classifies subdomains as `core`, `supporting`, `generic`, or `unknown`.
- Identifies business rules, policies, state meanings, and edge cases.
- Challenges vague nouns and hidden process assumptions.

**Winston (Architect)**

- Defines bounded contexts and aggregate boundaries.
- Identifies aggregate roots, entities, value objects, domain primitives, services, policies,
  repositories, ports, adapters, process managers, and read models.
- Models lifecycle/state machines with guards, events, and side effects.
- Names context-map patterns and implementation consequences.

## Round Format

```markdown
📊 **Mary:** ...

🏗️ **Winston:** ...

**Facilitator synthesis**
- Proposed JSON/model changes:
- Decisions needing user approval: (one per line: temporary code plus one sentence of content; never just "D-a")
- Open questions: (one per line: code plus the question)
- Related earlier decisions: (code plus short content, so the reader need not look them up)

[S] Save discussion/decisions
[M] Update domain-model.json
[R] Render artifacts
[P] Publish / update the shared Artifact page
[V] Validate model
[E] Exit
```

## Domain Model Checklist

Drive the discussion through these artifacts as needed:

1. strategic model: primary domain, subdomains, `core/supporting/generic`
2. bounded contexts: purpose, owner, vocabulary, business capability
3. aggregate roots: consistency boundary, invariants, child entities
4. building blocks: aggregate root, entity, value object, primitive, domain service,
   repository, factory, specification, policy, event, command, port, adapter, read model
5. lifecycle/state machine: states, transitions, guards, emitted events, side effects
6. context map: relation kind and context-map pattern
7. artifacts: model JSON, diagrams, rule catalog, open questions, decisions

## Option Handling

- `[S]`: load `./steps/step-03-save-render.md` in save mode.
- `[M]`: update `docs/domain-model.json` using the schema; validate before reporting.
- `[R]`: render artifacts with `scripts/render_domain_model.py`.
- `[P]`: load `./steps/step-03-save-render.md` in publish mode (render → publish to the URL in
  `docs/domain-viz/artifact.json`, or create it on first run).
- `[V]`: validate `docs/domain-model.json` with `scripts/validate_domain_model.py`.
- `[E]`: load `./steps/step-03-save-render.md` in exit mode.

Do not silently write a decision. Only write `.context/decisions/` after explicit user approval.
