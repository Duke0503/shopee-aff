# Upstream sources

| File | Source | Commit | License |
|---|---|---|---|
| references/redis-core/redis-core.md | redis/agent-skills `skills/redis-core/SKILL.md` | a84871d | MIT |
| references/redis-core/*.md | redis/agent-skills `skills/redis-core/references/` | a84871d | MIT |
| references/redis-connections/redis-connections.md | redis/agent-skills `skills/redis-connections/SKILL.md` | a84871d | MIT |
| references/redis-connections/*.md | redis/agent-skills `skills/redis-connections/references/` | a84871d | MIT |
| references/docker-compose/docker-compose-patterns.md | docker/skills `skills/docker-compose-patterns/SKILL.md` | 179c9cf | Apache-2.0 |
| references/docker-compose/*.md | docker/skills `skills/docker-compose-patterns/references/` | 179c9cf | Apache-2.0 |
| references/docker-compose/assets/* | docker/skills `skills/docker-compose-patterns/assets/` | 179c9cf | Apache-2.0 |
| references/docker-compose/checks/verification.md | docker/skills `skills/docker-compose-patterns/checks/` | 179c9cf | Apache-2.0 |
| references/docker-compose/scripts/verify-compose.sh | docker/skills `skills/docker-compose-patterns/scripts/` | 179c9cf | Apache-2.0 |
| LICENSES/redis-agent-skills.txt | redis/agent-skills `LICENSE` | a84871d | MIT |
| LICENSES/docker-skills.txt | docker/skills `LICENSE` | 179c9cf | Apache-2.0 |

Full commits: redis/agent-skills `a84871d065f398fed55e1633f66b66f731eb4e2b`, docker/skills
`179c9cfd04c89ae50cd5d5d68b939797a8fd03d3`. Copied unchanged on 2026-10-27, except that each
upstream `SKILL.md` was renamed so it loads as a reference of this skill, and the docker
`references/` files sit next to the renamed `SKILL.md` instead of in a `references/` subfolder.
Licenses re-checked at those commits (redis: MIT, Copyright (c) 2026 Redis, Inc., and `license:
MIT` in each frontmatter; docker: Apache-2.0, Copyright 2026 Docker, Inc., `license: Apache-2.0` in
the frontmatter; neither repository has a NOTICE file). Modification notice (Apache-2.0 section
4b): the cashback project's rules and its own Pub/Sub versus Streams guidance were added in `SKILL.md`; the
copied files are not changed. `verify-compose.sh` was read in full: it only runs
`docker compose config --quiet`. Left out: docker `skill.yaml` and `agents/openai.yaml` (wiring
for other agents), and the other Redis and Docker skills.
