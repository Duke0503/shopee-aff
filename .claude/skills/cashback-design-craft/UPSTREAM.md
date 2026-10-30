# Upstream sources

| File | Source | Commit | License |
|---|---|---|---|
| references/frontend-design.md | anthropics/skills `skills/frontend-design/SKILL.md` | ca45fc4 | Apache-2.0 |
| references/impeccable/*.md | pbakaus/impeccable `.claude/skills/impeccable/reference/` (18 playbooks) | 02523ae | Apache-2.0 |
| LICENSES/anthropics-skills-frontend-design.txt | anthropics/skills `skills/frontend-design/LICENSE.txt` | ca45fc4 | Apache-2.0 |
| LICENSES/impeccable-LICENSE.txt, impeccable-NOTICE.md | pbakaus/impeccable `LICENSE`, `NOTICE.md` | 02523ae | Apache-2.0 |
| ../ui-ux-pro-max/ (separate skill) | nextlevelbuilder/ui-ux-pro-max-skill `.claude/skills/ui-ux-pro-max/` | 28b3b8d | MIT |

Copied unchanged on 2026-10-30, except that the frontend-design `SKILL.md` was renamed
`references/frontend-design.md`. Left out of impeccable: `SKILL.md`, the `scripts/` folder (a
launcher that downloads a self-contained binary, not reviewed) and the playbooks for native apps,
animation, live mode and hooks. Left out of ui-ux-pro-max: `scripts/tests/`. Its four Python
scripts were read before copying: standard library only, they read the CSV files in `data/` and
print results; no network, no subprocess. Modification notice (Apache-2.0 section 4b): the
project's rules were added in `SKILL.md`; the copied files are not changed.
