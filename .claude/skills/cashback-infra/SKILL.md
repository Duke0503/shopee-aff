---
name: cashback-infra
description: >-
  The cashback platform's infrastructure skill for Docker Compose, the reverse proxy and, if the
  architecture adopts it, Redis. Use when designing, writing or reviewing compose files, health
  checks, pinned image tags, volumes, secrets, backups of the ledger database, the tunnel or nginx
  in front of the server, the processes that must stay on the operator's machine (affiliate browser,
  Zalo assistant), or Redis keys, queues and client settings.
---

# Cashback infrastructure

This skill combines the official Docker and Redis skills with the project's rules. Read the
project rules below first; they win over the upstream references where they differ.

- [references/docker-compose/docker-compose-patterns.md](references/docker-compose/docker-compose-patterns.md):
  compose naming, pinned tags, `depends_on` with `service_healthy`, health checks, volumes,
  secrets, development overrides and destructive commands. Its `references/...` links point at
  files in the same folder; its assets, checks and `scripts/verify-compose.sh` (runs only
  `docker compose config --quiet`) are in the subfolders there.
- [references/redis-core/redis-core.md](references/redis-core/redis-core.md) and
  [references/redis-connections/redis-connections.md](references/redis-connections/redis-connections.md):
  only if the architecture spine adopts Redis (for example for the link queue). Do not add Redis on
  your own.

Product sources: `CLAUDE.md`, the current system notes in `docs/reference/`, and, once written,
the architecture spine from `bmad-architecture` (listed in `docs/index.md`).

## Project rules

### What runs where

1. Two processes are tied to the operator's machine and cannot move into a container without a
   decision: the **affiliate browser** (a real Chrome with its own profile and a signed-in
   affiliate session, driven by the browser bridge extension) and the **Zalo assistant** (one
   personal Zalo account, one session). Treat them as host processes in every diagram.
2. One Zalo account has one session. A second process signed in to the same account (a script, a
   dev copy) can push the assistant out. Dev and test use a different Zalo account.
3. Chrome throttles timers in background tabs. All waiting happens on the server side, never inside
   a page script, and the bridge keeps its tab awake and not discarded.

### Data and backups

4. The ledger database is the business. Every schema migration runs only after an automatic backup.
   Backups also go off the machine on a schedule; a copy on the same disk does not survive a disk
   failure. Never delete a volume or a backup without the owner's explicit confirmation.
5. SQLite in WAL mode: every write transaction starts with `BEGIN IMMEDIATE`, `busy_timeout` is
   short (5000 ms) with one retry. If the spine moves to another database, record the move as a
   decision first.

### Compose and proxy

6. Pin every image tag to a specific version; never `latest`. Record the versions in the spine.
7. Every service has a health check. Dependents start with `depends_on: condition: service_healthy`.
8. Tokens (`ASSISTANT_TOKEN`, `BRIDGE_TOKEN`), database credentials and the Zalo credentials are
   secrets: files or a gitignored `.env`, never values in a committed compose file, an image layer,
   a log or the browser.
9. The public entry is the tunnel or nginx. Internal routes are protected by tokens, not by source
   address; `trustProxy` stays off unless the spine decides otherwise. Ports bound for local tools
   use `127.0.0.1`.
10. Prod and dev never share ports, PID files, the Zalo account, the database or the affiliate
    session. Start and stop scripts act only on the PIDs they started, never on process names.

### Redis (only if adopted)

11. Key, channel and stream names are listed in one place in the spine. Lowercase, colon-separated.
12. Use Streams with consumer groups for anything that must not be lost (link requests, payout
    events). Acknowledge after the write succeeds and handle pending entries after a restart.
13. Pool connections, set explicit timeouts, never use `KEYS` in production code.

## License

docker/skills is Apache-2.0 (Copyright 2026 Docker, Inc.); redis/agent-skills is MIT (Copyright (c)
2026 Redis, Inc.). See [LICENSES/](LICENSES/) and [UPSTREAM.md](UPSTREAM.md).
