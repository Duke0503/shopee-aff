# C4 Dynamic — the four main flows

Legend: numbers give the order of steps. "tx" marks a step done inside one `BEGIN IMMEDIATE`
transaction on the ledger (AD-2). Elements match the Container diagram.

## 1. Link request to delivered link (FR-1, FR-4, FR-7, AD-14, AD-15, AD-16)

```mermaid
C4Dynamic
  title Dynamic - link request in Zalo to delivered share link

  Person(customer, "Customer")
  System_Ext(zalo, "Zalo")
  Container(assistant, "Zalo assistant", "zca-js")
  Container(server, "Server", "Fastify")
  ContainerQueue(linkq, "Link queue", "link_requests")
  Container(linkjob, "Link job (5 s)", "in-process")
  Container(bridge, "Browser bridge", "MV3 extension")
  System_Ext(shopee, "Shopee Affiliate")
  ContainerQueue(outbox, "Notification outbox", "outbox")
  Container(notifyjob, "Notify job (10 s)", "in-process")

  Rel(customer, zalo, "1. Pastes a Shopee link")
  Rel(zalo, assistant, "2. Message event")
  Rel(assistant, server, "3. POST /internal/link-requests (registers on first contact)", "X-Assistant-Token")
  Rel(server, linkq, "4. tx: reuse own link in window, or insert QUEUED with sub_id1 = customer id")
  Rel(linkjob, linkq, "5. Claims the oldest Zalo batch of one customer")
  Rel(bridge, linkjob, "6. Long-poll returns the batch", "X-Bridge-Token")
  Rel(bridge, shopee, "7. Fills the custom link page, reads page 1 of the lookup")
  Rel(bridge, linkjob, "8. Posts links and rates")
  Rel(linkjob, linkq, "9. tx: ISSUED, share code, estimate from packages/money")
  Rel(assistant, server, "10. Polls request status for up to 28 s; on ISSUED marks DELIVERED and replies")
  Rel(linkjob, outbox, "11. If not delivered after 55 s and under 2 h: tx insert link_late row")
  Rel(notifyjob, assistant, "12. Delivers once; assistant sends at human pace")
```

## 2. Reconciliation to approved or reversed order (FR-12, FR-13, D30, D31, AD-7, AD-8)

```mermaid
C4Dynamic
  title Dynamic - hourly reconciliation run

  Container(recjob, "Reconciliation run (60 min)", "in-process")
  Container(bridge, "Browser bridge", "MV3 extension")
  System_Ext(shopee, "Shopee Affiliate")
  System_Ext(accesstrade, "AccessTrade")
  Container(server, "Orders module", "server")
  ContainerDb(db, "Ledger", "SQLite")
  ContainerQueue(outbox, "Notification outbox", "outbox")
  System_Ext(telegram, "Telegram")

  Rel(recjob, db, "1. Takes the job lease; opens a reconciliation run row")
  Rel(recjob, bridge, "2. Shopee: asks for report pages of the overlapping period")
  Rel(bridge, shopee, "3. Reads the conversion report in the real session")
  Rel(recjob, accesstrade, "4. AccessTrade: reads transactions for the period")
  Rel(recjob, server, "5. Normalizes rows to ReportRow; page cap or 90-day edge fails the run loudly")
  Rel(server, db, "6. tx per order: attribute, transition(order, row) with cancel precedence, store cashback at approval")
  Rel(server, db, "7. Same tx: APPROVED to REVERSED before payout, or PAID gets a clawback ledger entry; FROZEN opens a review case")
  Rel(server, outbox, "8. Same tx: status notifications with dedup keys; campaign awards re-evaluated")
  Rel(recjob, db, "9. Closes the run row with counts; releases the lease")
  Rel(recjob, telegram, "10. Two failed runs in a row: owner alert")
```

## 3. Payout claim to confirm to notified customer (FR-16, FR-17, D19, D32, AD-9)

```mermaid
C4Dynamic
  title Dynamic - payout claim, confirm and notification

  Person(operator, "Operator")
  Container(admin, "Admin desk", "React")
  Container(server, "Payouts module", "server")
  ContainerDb(db, "Ledger", "SQLite")
  System_Ext(bank, "Operator's bank")
  ContainerQueue(outbox, "Notification outbox", "outbox")
  Container(notifyjob, "Notify job (10 s)", "in-process")
  Container(assistant, "Zalo assistant", "zca-js")
  Person(customer, "Customer")

  Rel(operator, admin, "1. Opens a payable customer")
  Rel(admin, server, "2. POST /api/admin/payouts/claims", "staff session")
  Rel(server, db, "3. tx: unique claim per customer, snapshot of covered orders, bonuses, clawbacks and amount")
  Rel(server, admin, "4. Preview: server amount, VietQR, flags")
  Rel(operator, bank, "5. Transfers the shown amount")
  Rel(admin, server, "6. POST confirm with claim id, snapshot hash, proof image")
  Rel(server, db, "7. tx: re-read every covered order (APPROVED, unpaid, owner), recompute, compare to snapshot")
  Rel(server, db, "8. Same tx: payout row, paid_at, history, audit, net clawbacks; or amount_changed and nothing written")
  Rel(server, outbox, "9. Same tx: payout notification with receipt link")
  Rel(notifyjob, assistant, "10. Delivers once")
  Rel(assistant, customer, "11. Sends the paid message")
```

## 4. Customer sign-in (FR-9, D21, AD-18)

```mermaid
C4Dynamic
  title Dynamic - customer password and sign-in

  Person(customer, "Customer")
  Container(assistant, "Zalo assistant", "zca-js")
  Container(web, "Customer website", "React")
  Container(server, "Identity module", "server")
  ContainerDb(db, "Ledger", "SQLite")

  Rel(customer, assistant, "1. Sends /matkhau in a private chat")
  Rel(assistant, server, "2. POST /internal/customers/{id}/password", "X-Assistant-Token")
  Rel(server, db, "3. tx: argon2id hash of 8 random characters; end every other session; audit")
  Rel(assistant, customer, "4. Replies with the password, private chat only")
  Rel(customer, web, "5. Enters customer code and password")
  Rel(web, server, "6. POST /api/session", "HTTPS via tunnel")
  Rel(server, db, "7. tx: resolve code or alias; verify; count failures, LOCKED after 5 for 15 min")
  Rel(server, web, "8. Set-Cookie: random session token, HttpOnly, Secure, SameSite=Lax; only its hash stored")
```
