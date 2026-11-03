# Restore runbook

How to bring the ledger and the proof images back from the encrypted backup on Google Drive, on
the production VPS or on a new machine, and the quarterly drill that proves it works (Story 8.6;
AD-26, FR-32, D36). The backups themselves are in `backup-and-alerts-runbook.md`.

A drill runs **at cutover** and **once a quarter**. The Overview health line shows "Diễn tập khôi
phục: đến hạn" and Telegram gets `restore_drill_due` once when no drill is recorded, the last one
failed, or it is more than 92 days old.

## 1. What you need

Production copies come in one of two forms (`backup-and-alerts-runbook.md` section 1):
`cashback-prod-<date>-<HHMM>.tar.enc` from the Google Drive webhook (production since the owner's
decision of 2026-11-03), or `<instant>-daily.tar.age` from age and rclone. A local
`<instant>-daily.tar` in `data\prod\backups\daily\` is not encrypted and restores as it is.

From the password manager, never from a backup (secrets are never in one):

- for a `.tar.enc` copy: the entry "cashback backup encryption key", the value of
  `BACKUP_ENCRYPTION_KEY` (44 base64 characters). Without it no `.tar.enc` copy can be read;
- for a `.age` copy: the age private key file `cashback-backup-key.txt` (its public key is
  `BACKUP_AGE_RECIPIENT`);
- the Google account of the Drive folder, to download the copy (the Drive web page, or rclone);
- for a real restore of production only: every value of `prod.env`, the cloudflared tunnel token,
  the Shopee Affiliate sign-in and the Zalo bot account's phone.

On the machine: the repository built (`production-host-runbook.md` section 2.1), `age` and
`rclone` only for a `.age` copy, and the env file of the environment you restore into (`prod.env` for production,
`dev.env` for a drill on a dev machine).

## 2. Restore steps, in this order

Write down the start time first; the drill log needs the duration.

1. **Stop the server.** Production: `.\ops\windows\stop.ps1` (it also disables the tasks, so
   nothing starts the server during the restore). Dev: `pnpm --filter @cashback/server dev:stop`.
   Check with `pnpm --filter @cashback/server host status --env prod`: no role `running`.
2. **Delete the `-wal` and `-shm` files** beside the ledger, so no newer write-ahead frames replay
   over the restored file:

   ```powershell
   Get-ChildItem C:\Project\cashback\data\prod\ledger.sqlite-*
   Remove-Item C:\Project\cashback\data\prod\ledger.sqlite-wal, C:\Project\cashback\data\prod\ledger.sqlite-shm -ErrorAction SilentlyContinue
   ```

   The restore command checks for them first and refuses (`side_files_present`) while
   `ledger.sqlite-wal`, `ledger.sqlite-shm` or `ledger.sqlite-journal` exists. The old
   `ledger.sqlite` itself is kept: the command moves it aside.
3. **Download the newest copy** from Google Drive.
   - `.tar.enc` (Drive webhook): open drive.google.com with the owner's account, open the Apps
     Script's backup folder, sort by name or by "Last modified", right-click the newest
     `cashback-prod-<date>-<HHMM>.tar.enc` and choose Download; move it to `C:\restore\`. When the
     same name is there twice (a retried upload), either file will do: the restore checks it.
   - `.tar.age` (age and rclone):

     ```powershell
     rclone lsf gdrive:cashback-backups/prod
     rclone copy gdrive:cashback-backups/prod/<name>-daily.tar.age C:\restore\
     ```

4. **Decrypt.**
   - `.tar.enc`: nothing to do by hand; the restore command decrypts it (step 5). The key comes
     from `BACKUP_ENCRYPTION_KEY` in the env file of `--env`, or from `--key-file <file>`: a text
     file holding only the key, pasted from the password manager (on a dev machine, where `dev.env`
     must not hold production's key). Delete that file after the restore. A wrong key or a damaged
     download is refused as `decrypt_failed`; nothing is written.
   - `.tar.age`: decrypt with the private key, then delete the key file from this machine:

     ```powershell
     age --decrypt -i cashback-backup-key.txt -o C:\restore\backup.tar C:\restore\<name>-daily.tar.age
     ```

5. **Restore**, from the repository folder:

   ```powershell
   pnpm --filter @cashback/server restore:ledger -- --env prod --archive C:\restore\cashback-prod-<date>-<HHMM>.tar.enc --replace
   pnpm --filter @cashback/server restore:ledger -- --env dev --archive C:\restore\cashback-prod-<date>-<HHMM>.tar.enc --key-file C:\restore\key.txt
   pnpm --filter @cashback/server restore:ledger -- --env prod --archive C:\restore\backup.tar --replace
   ```

   (The first line restores production from a Drive webhook copy, the second is a drill on a dev
   machine, the third restores a decrypted age copy or a local archive. Leave out `--replace` when
   the data folder has no ledger.) The decrypted archive exists only inside the command's work
   folder and is deleted when it ends.
   The command takes the server lock (a running server refuses it), extracts the archive inside
   the data folder, and checks the ledger's SHA-256, `integrity_check`, every table's row count
   and the balance totals (customers, gross, payable, waiting, paid, deducted next) against the
   manifest written when the backup was taken. Only when all agree does it move the ledger and
   `files\` into place (the old ones to `*.before-restore-<time>`) and run `integrity_check` again.
   It prints one line, `platform.restore.done` with the totals, or `platform.restore.refused` with
   the reason:

   | Reason | What to do |
   | --- | --- |
   | `server_running` | step 1 again; `status.ps1` must show nothing running |
   | `side_files_present` | step 2 again for the files it names |
   | `ledger_exists` | add `--replace` (the old ledger is moved aside, not deleted) |
   | `archive_unreadable`, `no_manifest` | the wrong file or a broken download: step 3 again, or the previous day's archive |
   | `key_missing` | a `.tar.enc` copy and no valid key: set `BACKUP_ENCRYPTION_KEY` or pass `--key-file` |
   | `decrypt_failed` | the wrong key (an older key, if it was ever changed) or a damaged download: check the key, download again |
   | `age_encrypted` | a `.age` copy: decrypt it with age first (step 4) |
   | `ledger_hash_differs`, `integrity_failed`, `row_counts_differ`, `balances_differ` | this archive is not trustworthy: take the previous day's archive and start again at step 3; report it |
   | `balances_unreadable` | the archive is older than the code's schema: restore it with the commit of its date, or take a newer archive |
   | `platform.restore.rolled_back` (`integrity_failed` or `place_failed` after the swap) | nothing was lost: the previous ledger and `files\` are back under their own names (`rolledBack.putBack`), the restored copies kept as `*.failed-restore-<time>` (`rolledBack.failed`). If `rolledBack.complete` is false, do each move in `rolledBack.stuck` by hand before starting. Then take the previous day's archive |

6. **Start the server.** Production: `.\ops\windows\start.ps1`. Dev:
   `pnpm --filter @cashback/server dev:start`. A start that has migrations to apply takes its own
   checked backup first (AD-26).
7. **Check**: the Overview opens; the Payouts total to pay equals `totals.payable` from step 5;
   three customers' balances on the desk equal what they were at backup time.
8. **Real restore on a new machine only: rebuild what is never backed up**, from the password
   manager: `prod.env` (`production-host-runbook.md` section 2.2; `BACKUP_ENCRYPTION_KEY`,
   `GDRIVE_WEBHOOK_URL` and `GDRIVE_SECRET_TOKEN` included, so the next daily copy goes to Drive),
   `rclone.conf` when age and rclone are used
   (`rclone config reconnect gdrive:`), the cloudflared service (`cloudflared service install
   <tunnel token>`), the affiliate Edge sign-in (section 2.4 there) and the Zalo session (scan the
   QR code with the bot account's phone). Then the go-live checklist of that runbook, section 9.
9. **Record the drill** (also after a real restore), on the production VPS, so production's
   Overview knows:

   ```powershell
   pnpm --filter @cashback/server restore:drill-record -- --env prod --at 2026-11-05T02:00:00.000Z --minutes 47 --result pass --archive <name>-daily.tar
   ```

   It prints the row for the log below; add it with the machine and anything that went wrong.

**After a drill on a dev machine**: the dev ledger now holds production's customers. Stop the dev
server and delete `data\dev\ledger.sqlite`, `data\dev\files\` and `C:\restore\` the same day. Dev
runs the fake Zalo client and the fake bridge, so the drill never messages a customer or touches
the affiliate account.

## 3. Drill log

One row per drill, newest last. Result is `pass` only when step 5 printed `platform.restore.done`
and step 7's checks agreed.

| Date | Duration | Result | Archive | Machine and notes |
| --- | --- | --- | --- | --- |
| 2026-11-03 | 5 min | pass | 2026-11-03T01-12-34.567Z-daily.tar | Operator dev machine, `--env dev`, the `.tar.enc` form of the Drive copy with `--key-file`; 23 customers, totals matched the manifest; dev data deleted afterwards |
