# Backup and alerts runbook

How the new platform keeps the ledger safe and tells the owner when something needs a person
(Stories 8.2 and 8.3; AD-26, AD-27; decisions D36, D52, D61). Production runs on the Windows
Server 2022 VPS (D61). The restore and its quarterly drill are in `restore-runbook.md` (Story 8.6);
the external heartbeat and the host itself are in `production-host-runbook.md` (Stories 8.4, 8.5).

## 1. One-time owner setup (before go-live)

Nothing here is downloaded or installed by the server. The owner installs the two tools by hand
and writes their paths into the env file. Every value below is a secret or an identifier that
stays out of the repository.

### 1.1 age key pair (encryption)

1. On the owner's own computer, **not on the VPS**, download `age` and `age-keygen` for Windows
   from the official release page (github.com/FiloSottile/age/releases, an exact version such as
   v1.2.1, checked against its published checksum).
2. Run `age-keygen -o cashback-backup-key.txt`. The file holds the private key
   (`AGE-SECRET-KEY-1...`) and, in a comment, the public key (`age1...`).
3. Store `cashback-backup-key.txt` in the password manager. It is the only way to read a backup.
   It never goes onto the VPS, into an env file or into the repository.
4. On the VPS, put `age.exe` in `C:\Tools\age\` (any folder outside the repository and outside
   `data\`). Only the public key goes into the env file.

### 1.2 rclone remote (Google Drive, D36)

1. On the VPS, put `rclone.exe` (an exact version from rclone.org, checksum checked) in
   `C:\Tools\rclone\`.
2. Signed in as the Windows user that runs the server task, run
   `C:\Tools\rclone\rclone.exe config --config C:\Users\<user>\.config\cashback\rclone.conf`
   and create a remote named `gdrive`, type `drive`, scope `drive.file` (rclone sees only the
   files it creates), authorised with the owner's Google account.
3. Create the folder: `rclone.exe mkdir gdrive:cashback-backups/prod --config <same file>`.
4. `rclone.conf` holds the Google Drive token: it is a secret, kept outside the repository and
   `data\`, and rebuilt by hand from the password manager after a VPS loss (it is never in a
   backup).
5. Dev, when it copies off-site at all, uses its own folder (`gdrive:cashback-backups/dev`): the
   start refuses a dev `BACKUP_RCLONE_REMOTE` equal to production's.

### 1.3 Telegram bot and chat (AD-27)

1. In Telegram, ask @BotFather for `/newbot`; keep the bot token in the password manager.
2. Production alerts go to the owner alert chat `-1004416753701` (listed in
   `apps/server/src/platform/config/production-identifiers.json`). Add the bot to that chat.
3. Dev never uses `-1004416753701` or the business chat `-5232520551`: the dev start refuses them.
   A dev chat, when wanted, is a separate group with its own bot token.
4. Send one test message by hand from the bot (Telegram's `sendMessage` in a browser) to check
   the chat id before go-live. Tests never reach Telegram.

### 1.4 Env file keys (`~/.config/cashback/prod.env`)

| Key | Example | Rule |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | from @BotFather | both Telegram keys or neither |
| `TELEGRAM_CHAT_ID` | `-1004416753701` | digits, optional leading `-` |
| `BACKUP_AGE_PATH` | `C:\Tools\age\age.exe` | absolute; the four `BACKUP_*` keys come together or not at all |
| `BACKUP_AGE_RECIPIENT` | `age1...` (62 characters) | the public key only; a private key is refused |
| `BACKUP_RCLONE_PATH` | `C:\Tools\rclone\rclone.exe` | absolute |
| `BACKUP_RCLONE_REMOTE` | `gdrive:cashback-backups/prod` | remote name, colon, folder |
| `BACKUP_RCLONE_CONFIG` | `C:\Users\<user>\.config\cashback\rclone.conf` | optional, absolute; rclone's default place when unset |

Without Telegram keys alerts are stored and logged only; production logs
`operations.alert.telegram_absent` as an error at every start. Without the `BACKUP_*` keys dev
keeps local backups only, while production reports every daily off-site copy as failed (high
alert, health line down), so a production without an off-site copy is never silent.

## 2. Backups (Story 8.2, AD-26)

### 2.1 What runs and when

| Run | When | Gates anything? |
| --- | --- | --- |
| Pre-migration copy | at a start that has a pending migration, before the first one | yes: the start stops if the copy, its `integrity_check` or its row-count check (equal to the live ledger) fails |
| Daily backup | 03:00 Vietnam time; also right after a start that applied migrations | no: the server keeps running; a failure alerts |

Pre-migration copies are plain `data\<env>\backups\<instant>-pre-migration.sqlite` files.

### 2.2 One daily run

1. The ledger is copied with SQLite's online backup API into a work folder inside
   `data\<env>\backups\daily\`, and the live row counts are read the moment the copy ends.
2. `PRAGMA integrity_check` on the copy.
3. One tar archive with `ledger.sqlite` and `files\` (the proof images), written inside the work
   folder. Env files, `.pem` and `.key` files, anything named `credential*` or `cloudflared*` are
   never put in, wherever they sit. A file whose name the archive cannot hold safely (spaces,
   accents: only a file put there by hand, since the server names every proof image
   `<32 hex>.jpg|png`) is skipped, counted in `skippedFiles` of the status file and logged once
   per run as `platform.backup.files_skipped`; it never fails the backup.
4. Restore check: the archive is extracted into a temporary folder; every entry must come back
   with the same size and SHA-256, the restored ledger must pass `integrity_check`, and its row
   counts must equal the live counts. Only then is it renamed to
   `data\<env>\backups\daily\<instant>-daily.tar`, so a run stopped half way never leaves a
   truncated file under an archive's name. An archive that fails is kept as `.corrupt`.
5. Local retention: the 30 newest daily archives, plus the first archive of each of the 12
   Vietnam months before them (42 files at most). Files that are not archives are never touched.
   A retention error is logged (`platform.backup.retention_failed`) and the run goes on.
6. Off-site: `age --encrypt --recipient <public key>` writes `<archive>.age` beside it, rclone
   `copyto` puts it in the Drive folder, the local `.age` is deleted, and the same retention runs
   over the Drive folder (`lsf`, `deletefile`).
7. `data\<env>\backups\backup-status.json` records the last good copy, the last off-site copy and
   the outcome; the health model reads it.

Before each run, housekeeping keeps the 3 newest `.corrupt` archives and removes older ones,
and removes work folders (`.work-*`) and `.age` files a stopped run left more than a day ago.

The local archive is not encrypted: it sits on the same disk as the ledger it copies. Only the
Drive copy leaves the machine, and only age-encrypted.

### 2.3 When a backup alert arrives

| Alert | Check | Then |
| --- | --- | --- |
| `backup_failed` | the log line `platform.backup.failed` names the step (`snapshot`, `integrity`, `archive`, `restore_check`, `unexpected`); free disk space on the VPS; a `.corrupt` archive in `backups\daily\` | fix the cause; the next 03:00 run retries (a start that applies migrations also runs one). There is no manual backup command yet |
| `backup_offsite_failed` | the log line `platform.backup.offsite_failed` names the step (`encrypt`, `upload`, `list`, `remove`, `not_configured`) and the exit code | run the same `rclone lsf gdrive:cashback-backups/prod --config ...` by hand; re-authorise with `rclone config reconnect gdrive:` if the token expired; check `age.exe` exists at its path |
| start refused with `backup_check_failed` or `restore_check_failed` | the quarantined `.sqlite.corrupt` in `backups\` | do not delete the ledger; check the disk, then start again |

The Overview health line shows **Sao lưu: có lỗi** with the time of the last good local copy
until a run succeeds.

## 3. Restore (Story 8.6)

The restore procedure, the `pnpm restore:ledger` command that checks the restored ledger against
the archive's manifest (row counts and balance totals at backup time), and the quarterly drill log
are in [`restore-runbook.md`](restore-runbook.md). Secrets, `rclone.conf` and the cloudflared
credentials are never in a backup; that runbook rebuilds them from the password manager.

## 4. Alerts (Story 8.3, AD-27)

### 4.1 How an alert travels

Code raises `alert(kind, severity)`; the operations module stores it. Cooldowns: **critical 5
minutes, high 15, warning 30**. A repeat of the same kind and severity inside the cooldown:

- while the last alert still waits or is being sent, is counted on it;
- once the last alert was sent, becomes a new alert held until the cooldown ends, and later
  repeats are counted on that one; it then goes out once with the repeat count, so a second
  outage inside the cooldown is never lost;
- after an alert given up as `FAILED` (or skipped as `EXPIRED`), goes out at once.

The delivery job sends due alerts to the Telegram chat every 30 seconds, at most 10 per run,
outside any transaction. A pending alert raised more than 24 hours ago (a first deploy, a long
Telegram outage) is marked `EXPIRED`, never sent, and counted in one log line
`operations.alert.older_alerts_skipped`. A failed send goes back to pending and is retried on the
next run, up to 5 attempts; each failure is the log line `operations.alert.delivery_failed`
(alert id and kind only). The
message is the Vietnamese text of `packages/labels/vi/alerts.json`: severity word, what happened,
and the repeat count. It never carries a name, phone number, bank number, customer code or token.

A start refused at its pre-migration backup cannot wait for the delivery job, so that alert is
sent at once before the process exits.

### 4.2 The one health model

The health check reads the same model the Overview health line shows, every minute, and raises
the alert of a part when it goes down, or when it stays down for a new reason (a backup whose
off-site copy failed now failing locally; a captcha hold turning into a lost login). While a part
stays down for the same reason nothing more is raised.

| Part | Down when | Alert |
| --- | --- | --- |
| Bridge | the Shopee link queue is paused (login lost) or held (captcha, page error) | `bridge_login_lost`, `bridge_captcha` or `bridge_page_error` |
| Assistant | no heartbeat with the Zalo session connected for 5 minutes | `assistant_down` |
| Reconciliation | a network's hourly run has not succeeded for 3 hours | `reconciliation_failed` |
| Backup | the last run failed, or no good copy for 26 hours | `backup_failed` or `backup_offsite_failed` |
| Queue | a link request that is due (not in a retry wait) on a network whose queue is open has waited more than 10 minutes; a paused or held Shopee queue is the bridge part's. The line shows how many requests wait | `link_queue_stuck` |
| Drill (state `due`, not down) | no restore drill recorded, the last one failed, or it is more than a quarter (92 days) old; the line reads "đến hạn" (due) | `restore_drill_due` |

The drill is never "down": it has its own state `due` (a reminder, shown in warning colours). While
no part is down the server also pings the external heartbeat every 5 minutes (Story 8.4,
`production-host-runbook.md`); any part down stops the pings, so the checker outside the VPS
alerts too. A `due` drill never stops them.

The bridge does not report its own liveness, so while the queue is open it shows "chưa rõ" (not
known yet), never "ổn".

### 4.3 Alert kinds

Every kind the server raises; a test checks this table against the code.

| Kind | Severity | What happened | What the owner does |
| --- | --- | --- | --- |
| `assistant_down` | critical | the Zalo assistant has had no connected session for 5 minutes | open the assistant window on the VPS; scan the QR code with the bot account's phone if Zalo asks |
| `assistant_session_conflict` | critical | another login took the assistant's Zalo account (the old bot left running, Zalo Web); the assistant stopped reconnecting | stop the other session, then restart the assistant (`shadow-run.md#zalo-account-at-cutover`) |
| `bridge_login_lost` | critical | the affiliate browser was signed out of Shopee; the link queue is paused | sign in again, then resume the queue (`bridge-runbook.md#sign-in-again`) |
| `bridge_captcha` | high | Shopee showed a captcha; the queue is held for a while | clear the verification in the affiliate Edge (`bridge-runbook.md#clear-the-verification`) |
| `backup_failed` | high | the daily backup failed a step or was missed for 26 hours | section 2.3 |
| `backup_offsite_failed` | high | the encrypted copy did not reach Google Drive; the local copy is kept | section 2.3 |
| `reconciliation_failed` | high | reconciliation failed twice in a row, or has not succeeded for 3 hours | check the affiliate browser and the AccessTrade key, then let the next hourly run go |
| `reconciliation_page_cap` | high | a report needed more pages than the safe cap | read the report window by hand; never page further in the browser |
| `reconciliation_source_stale` | high | the report source returned old data | check the saved report or the bridge source |
| `order_reversed` | high | an approved order was cancelled by the network; a review case is open | work the review case on the desk |
| `notification_daily_cap` | high | the daily Zalo send cap was reached; the rest waits for tomorrow | nothing, unless it repeats daily (then review the cap) |
| `customer_sign_in_burst` | high | many failed website sign-ins in a short time | watch the desk; nothing to do unless it repeats |
| `web_link_safety_cap` | high | the website hit its hourly link safety cap | check for abuse; links resume next hour |
| `shopee_payout_record_unreadable` | high | the Shopee payout page changed shape and cannot be read | report it for a fix; enter the payout by hand meanwhile |
| `bridge_page_error` | warning | a Shopee page error while making a link; the queue is held | nothing unless it repeats; then restart the bridge tab |
| `bridge_short_link_unresolved` | warning | a customer's short link could not be opened | nothing; the customer gets the failure message |
| `link_queue_stuck` | warning | a due link request on an open queue has waited over 10 minutes | check the link job and the bridge in the server log |
| `link_undeliverable` | warning | a link could not be handed to the customer after its tries | nothing unless it repeats |
| `notification_undeliverable` | warning | a Zalo message could not be delivered | nothing unless it repeats |
| `shopee_payout_record_failed` | warning | the Shopee payout page could not be read this time | nothing; the job tries again next hour |
| `shopee_payout_record_unavailable` | warning | the Shopee payout page has no data yet | nothing |
| `shopee_payout_status_refused` | warning | the payout page showed a batch with a status the server does not know (logged as `payouts.payout_record.unknown_status` with its id and code), or a status the recording refused to move back | report it; that batch was skipped, the other batches were recorded |
| `restore_drill_due` | warning | the quarterly restore drill is due (none recorded, the last failed, or older than 92 days) | run the drill of `restore-runbook.md` and record it |

A new kind needs a line in `packages/labels/vi/alerts.json` and a row here; the tests fail until
both exist.
