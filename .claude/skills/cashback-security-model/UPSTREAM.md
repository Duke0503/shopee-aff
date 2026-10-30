# Upstream sources

| File | Source | Commit | License |
|---|---|---|---|
| references/security-model.md | getsentry/skills `skills/security-model/SKILL.md` | d12f250 | Apache-2.0 |
| references/consuming-policy.md | getsentry/skills `skills/security-model/references/consuming-policy.md` | d12f250 | Apache-2.0 |
| references/security-model-sources.md | getsentry/skills `skills/security-model/SOURCES.md` | d12f250 | Apache-2.0 |
| scripts/resolve_security_model.py | getsentry/skills `skills/security-model/scripts/resolve_security_model.py` | d12f250 | Apache-2.0 |
| LICENSE | getsentry/skills `LICENSE` | d12f250 | Apache-2.0 |
| SKILL.md, STRIDE step | Pattern only: wshobson/agents `plugins/security-scanning/skills/stride-analysis-patterns/` | 0874a27 | MIT (no text copied) |

Full commits: getsentry/skills `d12f250460ffd961f549dbebf7eeb0cf4afd4c2e`, wshobson/agents
`0874a27b17a22e2b7c2e2bcd725768e0803cad06`. Copied unchanged on 2026-10-27, except that `SKILL.md`
was renamed `references/security-model.md` and `SOURCES.md` renamed
`references/security-model-sources.md`. Upstream attribution comments (the openai/codex-security
origin, Apache-2.0) are kept in the copied files. The licenses were re-checked at those commits
(getsentry: Apache-2.0, Copyright 2025 Functional Software, Inc. dba Sentry, and `license:
Apache-2.0` in the frontmatter; wshobson: MIT, Copyright (c) 2024 Seth Hobson). Modification notice
(Apache-2.0 section 4b): the cashback project's rules, seeded invariants and STRIDE step were added in
`SKILL.md`; the script now sits in `scripts/` next to `references/`. The script was read in full
before copying: it only runs read-only `git` commands (`rev-parse`, `ls-files`, `ls-tree`,
`cat-file`, `grep`) and reads files inside the repository. Left out: `SPEC.md` (upstream authoring
spec), `agents/openai.yaml` (Codex wiring) and `scripts/selftest_resolve_security_model.py`
(test harness, not needed to use the skill).
