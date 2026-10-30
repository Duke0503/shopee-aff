# Upstream sources

| File | Source | Commit | License |
|---|---|---|---|
| references/shadcn.md | shadcn-ui/ui `skills/shadcn/SKILL.md` | ca2d61c | MIT |
| references/*.md | shadcn-ui/ui `skills/shadcn/` (cli, customization, design-system, design-system-page, mcp, registry) | ca2d61c | MIT |
| references/rules/*.md | shadcn-ui/ui `skills/shadcn/rules/` (without `chat.md`) | ca2d61c | MIT |
| references/assets/showcase/* | shadcn-ui/ui `skills/shadcn/assets/showcase/` | ca2d61c | MIT |
| references/scripts/showcase-coverage.mjs | shadcn-ui/ui `skills/shadcn/scripts/` | ca2d61c | MIT |

Copied unchanged on 2026-10-27, except that `SKILL.md` was renamed `references/shadcn.md`. Left out:
`rules/chat.md` (no chat UI), `evals/`, `agents/`, and the logo images. Paths inside the upstream
files that point at `./assets/` or `scripts/` are relative to `references/`. `LICENSE.md` is the
upstream file. the cashback project's own rules are in `SKILL.md`.
