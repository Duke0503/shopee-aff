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
| Browser bridge | the in-process fake bridge (`BRIDGE_MODE=fake`), or the `apps/bridge` extension in an Edge or Chrome profile of its own (`BROWSER_PROFILE_DIR`) never signed in to the production Shopee account, with its own `BRIDGE_TOKEN` | `.browser-profile/` (live), `.browser-profile/prod/`, the live extension in `extension/`, port 8787 |
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
`TELEGRAM_BOT_TOKEN`, `ACCESS_AUDIENCE`, `FINGERPRINT_KEY`, `BRIDGE_TOKEN`, and `ACCESSTRADE_API_KEY`
unless allowed) is refused. In every environment `BRIDGE_MODE=browser` needs a `BRIDGE_TOKEN`, and
the bridge token must differ from `INTERNAL_TOKEN` and `ASSISTANT_TOKEN`. A `dev.env` that is the `prod.env` file
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
# With BRIDGE_MODE=browser a profile of dev's own and a bridge token are required:
# BROWSER_PROFILE_DIR=<absolute path, for example the repository's .browser-profile/dev>
# BRIDGE_TOKEN=<at least 32 random characters, different from INTERNAL_TOKEN and ASSISTANT_TOKEN>
# Telegram stays off unless both are set to a chat of dev's own:
# TELEGRAM_BOT_TOKEN=<a dev bot token>
# TELEGRAM_CHAT_ID=<a dev chat id, never a production chat>
# FINGERPRINT_KEY=<a dev key, never the production key>
# ACCESSTRADE_API_KEY=<a dev key; the production key also needs ALLOW_PROD_ACCESSTRADE_KEY=1>
# LIVE_LEDGER_PATH=<absolute path of the live copy a rehearsal reads, outside data/dev>
# PUBLIC_BASE_URL stays unset in dev.
```

## Trying the browser bridge extension in dev (Story 5.3)

The new extension is `apps/bridge` (Manifest V3). It is not the live extension in `extension/`,
which stays untouched and keeps serving production from its own profile. The new one talks only
to the server's internal listener on 127.0.0.1 with `X-Bridge-Token`, takes one job at a time from
`GET /internal/bridge/next` and answers on `POST /internal/bridge/results`. It fills the custom
link page's own form (`https://affiliate.shopee.vn/offer/custom_link`) like a person; it calls no
Shopee API and builds no signature (D8, INV-10). Lookup and report-page jobs are answered
`unsupported` until Stories 5.6 and 5.9.

Only on the owner's machine, with a profile of dev's own. Never load it into the production
profile, and never run it beside the live extension in one profile.

1. In `~/.config/cashback/dev.env` set `BRIDGE_MODE=browser`, `BROWSER_PROFILE_DIR=<absolute path of
   a new, empty folder, for example <repo>/.browser-profile/dev>` and `BRIDGE_TOKEN=<32 or more random
   characters>`. Generate the token with
   `node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"`. The start
   refuses the live `.browser-profile/`, `.browser-profile/prod/`, anything under `C:\Project\mmo`,
   and a token equal to production's.
2. Build the extension: `pnpm --filter @cashback/bridge build` (output in `apps/bridge/dist/`).
3. Start the dev server: `cd apps/server && pnpm dev:start`. The mode line shows `bridge: "browser"`
   and `bridgeRoutes: true`.
4. Start Edge (or Chrome) on the dev profile only, with the extension and the flags the live
   `start-browser.ps1` uses so a hidden window is not throttled:

   ```powershell
   & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
     --user-data-dir="<BROWSER_PROFILE_DIR>" `
     --load-extension="<repo>ppsridge\dist" --disable-extensions-except="<repo>ppsridge\dist" `
     --no-first-run --disable-sync `
     --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
   ```

   Or, in that profile, open `edge://extensions` (`chrome://extensions`), turn on Developer mode,
   choose "Load unpacked" and pick `apps/bridge/dist`. After every rebuild press "Reload" there.
5. Click the extension's toolbar button (or "Extension options"), enter
   `http://127.0.0.1:9081` (dev's `INTERNAL_PORT`) and the `BRIDGE_TOKEN`, and save. Within 30
   seconds the worker polls; `edge://extensions` then "service worker" shows
   `[cashback-bridge]` log lines. A 401 logs `bridge.token.refused` and retries every 30 seconds.
6. Sign in to affiliate.shopee.vn in this profile only with an account that is not the production
   affiliate account, or stay signed out to try the `login_redirect` answer. A link request queued
   in dev carries the `DEV` sub_id1 and request id, so even a real link made here is never credited
   in production.
7. Queue a request (`POST /internal/link-requests` with the assistant token) and watch the pinned
   custom link tab fill the source link and `Sub_id1`/`Sub_id2`, submit, and the request become
   ISSUED once the returned link passes the server's sub_id check.

Manual check (Story 5.3 AC5, the bridge tab is never discarded): with the bridge running, open
`edge://discards` (`chrome://discards`) in the dev profile. The pinned `affiliate.shopee.vn` tab
shows "Auto Discardable" unticked. Turn Memory saver (Efficiency mode) on, leave the window in
the background for 10 minutes, and confirm the tab is still loaded (no reload when it is shown)
and the next link job still runs. If the tab was closed or discarded by hand, the next job opens or
reloads it by itself.

Restarts: stopping the server (`pnpm dev:stop`) or closing the browser loses nothing. The
extension retries an unreachable server with a growing pause (up to 30 seconds); the server hands
the job that was out to the next poll of the same extension (its instance id is kept in the
profile, so a second browser never gets the same job), gives up a job nobody answers after 105
seconds, and the link job sends it again on a later run. The first silence is not counted; a
second silence in a row on the same job counts as a failed attempt and backs the request off, so
the requests behind it go first. With no bridge polling at all nothing is ever counted.

Returned links, captcha and a lost login (Stories 5.4, 5.5): the custom-link page returns a short
link only, so the extension follows it in the browser (from its service worker, without cookies)
and answers the short link with its target; the server never calls Shopee and attaches the short
link only when the target carries the request's own sub_ids. A short link the browser could not
resolve is retried after a minute, uncounted (`bridge_short_link_unresolved`). The extension's
host permissions therefore include `s.shopee.vn`, `shopee.vn`, `shope.ee` and `shp.ee`. A captcha or page error holds the queue
uncounted; signing the dev profile out makes the next job pause the queue (`bridge_login_lost`).
Resume it with `pnpm link-queue:resume --as <admin>`; see `docs/operations/bridge-runbook.md`.

TikTok Shop links (Story 5.7): without `ACCESSTRADE_API_KEY` dev makes them with the fake creator
(links on `fake-bridge.invalid`). With a key dev calls the real AccessTrade API; the production key
is refused unless `ALLOW_PROD_ACCESSTRADE_KEY=1`.
