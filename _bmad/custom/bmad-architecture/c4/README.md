# C4 diagram guide for bmad-architecture

The cashback platform's diagram reference for the architecture spine. `bmad-architecture` loads it on demand
through the team override in `_bmad/custom/bmad-architecture.toml`; the BMAD skill itself is not
edited.

| File | What it holds |
|---|---|
| [c4-architecture.md](c4-architecture.md) | The upstream skill: C4 levels, quick-start Mermaid examples, element syntax, best practices |
| [c4-syntax.md](c4-syntax.md) | Full Mermaid C4 syntax, including the list of PlantUML features Mermaid does not support |
| [common-mistakes.md](common-mistakes.md) | Anti-patterns |
| [advanced-patterns.md](advanced-patterns.md) | Event-driven, deployment and other patterns |

## Project rules (these win over the upstream files)

1. Draw Context and Container always; Deployment (what runs on the operator's machine, what runs
   behind the tunnel or proxy) and Dynamic diagrams for the main flows: link request to delivered
   link, reconciliation to approved order, payout to notified customer, customer sign-in.
   Component diagrams only where they add value.
2. Context elements: the customer (in Zalo and on the website), the operator (admin desk), the
   affiliate networks (Shopee Affiliate, TikTok Shop through AccessTrade, Lazada), Zalo, and the
   bank used for manual transfers. Container elements follow the spine; the affiliate browser and
   the Zalo assistant are always shown as host processes on the operator's machine.
3. Show every queue or job (link queue, reconciliation run, notification run) as its own element.
4. Save diagrams inside the architecture run folder (with the spine), not in a new
   `docs/architecture/` folder. The upstream "Output Location" section does not apply.
5. Diagrams and labels are in English.

## Mermaid C4 syntax: currency note (checked 2026-10-27)

The upstream repository was last pushed in March 2026, so its syntax was checked against the
current Mermaid documentation (https://mermaid.js.org/syntax/c4.html) on 2026-10-27:

- Mermaid still marks C4 diagrams as **experimental**: "The syntax and properties can change in
  future releases." Check a diagram renders in the Mermaid version the team uses before relying on
  a feature.
- The five diagram types (`C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment`),
  the element, boundary and relationship keywords (including `Rel_Back` and `RelIndex`, whose index
  is ignored), and `UpdateElementStyle`, `UpdateRelStyle` and `UpdateLayoutConfig` used in these
  files match the current documentation.
- Not supported by Mermaid, as `c4-syntax.md` already says: sprites, tags, links, `Legend`,
  `AddElementTag`/`AddRelTag`, custom shapes and line styles, and the `Lay_*` layout statements.
  `common-mistakes.md` advises always including a legend: in Mermaid write it as text next to the
  diagram, since there is no `Legend` statement.
- Layout is automatic and weak; control it through statement order and `UpdateLayoutConfig`, and
  split a diagram that gets crowded.

## Source and license

Copied unchanged on 2026-10-27 from softaworks/agent-toolkit `skills/c4-architecture/` at commit
`3027f20f3181758385a1bb8c022d4041dfb4de84` (`SKILL.md` renamed `c4-architecture.md`; the
upstream `README.md` was left out). MIT, Copyright (c) 2026 Leonardo Flores; see [LICENSE](LICENSE),
re-checked at that commit.
