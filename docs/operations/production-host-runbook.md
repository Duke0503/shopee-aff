# Production host runbook (Windows VPS)

How the new platform runs on the production Windows Server 2022 VPS, beside the live system until
cutover, and how the owner knows when the host goes silent (Stories 8.4 and 8.5; AD-18, AD-25,
AD-29; decisions D37, D48, D50, D51, D61). Backups and Telegram alerts are in
`backup-and-alerts-runbook.md`; the restore and its drill in `restore-runbook.md`.

Nothing in this page is done by code or tests. Every step is the owner's, on the VPS or in a
dashboard, in the order given.

## 1. What runs where

| | Live system (until cutover) | New platform |
| --- | --- | --- |
| Folder | `C:\Project\mmo` | `C:\Project\cashback` (any folder outside `C:\Project\mmo`; the scripts refuse that folder) |
| Server | task `CashbackBackend` (ports 80, 8899) | task `CashbackV2Server`: public `127.0.0.1:8080`, internal `127.0.0.1:8081` |
| Zalo assistant | task `CashbackAssistant` (port 8891) | task `CashbackV2Assistant` (no listener) |
| Affiliate browser | Edge, profile `C:\Project\mmo\.browser-profile`, old extension (port 8787) | task `CashbackV2Browser` at log-on: Edge, profile `<folder>\.browser-profile\prod`, extension `apps\bridge\dist` |
| Data | `C:\Project\mmo\cashback.db` | `<folder>\data\prod\` (ledger, lock, backups, proof files, logs) |
| PID records | none | `<folder>\run\prod\server.pid`, `assistant.pid`, `browser.pid` |
| Secrets | `C:\Project\mmo\.env` | `%USERPROFILE%\.config\cashback\prod.env` (outside the repository) |
| Tunnel | cloudflared Windows service, public hostnames to the live ports | the same service and the same routing: at cutover (Story 8.8) the new public listener takes over port 80 (`PUBLIC_PORT=80`) once the live backend has released it, so no hostname changes; see `go-live-runbook.md` |

The scripts in `ops\windows\` know only the three `CashbackV2*` tasks and refuse the live ones.
Every start and stop goes through `pnpm --filter @cashback/server host ...`, which acts only on the
PIDs it recorded and never finds a process by name, so the live processes are never touched.

## 2. One-time install (owner checklist, in order)

Do these on the VPS, signed in as the operator account that runs the live system today. Tick each
line in the go-live checklist of section 9.

### 2.1 Code and build

```powershell
git clone --branch main-v2 <repository url> C:\Project\cashback
cd C:\Project\cashback
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm --filter @cashback/admin build
pnpm --filter @cashback/web build
pnpm --filter @cashback/bridge build
```

Node 24 must be on PATH for the operator account (`node --version`).

### 2.2 The production env file

Create `%USERPROFILE%\.config\cashback\prod.env`. Every value comes from the password manager or
is generated now; none is copied from the live `.env` or from anything committed on `main` (D51).
Generate each token with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Key | Value |
| --- | --- |
| `INTERNAL_TOKEN`, `ASSISTANT_TOKEN`, `BRIDGE_TOKEN` | three different new tokens |
| `FINGERPRINT_KEY` | the production fingerprint key from the password manager (the one the cutover import uses) |
| `PUBLIC_BASE_URL` | `https://hoantiendp.com` |
| `ADMIN_HOST`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUDIENCE` | from section 5.2 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | `backup-and-alerts-runbook.md` section 1.3 |
| `HEARTBEAT_URL` | from section 3 |
| `BACKUP_*` | `backup-and-alerts-runbook.md` section 1.4 |
| `BROWSER_PROFILE_DIR` | `C:\Project\cashback\.browser-profile\prod` |
| `ZALO_GROUP_IDS`, `ZALO_ASSISTANT_URL`, `FALLBACK_CONTACT_URL`, `ACCESSTRADE_API_KEY` | as in `dev-environment.md`, production values |

Then let only the operator read it:

```powershell
icacls "$env:USERPROFILE\.config\cashback\prod.env" /inheritance:r /grant:r "${env:USERNAME}:F"
```

### 2.3 The preflight and the secrets rotation check (D51)

```powershell
cd C:\Project\cashback
pnpm --filter @cashback/server host check --env prod --also-env C:\Project\mmo\.env
```

It must print `platform.host.config_ok`, `platform.host.settings_ok`,
`platform.host.secrets_rotated` (no secret value appears anywhere in the history of `main`) and
`platform.host.secrets_not_shared` (no secret equals a value in the live `.env`). Every line names
keys only. A `secrets_committed` or `secrets_shared` line: generate a new value for each key it
names, then run the check again. If `main` is not in the clone, add `--main-ref origin/main` after
`git fetch origin main`.

### 2.4 The affiliate Edge profile

1. From the desktop session (Remote Desktop), run
   `pnpm --filter @cashback/server host start browser --env prod`. An Edge window opens on the
   Shopee Affiliate custom link page with the new profile and the new extension.
2. Sign in to the production Shopee Affiliate account in that window. Never sign in to it in any
   dev profile.
3. Open the extension's options (`edge://extensions`, "Cashback Bridge (new platform)",
   "Extension options"): Server URL `http://127.0.0.1:8081`, Bridge token = `BRIDGE_TOKEN`.
4. If Edge ignored `--load-extension`, choose "Load unpacked" on `edge://extensions` and pick
   `C:\Project\cashback\apps\bridge\dist` once; the profile keeps it.
5. Stop it with `pnpm --filter @cashback/server host stop browser --env prod`. From now on the
   log-on task starts it.

### 2.5 Install the tasks

From an elevated PowerShell:

```powershell
cd C:\Project\cashback
.\ops\windows\install-tasks.ps1                  # go-live: refuses unless `host check` passes
.\ops\windows\install-tasks.ps1 -AllowGaps       # shadow run before go-live settings are complete
```

It registers `CashbackV2Server` and `CashbackV2Assistant` (at startup plus every 5 minutes,
ignored while running; run whether the operator is signed in or not, no stored password) and
`CashbackV2Browser` (at the operator's log-on, in the desktop session). Then:

```powershell
.\ops\windows\start.ps1
.\ops\windows\status.ps1
```

### 2.6 Windows auto-logon

The affiliate Edge needs the desktop session, so after a reboot Windows signs the operator in by
itself. The password is kept as an LSA secret, never in a file or as a plain registry value.

1. Download Sysinternals Autologon from Microsoft (`https://learn.microsoft.com/sysinternals/downloads/autologon`).
2. Run `Autologon64.exe` as administrator, enter the operator's user name, domain (the computer
   name) and password, press **Enable**. Autologon stores the password encrypted as an LSA secret.
3. Check that no plain password is in the registry; this must say the value was not found:
   `reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultPassword`
4. From now on leave Remote Desktop by closing its window (disconnect), never by **Sign out**:
   signing out ends the session that holds Edge.

### 2.7 Windows Update active hours and restart window

Updates install and restart only in a quiet window after the 03:00 backup; never during the day.
In `gpedit.msc`, Computer Configuration, Administrative Templates, Windows Components, Windows
Update, Manage end user experience:

| Policy | Setting |
| --- | --- |
| Configure Automatic Updates | Enabled; 4 - Auto download and schedule the install; every Sunday; 04:00 |
| Turn off auto-restart for updates during active hours | Enabled; 07:00 to 23:00 |
| Always automatically restart at the scheduled time | Enabled; 15 minutes |

Then `gpupdate /force`. The heartbeat (section 3) reports a restart that does not come back.

### 2.8 Windows Firewall

The listeners bind `127.0.0.1` only. Check that no inbound rule opens the new ports:

```powershell
Get-NetFirewallPortFilter | Where-Object { $_.LocalPort -in "8080", "8081" } | Get-NetFirewallRule | Where-Object { $_.Direction -eq "Inbound" -and $_.Enabled -eq "True" }
```

It must print nothing.

## 3. External heartbeat (Story 8.4, AD-29)

The server pings `HEARTBEAT_URL` every 5 minutes while its health model is green (no part down; a
due restore drill does not count). The checker, outside the VPS, alerts the owner on Telegram
when the pings stop for 15 minutes: VPS down, internet lost, a Windows Update restart that did not
come back, the server stopped, or a part of the server down. Production logs
`operations.heartbeat.url_absent` at every start while the key is missing. The URL is a secret
(it holds the check's id); a dev env file that names production's URL is refused at start.

### 3.1 healthchecks.io (free tier)

1. Sign up at `https://healthchecks.io` with the owner's e-mail; create the project `cashback`.
2. **Add Check**: name `cashback-prod-server`; Schedule **Simple**; Period **5 minutes**; Grace
   time **10 minutes**. healthchecks.io alerts once period plus grace pass without a ping, so the
   owner hears after 15 minutes of silence.
3. **Integrations**, **Telegram**, **Add Integration**: it opens `@HealthchecksBot`; start it in
   the owner's alert chat (or add it to the alert group and send `/start`). Back on the page,
   enable the integration for `cashback-prod-server`.
4. Copy the check's ping URL (`https://hc-ping.com/<uuid>`) into `HEARTBEAT_URL` in `prod.env`
   and into the password manager. Restart the server (`stop.ps1`, `start.ps1`).
5. Within 5 minutes the check turns green ("up"). Until its first ping a new check never alerts.

### 3.2 Alternative: a Cloudflare Worker cron

Only if healthchecks.io is unavailable. A Worker on the owner's Cloudflare account with one KV
namespace: `GET /ping/<random secret>` stores the time in KV; a Cron Trigger every 5 minutes
reads it and, when it is older than 15 minutes and no alert was sent since, calls Telegram's
`sendMessage` with the bot token kept as a Worker secret. `HEARTBEAT_URL` is then
`https://<worker host>/ping/<random secret>`. Nothing of this runs on the VPS.

## 4. After-reboot checklist

After any restart (Windows Update, the provider, by hand), within 10 minutes:

- [ ] The desktop session is signed in (Remote Desktop connects to a running session, no log-on prompt first).
- [ ] `.\ops\windows\status.ps1`: `CashbackV2Server` and `CashbackV2Assistant` are **Running**,
      `CashbackV2Browser` is **Running**; `host status` shows each role `running`.
- [ ] `service cloudflared : Running, start type Automatic`.
- [ ] The tunnel check line says `platform.host.tunnel_ok` (after cutover).
- [ ] The affiliate Edge window is open on the custom link page and **signed in** to Shopee
      Affiliate (no sign-in form); the extension icon shows no error.
- [ ] The healthchecks.io check is green again.
- [ ] The admin desk Overview health line shows no part down.
- [ ] The live tasks `CashbackBackend` and `CashbackAssistant` are as they were before (until cutover).

If a task is not running, start it with `.\ops\windows\start.ps1` and read
`data\prod\logs\server.log` or `assistant.log`. If Edge is signed out, follow
`bridge-runbook.md#sign-in-again`.

## 5. Cloudflare dashboard (owner steps)

### 5.1 Tunnel public hostnames (at cutover, Story 8.8)

> Cutover of 2026-11-02: the public listener runs on port 80 (`go-live-runbook.md`), so read
> `8080` below as the value of `PUBLIC_PORT`; `hoantiendp.com` keeps its existing route to port 80.

The tunnel is remotely managed (the cloudflared service runs with a token). In Zero Trust,
**Networks**, **Tunnels**, the production tunnel, **Public Hostname**, the list must be exactly:

| Subdomain | Domain | Path | Service |
| --- | --- | --- | --- |
| (empty) | hoantiendp.com | (empty) | HTTP `127.0.0.1:8080` |
| www | hoantiendp.com | (empty) | HTTP `127.0.0.1:8080` |
| admin | hoantiendp.com | (empty) | HTTP `127.0.0.1:8080` |

Nothing points at `8081` (the internal listener) or at a live port once cutover is done. A
locally managed tunnel (a `config.yml`) is checked by
`pnpm --filter @cashback/server host tunnel-check --config <config.yml>` (also run by
`status.ps1`): every service must be `http://127.0.0.1:8080` or a fixed `http_status:`, the last
rule the catch-all `http_status:404`.

Check from a computer outside the VPS:

- [ ] `curl -s -o NUL -w "%{http_code}" https://hoantiendp.com/internal/ping` prints `404`
      (the public listener has no internal route).
- [ ] `Test-NetConnection <VPS public IP> -Port 8081` reports `TcpTestSucceeded : False`.
- [ ] `Test-NetConnection <VPS public IP> -Port 8080` reports `TcpTestSucceeded : False`.

### 5.2 Cloudflare Access on the admin host (D48, Story 4.2)

1. Zero Trust, **Settings**, **Authentication**: add **One-time PIN** as a login method.
2. **Access**, **Applications**, **Add an application**, **Self-hosted**: name `cashback admin`;
   domain `admin.hoantiendp.com`, path empty (the whole host); session duration 24 hours.
3. Policy `staff`: action **Allow**; include **Emails**: the owner's and each staff member's
   e-mail. No other rule. Save.
4. Open the application again: copy **Application Audience (AUD) Tag** into `ACCESS_AUDIENCE`;
   the team domain (Settings, Custom Pages, `<team>.cloudflareaccess.com`) into
   `ACCESS_TEAM_DOMAIN`; `ADMIN_HOST=admin.hoantiendp.com`. Restart the server.
5. Test (record in section 8): a private browser window on `https://admin.hoantiendp.com/admin/`
   shows the Cloudflare Access sign-in, not the desk; after the PIN, the desk shows its own staff
   sign-in, and `https://admin.hoantiendp.com/api/admin/payouts` answers 401 until staff sign in.

### 5.3 Rate limiting and WAF rules (AD-18; review M10)

Every request reaches the server from `127.0.0.1` through the tunnel, so per-address limits are
Cloudflare's. **Security**, **WAF**, on the `hoantiendp.com` zone.

**Rate limiting rules** (Free plan allows one rule with a 10-second period; the Pro values are in
brackets). Create rule `sign-in-and-links`:

- Expression (Edit expression):

  ```text
  (http.host eq "hoantiendp.com" and http.request.uri.path eq "/api/session" and http.request.method eq "POST")
  or (http.host in {"hoantiendp.com" "www.hoantiendp.com"} and starts_with(http.request.uri.path, "/api/links") and http.request.method eq "POST")
  or (http.host eq "www.hoantiendp.com" and http.request.uri.path eq "/api/session" and http.request.method eq "POST")
  ```

- Counting characteristics: **IP**. Rate: **5 requests per 10 seconds** (Pro: 10 per 1 minute).
- Action: **Block**, duration **10 seconds** (Pro: 10 minutes). Deploy.

On Pro add a second rule `share-and-receipt-pages`:
`(starts_with(http.request.uri.path, "/s/") or starts_with(http.request.uri.path, "/b/"))`,
IP, 60 requests per 1 minute, action **Managed Challenge**, 10 minutes.

**Custom rules** (WAF, Custom rules):

| Name | Expression | Action |
| --- | --- | --- |
| `no-internal-paths` | `(starts_with(http.request.uri.path, "/internal/"))` | Block |
| `session-methods` | `(http.request.uri.path eq "/api/session" and not http.request.method in {"GET" "POST" "DELETE"})` | Block |
| `links-methods` | `(starts_with(http.request.uri.path, "/api/links") and not http.request.method in {"GET" "POST"})` | Block |

Leave Bot Fight Mode off: it challenges the website's own API calls.

## 6. Start, stop, status

```powershell
.\ops\windows\status.ps1     # tasks, cloudflared, recorded processes, tunnel check (read-only)
.\ops\windows\stop.ps1       # disables the three tasks, then stops the recorded processes
.\ops\windows\start.ps1      # enables and starts the three tasks
.\ops\windows\uninstall-tasks.ps1   # removes the three tasks (rollback), after stop.ps1
```

A start waits for the server's health route. While the server reports it is starting (its
pre-migration backup and migrations, `run\prod\server.phase.json`) the start waits up to 30
minutes and never kills it; past that it reports `started` with `pending: still_starting` and
leaves it running: read `data\prod\logs\server.log`. A server that reports nothing and does not
answer within 60 seconds is stopped and reported `failed`.

`stop.ps1` stops the server in order through its internal shutdown route (jobs, listeners,
ledger, lock), then the assistant and Edge by their recorded PIDs. A PID the OS has given to
another process is reported `not_ours` and left alone.

## 7. Heartbeat silence test (recorded manual test)

Story 8.4 AC3, once before go-live and after any change to the check. On the VPS:

1. Note the time; run `.\ops\windows\stop.ps1`.
2. Wait. Within 15 to 20 minutes the owner's Telegram chat receives the healthchecks.io "down"
   message for `cashback-prod-server`.
3. Note the time it arrived; run `.\ops\windows\start.ps1`; within 5 minutes the "up" message
   arrives.
4. Add a row:

| Date | Stopped at | Telegram alert at | Minutes | Result | By |
| --- | --- | --- | --- | --- | --- |

## 8. Rate-limit burst test (recorded manual test)

Story 8.5 AC4, once after the rules are deployed, from a computer outside the VPS:

```powershell
1..20 | ForEach-Object { (Invoke-WebRequest -Uri https://hoantiendp.com/api/session -Method Post -ContentType "application/json" -Body '{"customerCode":"DP00000","password":"wrong-password"}' -SkipHttpErrorCheck).StatusCode }
```

(Windows PowerShell 5.1 has no `-SkipHttpErrorCheck`: use PowerShell 7, or `curl.exe -s -o NUL -w "%{http_code}\n" -X POST ...` in a loop.)
The first answers are `401` or `403` from the server; then Cloudflare answers `429` for the rest of
the block time. The Access test of section 5.2 is logged here too.

| Date | Test | Expected | Seen | Result | By |
| --- | --- | --- | --- | --- | --- |

## 9. Go-live checklist (Story 8.5)

- [ ] 2.1 code built in a folder outside `C:\Project\mmo`
- [ ] 2.2 `prod.env` outside the repository, new values, readable by the operator only
- [ ] 2.3 `host check`: settings_ok, secrets_rotated, secrets_not_shared
- [ ] 2.4 affiliate Edge profile signed in, extension options set
- [ ] 2.5 tasks installed and running (`status.ps1`)
- [ ] 2.6 auto-logon enabled, no `DefaultPassword` in the registry
- [ ] 2.7 Windows Update policies set
- [ ] 2.8 no inbound firewall rule for 8080 or 8081
- [ ] 3 heartbeat check green; section 7 test recorded
- [ ] 4 a reboot done and the after-reboot checklist passed
- [ ] 5.1 public hostnames only to `127.0.0.1:8080` (at cutover); outside checks done
- [ ] 5.2 Access application and policy; test recorded
- [ ] 5.3 rate-limit and custom rules deployed; section 8 test recorded
