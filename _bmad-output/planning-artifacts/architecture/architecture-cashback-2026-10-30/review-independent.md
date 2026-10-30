---
title: Independent architecture review — Cashback Platform spine
reviewed: ARCHITECTURE-SPINE.md (AD-1..AD-27), diagrams/, stride.md, SECURITY_MODEL.md, docs/rules/code.md
against: prd.md (FR-1..FR-38), list-defects.md, status-flows.md, domain-model.json (D1..D37), CLAUDE.md money rules, EXPERIENCE.md, v1-handover.vi.md, live code on main-v2 (src/cashback/shopee/*)
date: 2026-10-30
verdict: ready with fixes
---

# Independent architecture review

## Verdict

**Ready with fixes.** The overall shape fits: one Node writer over SQLite, a pure transition
function, one money package, one balance query, a claim plus snapshot for payouts, and an outbox.
Each of these answers a real defect in the live system. Three critical findings and eleven high
findings must still be fixed in the spine (or in status-flows.md) before stories are written for
reconciliation, payouts or cutover. Most of the criticals come from the gap between the model and
how the operator actually works: he transfers money *before* he confirms, the Shopee report really
says `UNPAID`, and a rollback really happens after payouts have been made in the new system.

Severity: **critical** means a path to wrong money or a lost Zalo/Shopee account. **High** means
likely to cause wrong money, an outage or a security breach in the first months. **Medium** means
it will cost a rework or an incident. **Low** means hygiene.

---

## 1. Coverage

### 1.1 FR coverage

Every FR from FR-1 to FR-38 except FR-28 (withdrawn, D29) appears in `binds` and in the capability
map. Where an FR has a mapping but no architectural mechanism:

| FR / rule | Gap | Severity |
|---|---|---|
| FR-23 campaigns | The map gives only "AD-1, AD-11". No AD covers slot allocation (earliest `recorded_at`), re-evaluation when an order is cancelled, how a slot passes on while the campaign runs, how the campaign closes (D22: a job or derived state?), or the offer line in link replies. Campaign bonuses are money (they are in `getBalances`). | medium (M14) |
| FR-10 bank hold | AD-23 does not model the website-change hold or the 72-hour flag, and AD-9 confirm does not re-check either one. | medium (M8) |
| FR-18 proof image | Nothing says where proof images are stored or whether they are backed up. D36 says Google Drive is "already used for payout proofs". | medium (M12) |
| FR-19 settlement | `network_settlements` has an owner, but no source is defined: is it entered by hand, imported, or read from a report? | low (L9) |
| FR-27 metrics, FR-31 fraud flags | Mapped to operations with no definition of the computation. FR-27 rates are money ratios. | low (L9) — candidates to defer |
| FR-36 Zalo account loss | How merge proposals are produced after an account change (which pairs, on what evidence) is not specified. | low |
| FR-12 read window | No AD says which period each run reads. This decides whether a 30-to-70-day approval is ever seen (see H4). | high (H4) |

### 1.2 Decisions D1–D37

D1–D32 each have a home (AD-5, AD-6, AD-7, AD-9, AD-14, AD-23 and others). Gaps and mismatches:

- **D7 regressed by AD-14.** See H1: batches of five links lose sub_id2.
- **D22.** No closing mechanism is defined (M14).
- **D33.** Matches AD-2 but is not cited.
- **D34.** Matches AD-5 but is not cited.
- **D35 (a clawback also recovers a paid bonus) is missing.** AD-6 and status-flows §2 say the
  clawback is "of the cashback amount" (H3).
- **D36.** It names Google Drive and an Access allow-list kept outside the repository. The spine and
  `c4-deployment.md` still say "rclone remote chosen by the owner" (L4).
- **D37 is contradicted by the spine.** The Deferred section says a second Zalo account is "the
  owner's call". `SECURITY_MODEL.md` says "Accepted risk: none recorded" and `stride.md` says
  "owner to accept", but D37 already accepts machine loss under full-disk encryption (L4).

### 1.3 status-flows.md rules

- **R1.** Covered by AD-6.
- **R2.** Covered by AD-9.
- **R3.** Covered by AD-7.
- **R4.** Covered by AD-8 (fingerprint).
- **R5 (aging at 14 and 60 days).** No AD stores a "last seen in report" time or computes the aging.
  It only works if the read window covers old awaiting orders (H4).
- **R6 and page cap.** These contradict each other (M4).
- **§3 `CONVERTED`.** It is set by an orders observation on a linking-owned table. This must be a
  linking event handler under AD-4. Implied, not stated.
- **§6 review case.** A review case "opened by a cancel signal on an approved or paid order" is not
  in AD-7's effects.
- **§8 `LOCKED`.** This is a timed status. Derive it from `locked_until`; do not store it (L6).

---

## 2. Money correctness

### C1 — critical: `UNPAID` is listed as a cancel signal, but Shopee's `UNPAID` means "buyer has not paid yet"

The cancel-signal rule in status-flows.md §1 (adopted by AD-7 and D31) says: "order-level status
cancelled, invalid, fraud, **unpaid** or closed". In the real Shopee report,
`order_status` is `PAID`/`UNPAID` and describes the buyer's payment. The live reader deliberately
maps `"unpaid": "awaiting"` (`src/cashback/shopee/report_reader.py`, STATUS_MAP and its comment). A
just-placed or COD order arrives as `UNPAID`. Under the new rules it goes to `REJECTED`, which has
no exit in the transition table. The customer permanently loses cashback on a normal order and is
told "Không được duyệt".

**Fix:** remove "unpaid" from the generic cancel list. Cancel signals become an explicit per-network
status map in each adapter (AD-22). Start from the live `STATUS_MAP` and cover it with golden
fixtures made from real report rows, including unpaid, completed and validated rows. Add a
staff-only `REJECTED → AWAITING_APPROVAL` review path for wrongly rejected orders that are still
unpaid, through `transition()`.

### C2 — critical: the operator transfers before confirming, and AD-9 can refuse to record a transfer that already happened

The flow in `c4-dynamic.md` §3 is: preview, then the bank transfer (step 5), then confirm. AD-9 makes
confirm write nothing in three cases:

- a covered order was reversed in between,
- the claim expired after 10 minutes idle (the operator spent time in the banking app with OTP),
- the confirm request is retried after the claim was deleted.

In each case the money has left the bank but the ledger shows it as unpaid. The next claim shows
the same payable amount, so a second transfer is the natural next action. This is the live
double-pay pattern in a new form. status-flows already guards `APPROVED → REVERSED` with
"not in a payout being confirmed". AD-9 reads that guard as "serialization is enough", and it is not.

**Fix:**

1. Orders covered by a live claim are protected. Reconciliation records the cancel observation but
   does not apply it and does not store the fingerprint (so AD-8 does not skip it later). After the
   claim ends, the next run applies it. If the order is PAID by then, the result is a clawback.
2. Keep `payout_claims` rows with statuses OPEN, CONFIRMED and ABANDONED, and a `qr_shown_at`. Do not
   delete them.
3. Confirm on an expired claim succeeds when no other claim exists and every covered order is still
   APPROVED and unpaid.
4. Confirm is idempotent by claim id: a retry returns the same payout.
5. Opening a customer whose last claim was ABANDONED after the QR was shown shows "Minh may have
   transferred 79.216đ at 19:42 — check the bank before paying".
6. Use a unique transfer reference per claim (customer code plus a short claim id) so the bank
   statement can be matched.

### C3 — critical: cutover rollback reopens double payment (AD-24)

AD-24's rollback is "switch the tunnel back to the live system and restart it". Anything the new
system recorded after go-live is missing from the live database: payouts, `paid_at`, new
customers, link requests and share codes. After a rollback, live shows those orders as unpaid again,
and its payments screen (which already pays anything listed, list-defects "Payments") invites a
second transfer. Customers registered after go-live become unattributable, and their `/s/<code>`
links return 404.

**Fix:** choose one of the following and rehearse it:

- **(a)** A go/no-go window (for example 72 hours) during which the new system records no payouts.
  Rollback is only allowed inside that window.
- **(b)** A rehearsed `cutover/rollback` command that writes the new system's payouts, `paid_at`,
  customers, aliases, link requests and share codes back into the live schema.

Option (a) is simpler and enough for one operator.

### H2 — high: payout void can make a cancelled order payable

AD-9 and FR-34 say void returns covered orders "from paid to approved". If an order was cancelled
after the payout (it is PAID with a clawback), void returns it to APPROVED, and it is payable again
even though the network cancelled it. Void must also reopen clawbacks that the payout netted, and
handle bonuses that are PAID.

**Fix:** void sets each order to the state `transition()` gives from the latest observation:

- REVERSED if a cancel was seen, otherwise APPROVED;
- the clawback for that order is closed by an offsetting entry;
- netting entries written by the voided payout are reversed;
- awards go back to CONFIRMED, or to VOID if their order is now REVERSED.

Golden-test all four combinations.

### H3 — high: the clawback model is under-specified and contradicts AD-17

- AD-17 makes `ledger_entries` insert-only (triggers reject UPDATE). AD-6 says a clawback is "open
  until netted or written off", and AD-23 says merge "moves ... ledger entries". Neither can be done
  with insert-only rows as described.
- Partial netting is undefined. Example: a clawback of 50,000 against a payable of 30,000.
- With the 0 floor, a customer whose clawbacks are at least their approved cashback has a payable of
  0. They never show in the payable list, their APPROVED orders stay unpaid forever, and the
  clawback never closes. AD-16 also refuses 0-dong payout messages, which implies 0-dong payouts
  exist, but nothing defines them.
- D35 (recover the bonus too) is missing.

**Fix:**

- A clawback's open amount is `Σ entries` for that clawback id: the negative original plus positive
  netting and write-off entries, all insert-only.
- Confirm nets up to the gross payable and carries the rest forward.
- A netting-only payout (transfer 0) is allowed: it marks the orders PAID, writes no message and has
  no QR.
- The clawback amount is the stored cashback plus any PAID bonus on that order (D35).
- Merge re-points nothing: `ledger_entries` keep the old customer id and balances resolve through
  aliases, or merge writes a transfer pair of entries.

### H5 — high: cutover parity is measured against the live system's own (buggy) queries, and imports live defects as payable

AD-24 asks payable, waiting and paid amounts "computed by the live system's own queries" to match
`getBalances` to the dong. There are three of them:

- The live system has three definitions of "ready" (D27; list-defects "Customers", "Customer site").
- The customer site applies the Shopee fee to TikTok.
- Live statuses carry the first-item-only bug (D31), so some live "approved" or "awaiting" orders
  are really cancelled.

Importing statuses as they are makes those orders payable in the new system, which is exactly the
"pay a cancelled order" defect.

**Fix:**

- **Paid totals:** parity to the dong.
- **Payable and waiting:** a shadow run of the new reconciliation on the rehearsal copy, over the
  full report window. It produces a per-order diff (expected transitions), and the owner signs it
  off.
- Unresolved orders older than the report can verify go to FROZEN with a review case, not APPROVED.
- Define "live payable" as one named SQL in the cutover tool, not "the live system's queries".

### H1 — high: batches of five links lose sub_id2 and match links by position (AD-14 vs live practice)

AD-14 sends "one customer per batch of up to 5 links sharing that customer's sub_id1". The live
code chose one link per submission on purpose (`src/cashback/shopee/page_selectors.py`,
`LINKS_PER_SUBMIT = 1`). The reasons are given there:

- sub_id cannot vary within a submission, so sub_id2 (the request) is lost;
- links come back matched only by position.

The cost:

- FR-12's third attribution step (sub_id2 owner) stops working for batched links.
- Links can be handed to the wrong request (wrong product, wrong share page, wrong reuse key).

**Fix:** one link per submission, with both sub_id1 and sub_id2. Keep "one customer per bridge job"
as the invariant. This also deletes the batch-splitting code.

### H4 — high: reconciliation read window and page cap do not fit 30 orders a day

The spine reads "the overlapping period" hourly and fails the run at a page cap or the 90-day edge.
The window is not defined. Shopee validates commissions monthly, 30 to 70 days after purchase, so
the window must reach back to the oldest unresolved order. At 30 orders a day that is about 2,700
rows over 90 days. The live cap is 20 pages × 50 = 1,000 rows (`report_reader.py` `MAX_PAGES = 20`).

So either every hourly run fails loudly, and nobody is ever approved, or the bridge pages about 55
report pages every hour through the real session. That is the captcha risk D8 exists to avoid.

**Fix:**

- **Hourly:** the last 7 days by purchase time.
- **Nightly:** a paced sweep over every calendar day that still holds an AWAITING order or an
  APPROVED unpaid order, in day slices, with a cap per slice.
- Store `last_seen_in_report_at` per order, for R5.
- Bridge report jobs yield to link jobs between pages (AD-14 already orders them).

### H6 — high: cutover timestamp normalisation needs per-column provenance

AD-24 says "every time is converted; what cannot be converted is listed". Live naive timestamps are
not ambiguous by format, they are ambiguous by column:

- `CURRENT_TIMESTAMP` columns are naive UTC.
- Campaign start and end were typed in Vietnam time and stored without a zone (list-defects
  "Campaigns").
- Order dates may be fabricated from the order SN prefix at `00:00+07:00`
  (`ledger/repository.py` normaliser).

A single rule converts the campaign windows (and so slot ranking, and so bonus money) 7 hours
wrong, without any error.

**Fix:** a per-column conversion table in `cutover/` (column, source zone, fallback flag), each
entry with a fixture test. Imported synthesized dates are flagged as `approximate`.

### H7 — high: the first post-cutover reconciliation can burst messages to every customer

The outbox dedup keys are new. Imported orders have no stored fingerprint, so the first run
re-applies every order. The new cancel rules (D31) also move many imported orders (approved to
REVERSED, awaiting to REJECTED). Without seeding, every "recorded", "approved" and "cancelled"
notification can fire at once. That is a bulk send on the personal Zalo account (D9, FR-22): an
account lock on day one.

**Fix:**

- The import seeds a dedup key as already sent for every (entity, event) the live system already
  notified.
- The first live run is "apply, no messages" and reports the would-be sends.
- The pacer gets a hard daily cap on proactive sends, with an owner alert when it is reached.

### Medium money findings

- **M1 — Withheld tax is known only after approval.** The withheld rule (FR-13 step 3) depends on a
  payout of 2,000,000 dong or more per period. At 30 orders a day that is the norm, but staff mark it
  only when Shopee pays, after approval. Cashback is stored once at approval (AD-5) using "the setting
  in force", so almost every Shopee order is computed as not withheld and the operator absorbs 10%.
  **Fix:** the owner decides on a default of withheld for Shopee periods, with staff unmarking a
  period. Record it as a decision.
- **M2 — A commission that drops after approval is undefined.** A partial refund after approval
  leaves a lower but nonzero commission. AD-5 never recomputes, and status-flows has no transition
  for it. **Fix:** treat it as a review case (a FROZEN-like hold for an APPROVED unpaid order), and
  as a partial clawback for PAID orders.
- **M3 — FROZEN voids the campaign award permanently.** status-flows §5 voids the award when the
  order becomes FROZEN, and the slot moves on. A transient unknown status string then costs the
  customer the bonus. **Fix:** FROZEN suspends the award; only REJECTED or REVERSED voids it.
- **M5 — Review apply could become manual attribution.** FR-14 shows "the candidate customer". The
  architecture must say where the candidate comes from (alias, sub_id2 owner, merge survivor) and
  that staff cannot choose another customer. When sub_id1 and the sub_id2 owner disagree, open a
  review case; do not let sub_id1 win silently.
- **M8 — Confirm does not re-check bank state.** Confirm does not re-check the bank hold (FR-10,
  FR-17) or the account. **Fix:** put the bank account fingerprint and the hold flag in the snapshot
  hash.
- **Money outside `packages/money`.** The Shopee report scales amounts by 1,000 or 100,000 and the
  live code rounds with Python `round()` (`report_reader.py` `_money`). In the new design that
  conversion would sit in the linking adapter. **Fix:** `packages/money` exports
  `fromNetworkUnits(value, scale)` with half-up rounding and golden fixtures. Also state that
  `SUM()` over stored integer columns is allowed in list summaries, while any other arithmetic in
  SQL is not (code.md §4 says "SQL ... never compute it"). Define the Overview operator figures
  ("what we keep", "networks still owe us") as payouts queries over stored columns.
- **M17 — The customer balance card has no clawback line.** The payable figure in AD-6 is net of
  clawbacks, but the card in EXPERIENCE.md shows only three figures. So the order rows do not add up
  to the card, and the customer cannot see why. **Fix:** add a server-supplied
  "trừ vào lần chuyển sau" (deducted at the next payout) line whenever open clawbacks exist.

### What holds

- Concurrency between reconciliation and confirm is correct at the database level. Both run
  `BEGIN IMMEDIATE` in one process, and better-sqlite3 is synchronous, so they cannot interleave.
  The flaw is at the human level (C2).
- HOUSE is handled at four layers: money returns 0, `getBalances` excludes it, `enqueue` refuses
  it, and review apply cannot move it.
- A browser-supplied amount is impossible (INV-4).
- An awaiting order is never shown as owed, provided C1 and H5 are fixed.

---

## 3. Simplicity and fit for one operator

**Moving parts:**

- 4 host processes (server, assistant, cloudflared, Chrome) — the same as live, which is fine.
- 3 listeners and 2 tokens.
- 5 jobs.
- 7 packages and 5 apps.
- 7 modules × 4 layers.
- About 33 tables, plus `job_leases` and `job_runs`.

For about 30 orders a day and one developer, the module split is justified because it follows the
contexts. The layering and package count are not.

**Over-engineered:**

- **S1 — Layers and packages.** Four hexagonal layers per module, where nearly every port has a
  single adapter, is ceremony. **Fix:** `domain/` (pure) plus module code (commands, queries,
  repositories) plus `http/`. Merge `packages/time`, `packages/text` and `packages/domain` into one
  `packages/core`, and keep `packages/money` separate because it is the money boundary.
- **S2 — `job_leases` with a holder PID in a single process.** It does not protect against the real
  hazard (two machines with two database copies), and PID reuse after a reboot causes false
  refusals. **Fix:** an OS lock file on `data/prod/`, an in-memory "running" flag per job, and job
  outcomes as log lines. Keep `reconciliation_runs` because it is business data.
- **S3 — The assistant's loopback `/notify` listener (B4).** It is a second token boundary, and the
  assistant has no storage to remember "ids it has not sent" (M9). **Fix:** the assistant pulls due
  notifications from `/internal/notifications/next` and acknowledges each one. This removes the 8082
  listener and the push retry logic. Accept at-least-once delivery with a small local sent-ids file.
- **S4 — Manual monthly restore drill on a scratch machine.** It will not happen with one operator.
  **Fix:** the backup job restores each encrypted backup into a temporary file, runs
  `integrity_check` and row counts against the live database, and alerts on any difference. Do a
  manual drill once at cutover and once a quarter.

**Under-specified and will bite:**

- **H10 — high: no external dead-man alert.** All alerts (FR-30) are sent by the same Mac. Power
  loss, sleep, an ISP outage, or a FileVault pre-boot screen after a reboot (D37 full-disk
  encryption) all mean total silence. In the FileVault case nothing restarts until someone types the
  password at the machine. **Fix:**
  - an external heartbeat checker (healthchecks.io free tier, or a Cloudflare Worker cron that
    alerts Telegram when the server misses pings);
  - `pmset` settings for no sleep and restart after power failure;
  - a UPS if possible;
  - a runbook step for the FileVault reboot;
  - a launchd LaunchAgent for Chrome in the logged-in GUI session.
- **M7 — Migration is gated on the off-site copy.** AD-26 refuses to migrate if the backup fails,
  and the backup includes the rclone copy. No internet at restart then means no server. **Fix:** a
  local backup plus `integrity_check` gates migration; the off-site copy runs afterwards and alerts
  on failure.
- **M12 — Backup scope.** Proof images, the secrets file and the cloudflared credentials are
  outside the backup. **Fix:** state what is restored from backup and what is rebuilt by hand. Store
  proof images in the database or in a backed-up `files/` directory.
- **Shopee session loss.** AD-14 alerts on captcha. A logged-out affiliate session (cookie expiry)
  needs its own detection (the custom-link page redirects to login), an alert, and a runbook step.
  Remote re-login when the operator is away is not addressed.
- **M9 — duplicate notifications.** Covered under S3.

---

## 4. SQLite single writer

**Writers accounted for:**

- server HTTP commands;
- in-process jobs: links, notify, health, reconcile, backup (reads only);
- event handlers inside the publisher's transaction;
- startup migrations;
- the cutover tool, which writes a different file;
- the assistant and the bridge, which reach the ledger only through HTTP.

None missing. Ad-hoc operator inspection with `sqlite3` on the production file should be documented
as read-only (`-readonly`). Admin fixes (merge, write-off, re-run) are admin-desk commands, never
scripts.

- **M6 — medium: the transaction helper must be synchronous.** A better-sqlite3 `transaction()`
  given an async function commits when the promise is returned, not when it resolves. The code then
  runs outside the transaction while it appears to be inside. **Fix:** `platform/db.tx(fn)` throws
  if `fn` returns a thenable. Add a lint rule: no `async` callback passed to `tx`.
- **busy_timeout.** `busy_timeout = 5000` with one retry is harmless, but in one process the only
  contention is the backup step and external readers. A busy wait blocks the event loop and so the
  bridge long-poll. 1,000 ms is enough.
- **Migrations.** Backup first (AD-13, AD-26) is right. Add: migrations are forward-only, each one is
  tested on the latest production backup copy in CI or before deploy, and a failed migration
  restores the pre-migration copy automatically.
- **Restore steps.** Stop the server. Delete `-wal` and `-shm` with the file. Put the restored file
  in place. Run `integrity_check`. Start. Put this in the runbook.

---

## 5. Cutover (FR-33, AD-24)

The import design (read-only copy, ids kept, no recomputation of stored amounts, D34) is right.
Problems:

- **C3 — Rollback double pay.** See §2.
- **H5 — Parity definition and imported live defects.** See §2.
- **H6 — Per-column time conversion.** See §2.
- **H7 — Message burst on the first run.** See §2.
- **Each live order becomes one order with one item.** The first new report then shows N items,
  with a new fingerprint, and the item-level rules (R3) apply to an order whose stored cashback came
  from the old formula. **Fix:** on first observation of an imported order, store the items but do
  not recompute stored amounts. Only a cancel signal changes it.
- **L1 — Share code length.** Live share codes are 8 characters (`ledger/share_links.py`
  `CODE_LENGTH = 8`); AD-14 and stride say 10. The share-code validator must accept both, or old
  links return 404 (FR-33 "old share links keep working").
- **L7 — Two bridges.** The old extension must be removed from the affiliate Chrome profile at
  cutover, or two bridges poll and both drive the page.
- **In-flight state.** QUEUED live link requests and unsent live notifications at stop time must be
  either imported or listed in the import report. The procedure must also stop the live assistant
  before the new one signs in (one Zalo session).

**Day-one sequence to add to AD-24:**

1. shadow reconciliation diff signed off;
2. secrets rotated;
3. live stopped (including the assistant and the old extension);
4. backup;
5. import with seeded dedup keys;
6. parity;
7. first reconciliation run in no-message mode;
8. tunnel switch;
9. no payouts until go/no-go;
10. watch the pacer counters.

---

## 6. Delivery: building it incrementally

The spine has no build order and no walking skeleton. Cutover is big-bang (two databases, one Zalo
session), so the minimum cutover set is what bounds v1.

**Walking skeleton (thin slices, each deployable to dev):**

1. `packages/money` and `packages/core` (time, status registry) with golden tests. Include the
   C1 status map fixtures and the scaled-unit conversion.
2. The cutover import and the shadow reconciliation against a copy of the live database, read-only,
   running beside live. This de-risks H4, H5, H6 and C1 first, using real data.
3. Server skeleton: the `platform/db` transaction helper, config, the two listeners, one module
   (orders) with `transition()`, `getBalances`, and a bare admin Payouts screen with claim, confirm
   and void. This covers the whole money path.
4. Linking, the bridge (one link per submission), the assistant with the pull outbox, the share page.
5. Customer website: sign in, My money, Account.
6. Backups, alerts, the external heartbeat, the cutover rehearsal.

**Cut or defer from v1 without breaking money rules:**

- FR-27 metrics.
- FR-31 fraud flags, except the shared-bank-account flag.
- FR-19 settlement screen.
- The campaign *creation* UI (FR-23). Imported awards are still honoured by `getBalances`. If a
  campaign must run at cutover, create it with an admin command.
- The merge UI (FR-11). Use an admin command with preview and apply, as live does; it is needed only
  when the Zalo account changes.
- The staff management UI (FR-24). Seed staff.
- The audit trail screen, and the products and link-request lists beyond a basic DataList.
- The Guide page redesign.

None of these are on the pay, attribute or reconcile path.

---

## 7. Security

What the model already gets right: tokens instead of addresses, separate cookies, hashed session
tokens, argon2id, no customer creation from the web, and the payout command taking a snapshot only.
Risks it misses:

- **H8 — high: Cloudflare Access can be bypassed through the public host.** Both hostnames go
  through the one public listener (AD-18). `/api/admin/*` is reachable as
  `hoantiendp.com/api/admin/*`, which is not behind Access, so the "second gate" is not a gate.
  **Fix:** register the staff route group only for `Host = <admin host>`, and verify the
  `Cf-Access-Jwt-Assertion` JWT (team audience) on every staff route in addition to the staff
  session.
- **H9 — high: the public receipt page shows the proof image.** The proof is a bank screenshot with
  the full account number, the holder name, and often the operator's balance. That contradicts the
  last-four-digits rule (FR-10, NFR-6). Uploaded images served on the customer origin are also a
  stored-XSS vector (SVG or HTML disguised as an image) next to the customer session cookie. **Fix:**
  - the receipt page shows facts only;
  - the proof is visible only to staff and to the signed-in customer;
  - accept only JPEG and PNG, re-encode on upload, strip EXIF;
  - serve with a fixed `Content-Type`, `X-Content-Type-Options: nosniff` and a strict CSP.
- **H11 — high: secrets may be exposed right now.** The domain model's OQ8 says "The repository is
  public; both values are exposed". If that is still true, the secrets are exposed now, and the
  planning documents committed under D16 also map the attack surface. **Fix:** rotate the two
  secrets on the live system now, not at cutover, make the repository private (D16 precondition),
  and scrub the history.
- **M10 — medium: rate limits and lockout are blind behind cloudflared.** Every request arrives from
  127.0.0.1, so the global web quota (60 per hour) can be used up by one actor, which is a trivial
  denial of service on web links. Lockout per sequential customer code (DP00001…) lets anyone lock
  every customer out, and one password tried against every code stays under each code's limit
  (spraying). **Fix:**
  - Cloudflare rate-limiting and WAF rules on `/api/session` and the link endpoints;
  - use `CF-Connecting-IP` as a rate-limit *key* only, never for authorization;
  - exponential backoff instead of a hard lock;
  - a global failed-sign-in alert.
- **M16 — medium: the bridge result check is not specified.** Shopee's custom-link page returns
  short links (`s.shopee.vn/...`) that do not show sub_ids, so "the returned link carries the
  batch's sub_id1" (AD-14) cannot be checked as written. **Fix:** resolve the short link's redirect
  outside any transaction and check `utm_content`, or drop the claim. In every case, allow-list the
  returned link's host (Shopee and AccessTrade domains) so `/s/<code>` can never become an open
  redirect.
- **M11 — medium: dev links can reach production.** v1-handover §7 says real Shopee links made from
  dev carry real ids and reconcile into production. AD-25 allows a "dev Chrome profile". **Fix:** dev
  uses the fake bridge only, or the production Shopee account is never signed in on dev, or dev
  sub_id1 values get a `DEV` prefix so production sends them to review.
- **Erasure vs append-only audit (low-medium).** Erasure conflicts with append-only audit if audit
  payloads hold names or phone numbers. **Fix:** audit payloads carry ids and fingerprints only, and
  `search_text` and `sort_key` are cleared on erase.
- **Bank change from Zalo (low).** A bank change in the Zalo private chat needs no confirmation
  (FR-10), so taking over a Zalo account means taking over payouts. Accept this explicitly. Make
  sure `/stk` *changes* are refused in groups, not only reads.

---

## 8. Consistency between spine, code rules, UX and PRD

| # | Contradiction | Severity | Fix |
|---|---|---|---|
| 1 | status-flows cancel list includes `unpaid`; the live report means buyer payment (C1) | critical | Per-network status map |
| 2 | status-flows `APPROVED → REVERSED` guard "not in a payout being confirmed" vs AD-9 "serialization suffices" (C2) | critical | Claim protection as in C2 |
| 3 | AD-8 "page cap fails the run, freezes nothing" vs status-flows transition "page cap → FROZEN" vs AD-7 and D31 "FROZEN on a page-cap read" (M4) | medium | Page cap fails the run; no order is frozen; alert |
| 4 | AD-17 insert-only `ledger_entries` vs AD-6 "open until netted" and AD-23 "merge moves ledger entries" (H3) | high | Entry-sum model |
| 5 | AD-6 payable is net of clawbacks; the PRD glossary and D27 define payable without clawbacks; the EXPERIENCE balance card has no clawback line (M17) | medium | Define "payable" as net in the glossary and show the deduction |
| 6 | status-flows §4 payout `CLAIMED` status; EXPERIENCE registry has only RECORDED and VOIDED; AD-9 claim is a separate deleted row. The AD-10 registry test will fail (L3) | low | Make the claim its own entity in status-flows, or drop CLAIMED |
| 7 | Spine Deferred "second Zalo account is the owner's call" vs D37 (decided); SECURITY_MODEL "accepted risk: none" vs D37; deployment "remote chosen by owner" vs D36; D33–D37 not cited (L4) | low | Update the spine, stride.md and SECURITY_MODEL.md |
| 8 | Share codes: 10 characters in AD-14 and stride vs 8 in live data (L1) | low | Accept both |
| 9 | code.md "SQL never computes money" vs LC summaries, the Overview "what we keep" and FR-27 ratios | low | Allow SUM over stored integers; ratios are computed in `packages/money` |
| 10 | EXPERIENCE calls the landing screen "Today" in places and "Overview" (FR-25) in others | low | One name |
| 11 | AD-12 says orders search covers the customer name, but `search_text` is built per table and AD-4 forbids orders writing customer data | low | Search the join of each table's own `search_text` in `*.list.ts` |
| 12 | FR-4 says 55 s; live used 35 s | info | PRD wins; note the change for operators |

---

## Findings index

| Id | Severity | One line |
|---|---|---|
| C1 | critical | `UNPAID` as a cancel signal rejects normal orders permanently |
| C2 | critical | The transfer happens before confirm; confirm can refuse a real transfer, which invites a second transfer |
| C3 | critical | Cutover rollback after new-system payouts reopens double pay |
| H1 | high | Batches of 5 lose sub_id2 and match by position; use 1 per submission |
| H2 | high | Void returns clawed-back orders to APPROVED |
| H3 | high | Clawback model: insert-only conflict, partial netting, the stuck 0 floor, D35 missing |
| H4 | high | Read window undefined; 90 days of rows exceed the page cap |
| H5 | high | Parity against buggy live queries; live defects imported as payable |
| H6 | high | Naive timestamps differ by column; campaign windows go 7 hours off |
| H7 | high | First reconciliation after cutover bursts Zalo messages |
| H8 | high | Admin API reachable via the public host; Access bypassed |
| H9 | high | Public proof image leaks bank data and is an XSS vector |
| H10 | high | No external dead-man alert; FileVault blocks unattended restart |
| H11 | high | Repository possibly public with live secrets; rotate now |
| M1–M17 | medium | Withheld default, partial commission drops, FROZEN voids awards, page-cap semantics, review candidate source, sync transaction helper, migration gated on off-site, bank re-check at confirm, notification duplicates, rate limits behind the tunnel, dev links reaching prod, proof storage and backups, campaign AD, bridge link check, clawback display |
| L1–L10 | low | Share-code length, lease to lock file, CLAIMED status, decision drift, SQL SUM rule, timed LOCKED, old extension, restore automation, FR-19/27/31 undefined, naming |

---

## Resolution

Applied on 2026-10-30 (owner delegated every choice; recommended fix taken unless it contradicted D29, D33 or "never touch main"). New decisions D38 to D55 are in `docs/domain-model.json` (v0.7.0) and `.context/decisions/`. The "top simplifications" are read as S1 to S4 (fewer moving parts) and section 6 (ship only what money depends on).

| Finding | What changed | Where |
|---|---|---|
| C1 | UNPAID removed from cancel signals; explicit per-network status maps golden-tested on real report rows; staff REJECTED to AWAITING_APPROVAL via review case (D38) | AD-7, AD-22, status-flows §1 and §6, PRD FR-12, code.md §4, domain model order lifecycle |
| C2 | Payout claims kept (OPEN/CONFIRMED/ABANDONED, qr_shown_at); orders under an OPEN claim protected; confirm idempotent and allowed on an abandoned unchanged claim; unique transfer reference; abandoned-claim warning (D39) | AD-7, AD-9, status-flows §1 and §4, c4-dynamic §3, PRD FR-17, EXPERIENCE payout panel, SECURITY_MODEL INV-2 |
| C3 | 72-hour no-payout go/no-go window; rollback only inside it (option a) (D40) | AD-24, PRD FR-33 |
| H1 | One link per submission with sub_id1 and sub_id2; one customer per bridge job (D47) | AD-14, c4-dynamic §1, c4-container, stride B5 |
| H2 | Void sets the state transition() gives, offsets clawback and netting, awards to CONFIRMED or VOID; four golden cases (D41) | AD-9, status-flows §1 and §4, PRD FR-34, EXPERIENCE void dialog, SECURITY_MODEL INV-2 |
| H3 | Clawback open amount = sum of insert-only entries; net up to gross, carry the rest; netting-only payout; clawback includes paid bonus (D35); merge moves nothing (D42) | AD-6, AD-17, AD-23, status-flows §2, PRD glossary and FR-17 |
| H4 | Hourly last 7 days; nightly paced day-slice sweep; last_seen_in_report_at; report jobs yield to links (D43) | AD-8, AD-13, AD-14, status-flows R5, PRD FR-12, c4-dynamic §2 |
| H5 | Paid parity to the dong; payable and waiting by shadow reconciliation diff signed off by owner; named live-payable SQL; unverifiable orders FROZEN (D44) | AD-24, PRD FR-33 |
| H6 | Per-column time conversion table with fixtures; synthesized dates flagged approximate (D45) | AD-24, PRD FR-33 |
| H7 | Seeded dedup keys; first run silent with would-be-send report; daily proactive send cap with alert (D46) | AD-16, AD-24, PRD FR-33 |
| H8 | Staff routes only for the admin Host; Cf-Access-Jwt-Assertion verified on every staff route (D48) | AD-18, SECURITY_MODEL INV-8 and scope, stride B1, code.md §9 |
| H9 | Receipt page facts only; proof only for staff and signed-in customer; JPEG/PNG re-encoded, EXIF stripped, nosniff, CSP (D49) | AD-21, SECURITY_MODEL INV-13, stride E1/B2, PRD FR-18, EXPERIENCE receipt page |
| H10 | External heartbeat checker; pmset no sleep and restart after power loss; UPS; FileVault runbook step; Chrome LaunchAgent (D50) | new AD-29, AD-25, c4-container, c4-deployment |
| H11 | Recorded as an owner action, not a code change: rotate both secrets in the live environment and Cloudflare, make the repository private; main untouched (D51) | AD-19, spine Risks and Owner Actions, docs/index.md Owner actions, PRD §6 and §10, SECURITY_MODEL, stride Repo row, OQ8 |
| S1 | Pure domain/ plus plain module files plus http/; packages/core replaces packages/time, text, domain (D52) | Design Paradigm, AD-4, AD-10, AD-11, AD-12, Structural Seed, code.md §1 |
| S2 | OS lock file and in-memory running flags replace job_leases and job_runs; reconciliation_runs kept (D52) | AD-4, AD-13, SECURITY_MODEL INV-12, stride B9, c4-deployment |
| S3 | Assistant pulls notifications from the internal listener with ack and a local sent-ids file; 8082 listener removed (covers M9) (D52) | AD-15, AD-16, c4-container, c4-deployment, c4-dynamic, stride B4, SECURITY_MODEL |
| S4 | Each backup restore-checked automatically; manual drill at cutover and quarterly (D52) | AD-26 |
| Section 6 (simplification 3) | v1 cutover scope vs after cutover; walking-skeleton build order (D53) | new AD-28, PRD §8.3 Release scope, capability map |
| M1 | Shopee periods withheld by default; staff unmark (D54) | AD-5, PRD FR-13 and §11, spine Risks |
| M2 | Commission drop: APPROVED unpaid freezes for review; PAID gets a partial clawback (D55) | AD-7, status-flows §1 |
| M3 | FROZEN suspends the award; only REJECTED or REVERSED voids it (D55) | status-flows §5, domain model award invariant |
| M4 | Page cap fails the run, freezes no order, alerts (D43) | AD-7, AD-8, status-flows §1 R6 and §6, PRD FR-12 |
| M5 | Review apply offers only the rule-produced candidate; sub_id1 vs sub_id2 owner disagreement opens a review case | AD-8, status-flows §1 and §6 |
| M6 | tx(fn) is synchronous and throws on a thenable; lint rule | AD-2, code.md §5 |
| M7 | Migrations gated on the local backup and integrity check only; off-site afterwards | AD-26, AD-13 |
| M8 | Bank account fingerprint and hold flag in the snapshot hash; re-checked at confirm | AD-9, PRD FR-17 |
| M9 | Covered by S3 | AD-15 |
| M10 | Cloudflare rate-limit/WAF rules; CF-Connecting-IP as a key only; doubling delay instead of a hard lock; global failed-sign-in alert | AD-18, stride B2, status-flows §8, PRD FR-9 |
| M11 | Dev uses the fake bridge or a profile never signed in to production Shopee; DEV sub_id1 prefix | AD-25, c4-deployment, stride B6 |
| M12 | Proof images in backed-up data/env/files; secrets and cloudflared credentials rebuilt by hand | AD-21, AD-26 |
| M14 | Not applied: campaign slot mechanics need a full AD, deferred with the campaign creation UI; imported awards honoured | spine Deferred |
| M16 | Host allow-list; short-link redirect resolved outside any transaction and sub_ids checked | AD-14, stride B5/E1 |
| M17 | getBalances returns deductedNext; balance card line; payable defined as net in the glossary | AD-6, EXPERIENCE balance card, PRD glossary |
| Money outside packages/money | fromNetworkUnits(value, scale); SQL SUM over stored integers allowed, other arithmetic and ratios in packages/money | AD-5, code.md §4 |
| busy_timeout, migrations, restore steps, read-only inspection | busy_timeout 1000; forward-only migrations tested on a backup copy with automatic restore; restore steps; sqlite3 -readonly | AD-2, AD-26 |
| Imported items, in-flight state, L7 | Imported order items stored without recompute; QUEUED requests and unsent notifications imported or listed; old extension removed and live assistant stopped in the day-one sequence | AD-8, AD-24 |
| Shopee session loss | Login redirect pauses the queue, alerts, runbook step | AD-14, spine Risks |
| Erasure vs audit, bank change from Zalo | Audit payloads ids and fingerprints only; erase clears search_text and sort_key; Zalo bank change accepted risk; refused in groups | AD-15, AD-17, AD-23, SECURITY_MODEL, stride |
| L1 | Validator accepts live 8-character share codes | AD-14, AD-24, stride E1 |
| L3 | Payout claim is its own entity in status-flows; CLAIMED payout status dropped | status-flows §4, AD-10 |
| L4 | D33 to D37 cited; Google Drive (D36) in the deployment; D37 accepted risks in SECURITY_MODEL and stride; Deferred no longer calls the second Zalo account the owner's call | spine, c4-deployment, c4-container, SECURITY_MODEL, stride |
| L6 | LOCKED derived from locked_until | AD-10, AD-23, status-flows §8 |
| §1.3 CONVERTED | Set by a linking event handler on orders.order.recorded | Design Paradigm, AD-1 |
| §8 #11 search | Cross-context search joins each table's own search_text | AD-12 |
| §8 #10 Today vs Overview, #12 55 s | Not applied: UX naming sweep left to bmad-ux; 55 s is the PRD value (info) | - |
| L9 FR-19/27/31 definitions | Not applied as definitions; their screens moved after cutover (D53) | AD-28, PRD §8.3 |
