# Go-live runbook (cutover night and the 72-hour window)

How the live system in `C:\Project\mmo` is replaced by the new platform on the production Windows
VPS, how the 72 hours after it are run, and how to roll back (Stories 8.7 and 8.8; AD-24, AD-25;
decisions D40, D44, D46, D51, D61; owner decisions of 2026-11-02). The host itself is described in
`production-host-runbook.md`; backups and alerts in `backup-and-alerts-runbook.md`; the restore in
`restore-runbook.md`; the Zalo session move in `shadow-run.md#zalo-account-at-cutover`.

Everything that changes the VPS is done by `ops\windows\cutover\cutover.ps1`, in phases, each
logged as one JSON line in `<WorkDir>\cutover-log.jsonl` and recorded in
`<WorkDir>\cutover-state.json`. Running the same command again resumes at the first phase not
done. No phase prints a secret.

## 1. What tonight does

| Phase | Live mode does | Rehearsal mode does |
| --- | --- | --- |
| preflight | Node 24 portable present, builds present, prod.env loads, production settings and secrets check (`pnpm cutover:step preflight`), disk and RAM, live tasks, cloudflared, runner service; records the state needed for rollback | Node 24, builds, live copy, disk; writes the rehearsal's own env file |
| stop-old | stops and disables the GitHub runner service, `CashbackBackend` and `CashbackAssistant`; waits until ports 80, 8899, 8891, 8787 are free (stops a leftover listener by its port) | prints what it would do |
| final-backup | copies `cashback.db` with `-wal`/`-shm` into `final\raw`, writes `final\live-final.db` with the SQLite backup API, integrity check, SHA-256, and `live-final.db.age` when `BACKUP_AGE_*` is set | the same on the copy |
| import | `cutover:import` into `<WorkDir>\new-ledger.sqlite`; turns `messaging.silent` on and opens the 72-hour no-payout window | the same |
| parity | the gate: counts of customers, aliases, orders, link requests, share codes, payouts, campaign awards, clicks equal; paid cashback, payout total and paid bonus equal per customer to the dong; import report clean. Fail = abort | the same |
| audit | the numbers audit (`cutover:step audit`): every order (owner after merges, status mapping, value, commissions, cashback, paid time, covering payout, platform, link), every transfer (amount, owner, covered orders and bonuses, covered sum), every customer (paid, payable and waiting against what the live payout screen showed) and every network batch (received and gross against its raw report, fee plus tax). Writes `audit.json` and `audit.md`. Any difference without a documented reason = abort | the same |
| first-run | the quiet first reconciliation (`cutover:first-run`), would-be sends in `first-run.json`; checks both flags are on | the same |
| carry-over | copies `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ACCESSTRADE_API_KEY` and the Zalo group ids from the live `.env` into unset keys of `prod.env`; sets `PUBLIC_PORT=80`, `LIVE_LEDGER_PATH`, `ZALO_CREDENTIALS_PATH`; copies `credentials.json` (live assistant stopped); key names only | runs on throw-away files and proves no value reached the output |
| start-new | puts Node 24 on the machine PATH instead of Node 20, stops a shadow-run server, installs only the ledger file (an older ledger and its WAL are moved aside; proofs, backups and logs stay), starts the 72-hour no-payout window at this moment (go-live), installs and starts the `CashbackV2*` tasks; waits for `/api/health` on port 80 | the same on the rehearsal's own data folder; the server on 127.0.0.1:9180 and [::1]:9180, fake bridge and Zalo |
| smoke | health, website, 20 old share links and the receipts on `127.0.0.1:80`; one of each by `localhost:80` and `[::1]:80` (the tunnel's route names `localhost`) and through `https://hoantiendp.com`; fails on a short sample | the same without the tunnel; then stops the server |

The new server takes over **port 80**, the port the tunnel already routes `hoantiendp.com` to, after
the old backend has released it. It listens on both loopbacks, 127.0.0.1 and ::1 (never on all
addresses): the tunnel's route is `http://localhost:80`, and Windows may resolve `localhost` to ::1
first, as the old backend's dual-stack listener answered both. The tunnel and its dashboard routing stay as they are; no
Cloudflare change is needed for the public site. Any phase failing after stop-old rolls back at
once (section 7).

**Rehearsal result (Story 8.7, the copy of 2026-11-02 12:20):** every phase ok, verdict GO.
Parity pass: customers 79, aliases 74, orders 107, link requests 416, share codes 264, payouts 33,
campaign awards 6, clicks 578 equal on both sides; 21 paid customers, 1,280,152 dong paid cashback
equal to the dong. Numbers audit pass, 0 unexplained: 107 orders (paid 84, rejected 13, awaiting
10, each mapped to the same new status), 33 transfers totalling 1,400,146 dong paid on both sides
(cashback 1,280,152 plus bonuses 120,000, minus the known 6 dong under-transfer of payout 10),
12 network batches received 1,423,134 dong matching their raw reports; payable 0 on both sides.
Explained differences only: payout 10 (`known_live_discrepancy`), 3 customers' waiting estimates
1 dong apart (`estimate_not_owed`), 6 customers whose live QR showed their awaiting estimate as if
payable (`live_qr_showed_awaiting`, the live bug). 0 would-be sends; 28 smoke checks ok. The live
copy has no receipt tokens (`main` never had `bill_token`), so no `/b/` link exists to check.
Downtime about 1 minute on the operator's machine; plan 45 minutes on the VPS.

## 2. Before tonight (operator's machine, then the VPS in the afternoon)

Only about 190 MB of RAM is free on the VPS while the live system runs: build nothing there, and
never run both systems at once.

1. On the operator's machine, in a clean clone of `main-v2`:

   ```powershell
   corepack enable pnpm
   pnpm install --frozen-lockfile
   pnpm --filter @cashback/web build
   pnpm --filter @cashback/admin build
   pnpm --filter @cashback/bridge build
   ```

   Expected: `apps\web\dist\index.html`, `apps\admin\dist\index.html`, `apps\bridge\dist\manifest.json`.
2. Rehearse on a fresh copy of the live database (copied read-only from the VPS backups folder
   `C:\Project\mmo\backups`, never the live file while it runs):

   ```powershell
   .\ops\windows\cutover\cutover.ps1 -LiveCopy C:\copies\live-copy.db -WorkDir C:\copies\rehearsal-<date>
   ```

   Expected last line: `{"event":"cutover.end","ok":true,"complete":true,"verdict":"GO",...}`.
   Read `go-no-go.md`, `parity.json`, `audit.md` and `first-run.json` in the work folder and sign the checklist.
   A NO-GO stays NO-GO until fixed and rehearsed again (Story 8.7 AC5).
3. Copy the working tree to the VPS as `C:\Project\cashback` (outside `C:\Project\mmo`): the clone
   with its `dist` folders. Run `pnpm install --frozen-lockfile` there once (no build; it only
   downloads). If RAM is too tight for it, run it right after the stop-old phase (section 4,
   step 4) and add the time to the downtime.
4. Put the portable Node 24 (the zip `node-v24.x.y-win-x64` from nodejs.org, the same version as
   `node --version` on the operator's machine) in `C:\Tools\node-v24`. Do not touch Node 20; the
   cutover only takes it off the PATH and keeps it on disk for the rollback.
5. `prod.env` as in `production-host-runbook.md` section 2.2, with `PUBLIC_BASE_URL=https://hoantiendp.com`
   and `BROWSER_PROFILE_DIR=C:\Project\cashback\.browser-profile\prod`. Leave
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ACCESSTRADE_API_KEY` and `ZALO_GROUP_IDS` unset: the
   carry-over fills them. Every other secret is new (D51).
6. In the Cloudflare dashboard, open the tunnel's public hostname for `hoantiendp.com` (read only)
   and check its service is `http://localhost:80` (verified: it is), `http://127.0.0.1:80` or
   `http://[::1]:80`. If it names the VPS's own public address instead, change it to
   `http://localhost:80` now, while the live system answers on all of them; the new server listens
   on the two loopbacks only.
7. The preflight alone, from an elevated PowerShell on the VPS (it stops nothing):

   ```powershell
   cd C:\Project\cashback
   .\ops\windows\cutover\cutover.ps1 -Mode Live -WorkDir C:\Project\cutover -Node24Dir C:\Tools\node-v24 -Phase preflight -AcceptGaps "ADMIN_HOST,ACCESS_TEAM_DOMAIN,ACCESS_AUDIENCE"
   ```

   Expected: `"phase":"preflight","status":"ok"` with `openGaps` listing only what you accepted.
   `preflight_refused:settings_missing:<keys>`: fill those keys or add them to `-AcceptGaps` if
   they are owner steps for later (Access, `HEARTBEAT_URL`, `BACKUP_*`).
   `secrets_committed:<key>` or `secrets_shared:<key>`: generate a new value for that key; a
   carried key that was committed on `main` must be rotated at its provider first.

## 3. Go/no-go before starting (owner)

- [ ] Shadow diff signed off (`shadow-run.md`), and tonight's rehearsal checklist says GO.
- [ ] Secrets rotated (D51): the preflight is ok with no `secrets_*` problem.
- [ ] Today's 03:00 backup of the live system exists in `C:\Project\mmo\backups`.
- [ ] Nobody is paying customers tonight; staff told payouts pause for 72 hours.
- [ ] No merge into `main` is planned: the runner deploys `main` and is stopped tonight.
- [ ] The new affiliate Edge profile was signed in to Shopee Affiliate earlier
      (`production-host-runbook.md` 2.4), or there is time to do it in step 6 below.

## 4. Tonight, in order

| # | Step | Expected |
| --- | --- | --- |
| 1 | Post in the Dev group that maintenance starts; note the time. | |
| 2 | Remove the old extension from the live affiliate Edge (clicks below). | the old Edge has no Cashback extension |
| 3 | Run the cutover (command below). | one JSON line per phase |
| 4 | Read the end line. | `"verdict":"GO"`, exit 0 |
| 5 | Load the new extension in the new affiliate Edge profile (clicks below). | the extension icon shows no error |
| 6 | Create the admin staff (below), send a test link in the Dev group. | the bot answers with `hoantiendp.com/s/<code>` |
| 7 | Watch for 30 minutes (section 5). | |

**Step 2, removing the old extension.** On the VPS desktop (Remote Desktop), in the Edge window of
the live profile (`C:\Project\mmo\.browser-profile`): type `edge://extensions` in the address bar,
press Enter; on the old Cashback bridge card click **Remove**, then **Remove** again; close that
Edge window. Only then add `-ConfirmOldExtensionRemoved` below.

**Step 3, the cutover.** Elevated PowerShell:

```powershell
cd C:\Project\cashback
.\ops\windows\cutover\cutover.ps1 -Mode Live -WorkDir C:\Project\cutover -Node24Dir C:\Tools\node-v24 -ConfirmOldExtensionRemoved -AcceptGaps "ADMIN_HOST,ACCESS_TEAM_DOMAIN,ACCESS_AUDIENCE"
```

Expected lines, in order (abridged): `preflight ok` (or `already_done`), `stop-old ok` with
`stoppedTasks`, `final-backup ok` with `sha256` (write it down), `import ok`, `parity ok` with
`"result":"pass"` and the eight counts, `audit ok` with `"result":"pass"` (read `audit.md`), `first-run ok` with `"messagingSilent":true` and
`payoutWindowEndsAt`, `carry-over ok` with key names, `start-new ok` with `goLiveAt` (write it
down: the window ends 72 hours later), `smoke ok`, then `cutover.end` with `"verdict":"GO"`. Any
`"status":"failed"` after stop-old is followed by `cutover.abort` and `cutover.rollback`: the live
system is back; see section 7. If the window closes or the connection drops, run the same command
again: it resumes.

**Step 5, the new extension.** On the VPS desktop the log-on task opened Edge with the new profile
(`C:\Project\cashback\.browser-profile\prod`). If no such window is open, run
`.\ops\windows\start.ps1`. In that window:

1. Type `edge://extensions`, press Enter. Turn on **Developer mode** (switch at the bottom left).
2. If "Cashback Bridge (new platform)" is not listed, click **Load unpacked** and choose
   `C:\Project\cashback\apps\bridge\dist`, then **Select Folder**.
3. On its card click **Details**, then **Extension options**: Server URL `http://127.0.0.1:8081`,
   Bridge token = `BRIDGE_TOKEN` from `prod.env` (typed from the password manager), **Save**.
4. Open `https://affiliate.shopee.vn/offer/custom_link`; if a sign-in form shows, sign in to the
   production Shopee Affiliate account (never in a dev profile). Leave the window open.

**Step 6, staff and the test.** The import carries no staff accounts. In
`C:\Project\cashback\apps\server`, with a `seed.json` naming the owner as root
(`{"root":{"staffId":"owner","username":"owner"},"members":[]}`):

```powershell
pnpm staff:seed seed.json
```

It asks the new password twice (never shown) and prints `{"ok":true,...}`. Then send a Shopee
product link in the Dev group: the new bot answers with a share link; open it in a phone browser.

## 5. The 72-hour window

The window starts at `goLiveAt` (the start-new line) and ends 72 hours later, its
`payoutWindowEndsAt`. One clock: the import opens the window, go-live restarts it from that moment,
the rollback is offered only while it is open, and closing it is refused before its end.

- **No payouts.** While the window is open the server refuses opening a payout, showing the account
  number and confirming, with `confirm_paused`; a payout recorded before is still answered on a
  retry. Payouts shows a banner with the window's end. Only the owner clears it, and not before
  the end (section 8). No transfer is made from the old system
  either: it is stopped and stays stopped.
- **Quiet messaging.** `messaging.silent` is on: order and payout notifications are recorded as
  would-be sends, not sent. Replies to customers' own requests (links) work. Once the would-be
  sends in `first-run.json` are read, turn it off:
  `pnpm --filter @cashback/server messaging:silent off --as owner`. From then on watch the daily
  cap: the owner gets a Telegram alert when proactive sends reach `NOTIFICATION_DAILY_CAP`
  (150 by default); the Overview shows the counter once the admin desk is reachable.
- **Do not merge `main`; the runner stays stopped and disabled.** Nothing may redeploy the old
  system. Do not start `CashbackBackend` or `CashbackAssistant` by hand (two Zalo sessions kick
  each other off).
- **Admin desk.** The spine (AD-18, D48) serves the desk only on the admin host behind Cloudflare
  Access and never authorises by source address, so there is no loopback exception: until the
  owner creates Access, the admin desk is unavailable, from the VPS too. The admin commands of the
  internal CLI (`staff:*`, `messaging:silent`, `payout:window`, `link-queue:resume`) work on the
  VPS meanwhile. To open the desk, the owner does `production-host-runbook.md` 5.2 with one
  difference in 5.1: the hostname `admin.hoantiendp.com` gets the service `HTTP 127.0.0.1:80` (the
  public listener's port after this cutover). Then put `ADMIN_HOST=admin.hoantiendp.com`,
  `ACCESS_TEAM_DOMAIN`, `ACCESS_AUDIENCE` in `prod.env` and run `.\ops\windows\stop.ps1` then
  `.\ops\windows\start.ps1`.
- **Records.** Every incident inside the window goes into the table in section 9.

## 6. Watch list (first day)

- `.\ops\windows\status.ps1`: the three `CashbackV2*` tasks Running; the live tasks Disabled.
- `data\prod\logs\server.log`: no `level` 50 or 60 lines; `assistant.log` shows the Zalo session.
- Telegram owner chat: no critical alert (`assistant_session_conflict`, `bridge_signed_out`).
- A test link in the Dev group answers within a minute; the website and an old share link open.

## 7. Rollback

Allowed only inside the window and while the payout window is still open; after either,
`rollback.ps1` refuses and the new system is final (once the payout window is closed, payouts may
exist in the new ledger and the old system would pay them again). A rolled-back work folder is
never resumed: a later cutover starts again with a new `-WorkDir` and redoes every phase.

**Triggers (any one):** parity, audit or smoke failed (automatic); the public site or old share links do
not open through `hoantiendp.com` for 15 minutes; the new bot cannot hold the Zalo session; the
affiliate Edge cannot create links for 30 minutes with the profile signed in; an amount shown to
a customer differs from the old system; any sign of data loss.

```powershell
cd C:\Project\cashback
.\ops\windows\cutover\rollback.ps1 -WorkDir C:\Project\cutover -Reason "<what happened>"
```

It stops the new tasks, waits until port 80 is free, restores the machine PATH with Node 20,
enables and starts `CashbackBackend` and `CashbackAssistant`, waits until port 80 answers again,
and restores the runner service as it was. Expected: a `cutover.rollback` line with
`"livePort80":true`; the time is in `cutover-state.json` (`rolledBackAt`). By hand afterwards:

1. Stop the new affiliate Edge window. In the live Edge profile, `edge://extensions`, **Load
   unpacked**, the old extension folder (`C:\Project\mmo\extension`), as before.
2. Move the Zalo session back only if the new assistant changed it:
   copy `%USERPROFILE%\.config\cashback\zalo\credentials.json` over
   `C:\Project\mmo\zalo_assistant\credentials.json` with both assistants stopped.
3. Links requested in the new system during the window: list them from the new ledger for staff
   (they belong to the customers and stay valid at Shopee); nothing was paid there.
4. Post in the Dev group; record the rollback in section 9.

## 8. After 72 hours

1. Go decision by the owner (no trigger of section 7 hit). Record it in section 9.
2. Close the no-payout window (refused before its end, audited):

   ```powershell
   cd C:\Project\cashback\apps\server
   pnpm payout:window off --as owner
   ```

   Expected: `{"ok":true,"command":"payout-window","open":false,"endsAt":null}`.
3. Clean up: first the plan, then apply (elevated):

   ```powershell
   .\ops\windows\cutover\after-window.ps1 -WorkDir C:\Project\cutover
   .\ops\windows\cutover\after-window.ps1 -WorkDir C:\Project\cutover -Apply
   ```

   It refuses inside the window, after a rollback, or while the payout window is open. It
   archives `C:\Project\mmo` (with `cashback.db`) to `C:\Archive\mmo-<date>.zip` and the cutover
   reports and final backup to `C:\Archive\cutover-<date>\`, then removes the live tasks, the
   runner service and its folder, the Node 20 folder, the cutover work folder and `C:\Project\mmo`.
4. In GitHub, **Settings**, **Actions**, **Runners**: remove the offline self-hosted runner.
5. Only now merge into `main` as `docs/rules/git.md` describes.
6. Copy the archive off the VPS (it holds personal data: keep it encrypted, as the backups).

## 9. Records

| Date and time | Event (start, phase failed, rollback, go decision, window closed, cleanup) | By | Note |
| --- | --- | --- | --- |
