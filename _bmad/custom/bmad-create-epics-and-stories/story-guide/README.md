# Cashback story guide

How `bmad-create-epics-and-stories` writes the cashback platform's epics and stories. Read this before
designing epics (step 2) and before writing stories (step 3).

Adapted from two MIT-licensed sources (licences in this folder):

- `phuryn/pm-skills`, skill `pm-execution/skills/user-stories` at commit `07b34f6`: the 3 C's,
  INVEST and 4 to 6 testable acceptance criteria per story.
- `mattpocock/skills`, skill `skills/engineering/to-tickets` at commit `59db609`: tracer-bullet
  vertical slices, explicit "blocked by" edges and expand–contract for wide changes.

The project rules below are our own.

## Sources of truth, in this order

1. `docs/domain-model.json` and `.context/decisions/`. A story never contradicts a decision; if
   it seems to need to, stop and raise it.
2. The PRD listed in `docs/index.md`: every story cites the FR, NFR or UJ it realises.
3. The architecture spine listed in `docs/index.md`: every story cites the AD rules it must
   follow. A story that would break an AD is wrong, not the AD.
4. The UX spines (`DESIGN.md`, `EXPERIENCE.md`): a UI story names the screens it builds and
   covers phone, tablet and desktop.

## Story shape (3 C's)

- **Card:** a short title and one line: "As a [Customer | Guest | Operator | the Zalo assistant |
  the reconciliation run], I want [action], so that [benefit]." Use the PRD's roles and words.
- **Conversation:** two to five sentences of intent and context: why, what is out of scope, which
  decisions and ADs constrain it.
- **Confirmation:** 4 to 6 acceptance criteria, each one observable and testable. Write them as
  Given / When / Then when there is a trigger and a result. Include at least one edge case and,
  for UI stories, the phone behaviour.

## INVEST check, applied to every story

- **Independent:** depends only on the stories it lists under "Blocked by".
- **Negotiable:** states the outcome, not the code. No file paths or code snippets, except a
  shape that encodes a decision (an API contract, a table's key, a state machine).
- **Valuable:** delivers something a person or the next story can see or verify.
- **Estimable:** a developer can size it from the text and the cited ADs.
- **Small:** fits one developer for a few days and one fresh agent context. Split larger ones.
- **Testable:** every criterion can be checked by a test or a recorded manual step.

## Vertical slices and blocking edges

- Prefer a **tracer bullet**: a narrow path through every layer it needs (contract, storage,
  service, API, UI, test) that is demoable or verifiable on its own. Avoid "all the tables" or
  "all the endpoints" stories.
- Every story lists **Blocked by**: the stories that must finish first, or "None". Epics are
  ordered so that each story's blockers sit earlier.
- The **walking skeleton** comes first: the smallest end-to-end path (one product URL to a delivered link
  for one customer) proves the apps, the contracts and the deploy.
- **Wide changes** that touch many places at once (a renamed contract field, a new column on a
  hot table) use **expand–contract**: add the new form beside the old, migrate users in batches,
  then remove the old form, each step its own story.

## Project-specific rules

- **Ubiquitous language.** Every identifier, API name, table, log event, test name and commit uses
  the domain terms of `docs/rules/writing.md` and the domain glossary; no generic words (data,
  item, handle, process, OK, Something went wrong). Vietnamese customer text lives only in the
  message and label files.
- **Money.** Every story that touches money cites the money rules in `CLAUDE.md`, adds a golden
  test, and keeps all maths in the shared money package. Amounts are whole dong; rounding is
  half-up through the shared helper.
- **Attribution.** Every story that makes or reuses a link states whose sub_id1 it carries and why
  the link cannot reach another customer.
- **Idempotence.** Every story that reads a network report says how a repeated or overlapping run
  leaves orders unchanged, and that a paid order is never touched.
- **Zalo safety.** Every story that sends Zalo messages states its rate and delay; no bulk sends,
  no bulk friend requests.
- Every story that adds a user action says which role may do it and whether it needs a session.
- Security criteria from the spine appear as acceptance criteria where they apply, not as a
  separate "security epic" at the end.
- Name the skill a builder should use: `cashback-shadcn`, `cashback-ui-review`, `cashback-infra`,
  `cashback-security-model`.
- Write in English, plain words.

## Story template

```markdown
### Story N.M: <title>

As a <role>, I want <action>, so that <benefit>.

**Context:** <2 to 5 sentences>. Realises FR-x, UJ-y. Follows AD-a, AD-b. Decisions: Dn.
**Screens:** <wireframe names, or "none">. **Skills:** <skill names>.
**Blocked by:** Story N.K, or None.

**Acceptance criteria**
1. Given …, when …, then ….
2. …
```
