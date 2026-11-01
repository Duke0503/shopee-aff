# Dev environment

The dev environment of the new platform shares nothing with production (Story 8.1, AD-25, D37,
NFR-5). Production today is the live system from `main` on the Windows VPS in `C:\Project\mmo`;
after cutover it is the new server with the resources in the right-hand column of
`_bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/diagrams/c4-deployment.md`.

## What dev uses

| Resource | Dev | Never (production) |
| --- | --- | --- |
| Listeners | 127.0.0.1:9080 public, 127.0.0.1:9081 internal | 80, 8899, 8787 (live bridge), 8891 (live Zalo bot), 8080, 8081 |
| Data (ledger, lock, backups, proof files) | `data/dev/` | `data/prod/`, anything in `C:\Project\mmo` (live `cashback.db`) |
| PID file | `run/dev/server.pid` | `run/prod/` |
| Secrets file | `~/.config/cashback/dev.env` | `~/.config/cashback/prod.env`, the live `.env` |
| Browser bridge | the in-process fake bridge (`BRIDGE_MODE=fake`), or a Chrome profile of its own never signed in to the production Shopee account | `.browser-profile/` (live), `.browser-profile/prod/` |
| Zalo | the fake client (`ZALO_MODE=fake`), or the dev account posting only to the Dev group "Dev Internal DP" | the live main group, the production Zalo account |
| Telegram | off, unless a separate dev chat is configured | -1004416753701 (production alerts; the live config also calls it the "dev" chat) and -5232520551 (business) |
| Tunnel and host names | none; `PUBLIC_BASE_URL` empty | https://hoantiendp.com and every host under `hoantiendp.com` |
| sub_id1 | `DEV` + customer id | plain customer id |
| Request id (sub_id2) | `DEV` + `YYMMDD` + five digits | `YYMMDD` + five digits |
| Bank fingerprint key | a key of its own | the production `FINGERPRINT_KEY` (a cutover rehearsal passes it to its own command, never through `dev.env`) |
| AccessTrade report key | a key of its own, or the production key only with `ALLOW_PROD_ACCESSTRADE_KEY=1` (logged as a warning at every start) | |
| `LIVE_LEDGER_PATH` | the live copy a rehearsal reads | never the server's own ledger or anything in its data folder |

Attribution keeps the two apart in both directions: production makes an order from a `DEV`
sub_id1 or a `DEV` request id a review case (`dev_link_in_production`), and dev makes an order
from a link without the prefix a review case (`production_link_in_dev`), crediting a dev link to
the customer id after the prefix.

The production Zalo bot account id is not known yet: `production-identifiers.json` keeps a
documented placeholder for it. The Zalo group ids already keep dev from posting anywhere but the
Dev group.

The production identifiers (ports, folders, Zalo groups, host names, the Telegram chat once known)
are listed in `apps/server/src/platform/config/production-identifiers.json`. No secret is in that
file. Every start reads the env file through `platform/config`, and a dev file that points at any
listed resource is refused with the key names and reasons, never the values. When a
`prod.env` is on the same machine, its ports, folders, Zalo groups, chat and admin host join the
list, and a dev secret equal to its production value (`INTERNAL_TOKEN`, `ASSISTANT_TOKEN`,
`TELEGRAM_BOT_TOKEN`, `ACCESS_AUDIENCE`, `FINGERPRINT_KEY`, and `ACCESSTRADE_API_KEY` unless
allowed) is refused. A `dev.env` that is the `prod.env` file
(same path, link or hard link) is refused. Production is refused when `BRIDGE_MODE` or `ZALO_MODE`
is `fake`.

## Start and stop

```bash
cd apps/server
pnpm dev:start   # background server; reports started once /api/health answers, then writes run/dev/server.pid
pnpm dev:stop    # ordered stop through POST /internal/shutdown, then waits; a kill only if it is still running
pnpm dev         # the same server in the foreground with file watching
```

`dev:start` reports `platform.dev.failed` with the reason (and records no PID) when the server
exits or stays unhealthy; its output is in `data/dev/logs/server.log`. `dev:stop` acts only on the
recorded PID, and only while that PID is the process started then. It reports
`platform.dev.stopped` for an ordered stop and `platform.dev.forced` when it had to kill. The
shutdown route exists only in dev, behind the internal token, on 127.0.0.1.

The first log line of every start, `platform.environment.mode`, names the environment, the bridge
and Zalo modes, the sub_id1 prefix and whether a tunnel is configured.

## `~/.config/cashback/dev.env`

Placeholders only; create the file by hand outside the repository and never commit it.

```ini
INTERNAL_TOKEN=<at least 32 random characters, not the production value>
ASSISTANT_TOKEN=<at least 32 random characters, different from INTERNAL_TOKEN>
# Optional; these are the defaults:
# PUBLIC_PORT=9080
# INTERNAL_PORT=9081
# BRIDGE_MODE=fake
# ZALO_MODE=fake
# With ZALO_MODE=account the only allowed group is the Dev group:
# ZALO_GROUP_IDS=<the Dev Internal DP group id>
# With BRIDGE_MODE=browser a profile of dev's own is required:
# BROWSER_PROFILE_DIR=<absolute path, for example the repository's .browser-profile/dev>
# Telegram stays off unless both are set to a chat of dev's own:
# TELEGRAM_BOT_TOKEN=<a dev bot token>
# TELEGRAM_CHAT_ID=<a dev chat id, never a production chat>
# FINGERPRINT_KEY=<a dev key, never the production key>
# ACCESSTRADE_API_KEY=<a dev key; the production key also needs ALLOW_PROD_ACCESSTRADE_KEY=1>
# LIVE_LEDGER_PATH=<absolute path of the live copy a rehearsal reads, outside data/dev>
# PUBLIC_BASE_URL stays unset in dev.
```
