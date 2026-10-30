# Step 1: Load Domain Context

## Mandatory Rules

- Resolve `{project-root}` from the current working tree.
- Load `{project-root}/docs/index.md` first when it exists.
- Do not scan the whole repository blindly before reading the docs router.
- Introduce only Mary and Winston.
- Speak in the user's language unless project config says otherwise.

## Sequence

1. Resolve `{project-root}`.
2. Read `AGENTS.md` or `CLAUDE.md` if present.
3. Read `docs/index.md` if present. Treat it as the routing table for project knowledge.
4. From `docs/index.md`, select only domain/architecture/context-map/feature docs relevant to
   DDD. Read those next.
5. Read existing `docs/domain-model.json` when present; otherwise note that the session will
   start from `references/domain-model.template.json`.
6. Read `references/ddd-patterns.md` and keep it as the decision guide.
7. If `_bmad/_config/agent-manifest.csv` exists, load Mary and Winston rows; otherwise use
   built-in defaults from `workflow.md`.
8. Present a short context inventory:

```markdown
**Domain Context Loaded**

| Source | Status | Notes |
|---|---|---|
| `docs/index.md` | found/missing | router summary |
| `docs/domain-model.json` | found/missing | current model status |
| `.context/` | found/missing | discussions/decisions |

**Agents**
- Mary — BA/Analyst
- Winston — Architect

**Choose a starting point**
[D] Discover current domain
[B] Build/rebuild target domain
[C] Compare docs/code/model drift
[V] Visualize current model
```

## Routing

- `[D]`, `[B]`, `[C]`, free-form domain prompt → load `./steps/step-02-domain-party.md`
- `[V]` → load `./steps/step-03-save-render.md` in validate/render mode
- `[E]` → exit
