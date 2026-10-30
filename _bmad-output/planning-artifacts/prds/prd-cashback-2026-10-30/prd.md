---
title: Cashback Platform (hoantiendp.com), re-plan
status: final
created: 2026-10-30
updated: 2026-10-30
revised: 2026-10-30 after the independent architecture review (D38 to D55; Release scope in §8.3)
---

# PRD: Cashback Platform (hoantiendp.com)

## 0. Document Purpose

This PRD defines the re-planned cashback platform for the project owner, and for the UX,
architecture and story workflows that follow it. It builds on the domain model
(`docs/domain-model.json`, version 0.2.0, decisions D1 to D23) and uses its bounded contexts and
business language without restating them. Features are grouped, functional requirements (FR) are
numbered globally, and inferred points carry an inline `[ASSUMPTION]` tag listed in §11.
Technology choices, mechanisms and the current-system audit live in `addendum.md`.

The live Python system keeps running from `main` until the new platform replaces it. Every rule
that kept it correct carries over (D1 to D13); every defect found in it is fixed by design
(D19 to D23).

## 1. Vision

Shoppers in Vietnam already buy on Shopee and TikTok Shop every week. The cashback platform gives
them part of the affiliate commission back. A shopper pastes a product link into a Zalo chat, gets
back a link that belongs to them, buys as usual, and later receives a bank transfer for their share.

The product is trust. A customer must see the exact amount they will get, in dong, and must get it
once, from the commission the network actually approved. The operator must be able to run the whole
business alone in about fifteen minutes a day, without risking the Shopee affiliate account or the
Zalo account that carries every conversation.

The re-plan keeps what works (Zalo-first link delivery, the share link, the money rules) and
replaces what grew by accident: a 5,500-line web server, a 2,500-line payments screen, three
different commission formulas, an admin action that can pay an order twice, and a customer website
whose text contradicts the money rules.

## 2. Target User

### 2.1 Jobs To Be Done

- **Customer:** "When I am about to buy something on Shopee or TikTok, I want to get some money
  back without changing how I shop, and I want to know exactly how much and when it arrives."
- **Customer:** "I want to trust that this is not a scam: clear amounts, a receipt, a real person
  behind it."
- **Operator:** "I want to pay everyone what they are owed in one sitting, without doing maths and
  without the fear of paying twice."
- **Operator:** "I want the system to keep running when I am not watching, and to tell me only
  when something needs me."

### 2.2 Non-Users (v1)

- Sellers and brands. The platform does not sell advertising or manage shop campaigns.
- Affiliates who want their own sub-accounts or referral trees.
- Shoppers outside Vietnam or paying in another currency.

### 2.3 Key User Journeys

- **UJ-1. Lan gets her first cashback link in Zalo.**
  - **Persona + context:** Lan, 27, office worker in Hanoi, joined the Zalo group after a friend
    shared the invite. She is about to buy a 450,000 dong rice cooker.
  - **Entry state:** first private message to the assistant; no customer code yet.
  - **Path:** she pastes the Shopee link. The assistant registers her, replies within about 30
    seconds with the product name, the price, the estimated cashback in dong and a share link.
  - **Climax:** "Bạn nhận lại khoảng 9.263đ" next to the price. She taps the share link; Android
    opens Chrome, iPhone shows how to open in Safari; she buys.
  - **Resolution:** a few minutes to hours later she gets "Đơn đã được ghi nhận" with the
    estimate.
  - **Edge case:** the browser bridge is busy; the assistant says the link is on its way and the
    link arrives in a later message.

- **UJ-2. Lan checks where her money is.**
  - **Entry state:** phone browser, signed in with code DP00012 and the password from /matkhau.
  - **Path:** she opens the website, sees three numbers: waiting for approval, approved and ready
    to pay, already paid; then the list of orders with a progress bar.
  - **Climax:** each order shows its state in words and the amount in dong.
  - **Resolution:** she knows what is coming and that the operator pays approved money, without a
    promised date.

- **UJ-3. Lan adds her bank account when her first order is approved.**
  - **Path:** the "order approved" message tells her the amount and asks for a bank account. She
    sends bank, number and name in chat (or fills the form on the website). The assistant confirms
    with the last four digits.
  - **Edge case:** the bank name matches no bank or several banks; she is asked to pick one.

- **UJ-4. Tuan pastes a link on the website without a code.**
  - **Path:** he pastes a link on the home page and gets a working link with a clear warning: this
    link earns no cashback; get a code through Zalo first.
  - **Climax:** the main button takes him to the assistant in Zalo.
  - **Edge case:** the website link quota is used up; he is sent to Zalo, which has no quota.

- **UJ-5. Minh, the operator, pays everyone in the evening.**
  - **Entry state:** admin desk on a laptop, signed in as staff.
  - **Path:** he opens Payouts. The list shows each customer with approved, unpaid cashback and
    confirmed bonuses, the bank, and a VietQR code. He scans with his banking app, transfers,
    attaches the screenshot, confirms.
  - **Climax:** the customer gets one "đã chuyển tiền" message with the receipt link; the orders
    become paid and leave the list.
  - **Edge case:** a customer changed bank account in the last 72 hours; the row is flagged and he
    checks before paying.

- **UJ-6. Minh clears the review queue.**
  - **Path:** after reconciliation, the desk shows report rows the system would not guess at (no
    customer found, unknown status). He opens each, sees the report row and the candidate
    customer, and applies or dismisses it.

- **UJ-7. Minh runs a "first 20 orders get +20,000 dong" campaign.**
  - **Path:** he creates a campaign with a window, slot count, bonus and minimum order value. Link
    replies mention the offer while slots remain; customers whose orders take a slot are told.
  - **Resolution:** the campaign closes at the end of its window; bonuses are paid with the
    approved cashback.

- **UJ-8. Lan buys on TikTok Shop.**
  - **Path:** she pastes a TikTok Shop link in Zalo; the platform creates the link through
    AccessTrade and replies the same way as UJ-1.

## 3. Glossary

The business language is defined once in
`.claude/skills/bmad-domain-driven/references/glossary.md` (section "Business language"). This PRD
uses those terms exactly: affiliate network, affiliate link, link request, sub_id, share link,
link delivery, attribution window, customer, customer id, customer code, customer alias, guest
account (HOUSE), staff, product lookup, estimated commission, approved commission, commission cap,
XTRA commission, commission split, cashback, operator share, order, order approval, order
cancellation, reconciliation, payout, paid order, bank account, dong, half-up rounding, example
amount, campaign, campaign slot, held slot, Zalo assistant, notification, browser bridge, link
queue, web quota, customer message. Terms added by this PRD:

- **Customer website** — the public site at hoantiendp.com for customers and guests.
- **Admin desk** — the staff-only application for the operator and employees.
- **Payable balance** — a customer's approved, unpaid cashback plus confirmed campaign bonuses,
  minus open clawbacks, never below 0. The deducted clawbacks are shown as their own line.
- **Clawback** — what a customer owes back when a paid order is cancelled: the order's cashback
  plus any bonus paid on it (D35), deducted from later payouts.
- **Receipt page** — the public page of one payout, opened by its bill token.
- **Review case** — a report row the system will not guess at, waiting for staff.
- **Cutover** — the moment the new platform takes over from the live Python system.

## 4. Features

### 4.1 Link issuing

**Description:** A customer gets an affiliate link that belongs to them from Zalo or from the
customer website. Links for Shopee go through the browser bridge; links for TikTok Shop go through
AccessTrade. Chat always delivers the share link. Realizes UJ-1, UJ-4, UJ-8.

#### FR-1: Request a link in Zalo
A customer can paste a Shopee or TikTok Shop product link in a private chat or the community group
and receive a share link with the product name, price and estimated cashback in dong. Realizes UJ-1, UJ-8.

**Consequences (testable):**
- The reply arrives within 30 seconds for 95% of requests when the browser bridge is healthy.
- A link that is not ready in time is delivered later by notification, at most once (FR-4).
- The reply never carries another customer's id in any sub_id (D6).
- A Lazada or unsupported link gets a polite refusal naming the supported networks (D17).

#### FR-2: Request a link on the customer website
A signed-in customer, or a visitor who types an existing customer code, can paste a product link
and receive the affiliate link. Realizes UJ-2.

**Consequences (testable):**
- An unknown customer code returns "customer not found"; it never falls back to a guest link (D10).
- The website quota is 60 new links per hour overall and 20 per customer code per day; beyond it the
  page sends the customer to Zalo (`web_busy`).

#### FR-3: Guest links
A visitor without a code can still get a working link, owned by the guest account. Realizes UJ-4.

**Consequences (testable):**
- The page states plainly that the link earns no cashback, and the main action opens the Zalo
  assistant.
- One guest link is reused per product (D5).
- Guest orders never receive cashback, payouts or messages, and are never moved to a customer later.

#### FR-4: Link delivery once
The platform marks a link delivered the first time any channel hands it over. Realizes UJ-1.

**Consequences (testable):**
- A link unclaimed after 55 seconds and younger than 2 hours is sent by notification once.
- An older undelivered link is marked delivered without a message.

#### FR-5: Link reuse for the same customer
A repeat request from the same customer for the same product inside the attribution window reuses
that customer's own link; product facts may be shared across customers. Realizes UJ-1.

**Consequences (testable):**
- No link is ever reused across two customers (D6). A golden test covers the case that broke
  production on 2026-09-25.
- Outside the attribution window a fresh link request is made with fresh rates (D23).

#### FR-6: Share link
Each link request has one random share code. Opening `hoantiendp.com/s/<code>` redirects a real
browser to the affiliate link, and guides an in-app browser out first. Realizes UJ-1.

**Consequences (testable):**
- Android in-app browsers open Chrome automatically; iOS shows the "open in browser" guidance.
- A click is recorded per visit; preview bots and HEAD requests are not.
- The page shows the product, the price and the estimated cashback with an example amount.

#### FR-7: Link queue and browser bridge safety
Shopee link creation and product lookups run through the operator's signed-in browser, one customer
per submission, with Zalo requests served first. Realizes UJ-1.

**Consequences (testable):**
- No code builds Shopee signature headers or calls Shopee internal APIs directly (D8).
- A product lookup reads page 1 of results only.
- A failed attempt caused by a captcha or a page error is retried without counting; three counted
  failures fail the request and tell the customer.
- All waiting happens on the server, never inside a page script.

### 4.2 Customer account

**Description:** The customer is recognised from Zalo, gets a customer code, can sign in on the
website and keeps one bank account. Realizes UJ-1, UJ-2, UJ-3.

#### FR-8: Registration from Zalo only
The Zalo assistant registers a person the first time they write privately or paste a product link
in the community group. Realizes UJ-1.

**Consequences (testable):**
- The customer receives a customer code DP plus five digits, never reused.
- The customer website cannot create a customer (D10).
- Group membership alone does not register anyone (answers OQ7, D25).

#### FR-35: Erase a customer
Staff can erase a customer's personal data at the customer's request.

**Consequences (testable):**
- Erasure is refused while the customer is owed money, unless an admin forces it with a reason (D13).
- Erasure removes the name, Zalo ids, bank account and password, and keeps orders, payouts and audit
  entries under the permanent customer id with no personal data (D26), so the ledger and D4 stay
  intact.
- An erased customer's old links still attribute orders to the erased record, which earns nothing
  further and receives no messages.

#### FR-9: Sign in and password
A customer can ask for a password with /matkhau and sign in on the website with the customer code
and that password. Realizes UJ-2.

**Consequences (testable):**
- Each /matkhau issues a new password and ends every other session (D21).
- After five failed sign-ins the customer code waits a delay that doubles from 1 minute up to
  15 minutes, so nobody can lock every customer out (spine AD-18).
- A session stays valid on a trusted phone until sign-out or a new password.

#### FR-10: Bank account
A customer can save, change or erase one bank account in chat or on the website. Realizes UJ-3.

**Consequences (testable):**
- The account number is 4 to 30 letters and digits after removing spaces and dashes; the holder
  name is stored in upper case; the bank must match exactly one VietQR bank.
- Consent time is stored with the account. Screens and messages show only the last four digits.
- Every change sends a Zalo message to the customer with the last four digits of the new account.
- A change made on the website holds payouts until the customer confirms it in the Zalo private
  chat or staff verify it; a change made in the Zalo private chat needs no confirmation.
- Any change raises a 72-hour review flag on the admin desk.
- A password the customer chooses has at least 8 characters and is not the customer code;
  passwords from /matkhau are 8 random characters.

#### FR-11: Customer merge
Staff can merge two duplicate customers after reviewing a proposed pair. Realizes UJ-6.

**Consequences (testable):**
- Customers with different bank accounts are never merged.
- Old customer ids and retired codes resolve to the survivor; orders on old links reach it.
- Campaign awards move with the orders.

### 4.3 Order tracking and reconciliation

**Description:** Every hour the platform reads each network's conversion report, attributes each
order to a customer and follows it to approval or cancellation. Realizes UJ-1, UJ-6.

#### FR-12: Reconcile Shopee and AccessTrade reports
The platform reads the Shopee report through the browser bridge and AccessTrade transactions
through its API, every 60 minutes.

**Consequences (testable):**
- Running reconciliation twice over the same period changes nothing.
- A paid order is never changed (D4); an approved order is never rejected later.
- Attribution uses sub_id1, then customer aliases, then the owner of the sub_id2 request; anything
  else becomes a review case.
- Unknown statuses become review cases instead of a guess.
- Each network's statuses are read through an explicit status map tested on real report rows;
  Shopee's `UNPAID` (the buyer has not paid yet) means awaiting, never cancelled (D38). Staff can
  undo a wrong rejection through a review case.
- Cancel signals follow a fixed precedence (order status, then each item, then a 0 commission); an
  unknown status or a missing order id freezes the order out of every total (D31). A read that hits
  the page cap fails the run and alerts the owner; it freezes no order (D43).
- Each hourly run reads the last 7 days; a nightly sweep reads every day that still holds an
  awaiting or approved unpaid order, so approvals 30 to 70 days after purchase are seen (D43).
- A cancel after approval reverses the order before payout; a cancel after payout keeps it paid and
  nets a clawback against the next payout (D30). Every status is defined in
  `docs/operations/status-flows.md`.

#### FR-13: Cashback from approved commission
On approval, the platform computes cashback with the one commission split (D3, D20).

**Formula (one function in the shared money package, D20):**

1. `commission = min(approvedShopeePart, 40,000) + approvedXtraPart` for Shopee (D2); the approved
   commission as reported for AccessTrade.
2. `fee = commission x feeRate(network)`: 0.98% for Shopee, 0% for AccessTrade.
3. `tax = commission x 10%` when the order's settlement period is withheld, else 0. A Shopee
   settlement period is withheld when Shopee withholds personal income tax on that period's payout
   (a payout of 2,000,000 dong or more); staff mark the period on the admin desk, and orders
   approved before the mark use the setting in force at approval. AccessTrade periods are always
   withheld. A Shopee period counts as withheld unless staff unmark it (D54), because the tax is
   known only after approval. [ASSUMPTION: the network report does not say it.]
4. `net = commission - fee - tax`.
5. `cashback = roundHalfUp(net x 80%)`, the only rounding step, to a whole dong (D1). The operator
   share is `net - cashback`.

**Consequences (testable):**
- Golden test, Shopee, not withheld: commission 100,000 dong gives fee 980, net 99,020, cashback
  79,216.
- Golden test, Shopee, withheld: commission 100,000 dong gives fee 980, tax 10,000, net 89,020,
  cashback 71,216.
- Golden test, Shopee cap: order 84,600,000 dong at 3% Shopee and 0% XTRA gives commission 40,000,
  not 2,538,000.
- Golden test, AccessTrade: commission 50,000 dong gives tax 5,000, net 45,000, cashback 36,000.
- Guest orders get 0.
- The operator's own income tax on the gross commission is outside this formula and never reduces
  a customer's cashback.

#### FR-14: Review cases
Staff can open each review case, see the report row and the candidate customer, and apply or
dismiss it. Realizes UJ-6.

**Consequences (testable):**
- Applying a case runs the same attribution and approval rules as reconciliation; it can never
  change a paid order, attribute a guest order to a customer, or set an amount by hand.
- Every apply or dismiss records the staff member, the time and the reason.
- There is no free-form "manual adjustment" of money anywhere in the platform.

### 4.4 Balance and order history

**Description:** Customers see what they are owed and the state of every order. Realizes UJ-2.

#### FR-15: Balance and order list
A customer can see the payable balance, the amount waiting for approval and the amount already
paid, and the list of orders, on the website and with /sodu and /donhang in a private chat.

**Consequences (testable):**
- Every amount is computed by the server; the website never calculates money.
- Each order shows its state in words: recorded, approved, paid, cancelled with reason.
- /donhang in the group is refused with a pointer to the private chat.
- No screen or message promises a payout date (D11).

### 4.5 Payouts

**Description:** The operator pays customers by bank transfer from the admin desk. Realizes UJ-5.

#### FR-16: Payable list
Staff can see every customer with a payable balance, the bank account, a VietQR code and any flag
(missing bank, bank changed in 72 hours, bank change not yet confirmed).

**Consequences (testable):**
- Payable means approved and not paid, whether or not the network has settled it (D11, D27).
  Settlement is shown next to each order as separate information, so staff can choose to wait.
- The QR amount always equals the payable balance; it never includes waiting or estimated money.
- The same customer shows the same amounts on phone, tablet and desktop.

#### FR-17: Record a payout
Staff can record a payout for one customer, with an optional proof image, through one command (D19).

**Consequences (testable):**
- The payout covers only approved orders without a paid time and only confirmed bonuses.
- The amount is computed by the server and shown before confirmation.
- The covered orders become paid with history entries; the customer gets one message with the
  receipt page link.
- A customer without a bank account cannot be paid.
- No path exists to pay an awaiting or already-paid order.
- The payout covers exactly the orders and bonuses shown when staff opened it. Confirmation fails
  with "the amount changed, review again" if reconciliation changed that set in between.
- Only one payout per customer can be in progress; a second staff member sees it as taken.
- A customer whose bank account was changed on the website and not yet confirmed in Zalo is held
  (FR-10); confirmation re-checks the bank account and the hold.
- The operator transfers before confirming, so a transfer is never refused for timing: confirming
  an expired claim succeeds when the covered orders are unchanged, a retried confirmation returns the
  same payout, and a cancel arriving while the claim is open is applied after it ends (D39). Each
  claim has its own transfer reference (customer code plus a short claim id).
- Opening a customer whose last claim was abandoned after the QR was shown warns that a transfer
  may already have been made.
- When open clawbacks cover the whole gross payable, staff record a netting-only payout (transfer
  0, no QR, no message) (D42).

#### FR-34: Void a mistaken payout
An admin can void a payout recorded by mistake, as a compensating action (D24).

**Consequences (testable):**
- Each covered order returns to the state its latest report row gives: approved, or reversed if a
  cancel was seen; its bonuses return to confirmed, or void when the order is reversed; clawback
  netting written by the payout is reversed (D41). The void, the reason and the admin are recorded
  in the order history and the audit trail.
- A void never deletes the payout; it stays visible as voided.
- If the customer was already told about the payout, the customer gets one correction message.
- Reconciliation still never changes a paid order (D4); only this admin command can.

#### FR-18: Receipt page
Anyone with the link can open the receipt page of one payout: customer code, last four digits,
amount, date. The token is random and unguessable. The proof image is never on the public page; it
is shown only to staff and to the signed-in customer (D49).

#### FR-19: Network settlement
Staff can see what each network has paid the operator and which approved orders those payments
settle. Settlement never changes what the customer is owed.

### 4.6 Customer conversation and notifications

**Description:** The Zalo assistant answers chat commands and the platform sends notifications on
its own. Realizes UJ-1, UJ-3, UJ-5, UJ-7.

#### FR-20: Chat commands
A customer can use /id, /matkhau, /sodu, /donhang, /stk and /help, or paste a link.

**Consequences (testable):**
- Private data (/matkhau, /donhang, /stk) is answered in a private chat only.
- Every message text comes from `resources/messages.vi.json`.

#### FR-21: Notifications
The platform tells a customer about a late link, a failed link, a recorded order, an approved
order, a cancelled order, a payout, and a held or lost campaign slot, each once.

**Consequences (testable):**
- A failed send retries after 1, 2, 4 minutes and so on, up to one hour.
- Every percentage in a message carries an example amount in dong.
- A 0 dong payout message is never sent.

#### FR-22: Zalo account safety
The assistant keeps a human pace: no bulk messages, at most 30 friend requests a day and only to
people who wrote first, and one session per account (D9).

#### FR-36: Zalo account loss
If the Zalo account is locked or lost, the platform keeps working for customers on the website.

**Consequences (testable):**
- The owner gets an alert within 5 minutes of the assistant losing its session.
- The customer website shows a banner with the new contact path while chat is down; signed-in
  customers keep balances, orders, bank details and website link requests.
- Notifications that cannot be sent wait and are delivered once a new account is connected;
  messages older than 7 days are dropped instead.
- Connecting a new Zalo account runs the customer merge flow (FR-11), because Zalo ids differ per
  viewing account.

### 4.7 Campaigns

**Description:** The operator runs promotions as records, not code. Realizes UJ-7.

#### FR-23: Create and run a campaign
An admin can create a campaign with a window, slot count, bonus, minimum order value, networks,
per-customer cap and exclusions.

**Consequences (testable):**
- Slots go to qualifying orders recorded inside the window, earliest first; a slot belongs to an
  order.
- A slot freed by a cancellation passes on only while the campaign runs.
- The campaign closes at the end of its window, which is exclusive (D22).
- Staff, the guest account and excluded customers never hold a slot.
- A bonus is paid only with the approved order's cashback.

### 4.8 Admin desk

**Description:** One staff application for daily work. Realizes UJ-5, UJ-6, UJ-7.

#### FR-24: Staff accounts and roles
An admin can create employees, change their role or status and reset passwords. The root admin
cannot be demoted.

**Consequences (testable):**
- Admin only: staff accounts, campaigns. Admin and employee: everything else.
- Every payout, void, merge, erase, review decision and period mark records the staff member and
  time.

#### FR-25: Overview (one landing screen)
Staff can see in one screen what needs them now and the state of the business (FR-27 metrics in one quiet line): payable customers, review cases, failed links,
the health of the browser bridge, the Zalo assistant and the last reconciliation.

#### FR-26: Customers and orders
Staff can search customers by code, name or Zalo id, open one customer's full page (orders, links,
payouts, bank, flags) and search orders by id, status and network.

#### FR-27: Business metrics
Staff can see approved orders per day, effective commission rate, valid rate, approved average order
value and orders per active customer per month, marked untrustworthy below 100 approved orders.

### 4.9 Deals (withdrawn)

FR-28 is withdrawn: the platform has no deals or vouchers (D29).

### 4.10 Operations

#### FR-29: Audit trail
Every business act (link, order, payout, bank change, sign-in, merge, erase) is appended to an audit
trail that is never changed. A bank account appears only as a fingerprint.

#### FR-30: Owner alerts
The operator gets a Telegram alert when the browser bridge is stuck on a captcha or error page,
the Zalo assistant is disconnected, reconciliation fails twice in a row, or a backup fails.

#### FR-31: Fraud checks
Staff can see flags for a bank account shared by several customers, frequent bank changes, a high
cancellation share and bursts of link requests.

#### FR-32: Backups
The platform backs up the ledger before every migration and every day, and copies backups off the
machine. Restoring a backup is a documented, tested procedure.

### 4.11 Lists, time and shared definitions

**Description:** The current web has dozens of list defects: date filters that return nothing,
columns that sort by a different value than they show, totals from a different set than the table,
search that misses Vietnamese names, and filters lost on refresh. They come from nine recurring
causes catalogued in `list-defects.md`. Every list on the customer website and the admin desk
follows one contract instead of its own code.

#### FR-37: One list contract
Every list (orders, payouts, customers, link requests, products, review cases, campaigns, audit
entries, a customer's own orders) offers search, filters, sorting and pagination through one shared
contract.

**Consequences (testable):**
- Filtering, sorting and pagination run on the server over the full set. The browser never filters
  or sorts a partial page.
- A column sorts by exactly the value it displays. Money sorts as numbers, dates as instants, statuses
  in lifecycle order, Vietnamese names with Vietnamese collation.
- Search ignores case, Vietnamese diacritics and spaces, escapes wildcards, and covers the same named
  fields on every screen (customer code, name, Zalo id, order id, product name). It never searches
  raw JSON.
- Every count, badge and summary card next to a list is computed from the same filtered set as the
  rows, or is labelled as the overall total. No count is silently capped.
- Filter, sort, search and page live in the URL. Refresh, back and a shared link restore the same
  view; switching tabs keeps it.
- Changing a filter resets to page 1; the page is clamped when the result shrinks. Search waits
  300 ms after typing. The previous rows stay visible, dimmed, while new rows load, and late
  responses are discarded.
- Loading, empty, error and stale states are distinct and named. An error is never shown as "no
  rows". No placeholder figure is ever shown as real data.
- After any action (payout, review, merge), every list and summary that shows the changed records
  refreshes.
- Every defect in `list-defects.md` has a regression test.

#### FR-38: One time and status vocabulary
The platform stores every instant in one format and defines each status once.

**Consequences (testable):**
- Every instant is stored as UTC in one format. Every business day, week and month (filters,
  dashboards, campaign windows, "today") is computed in Asia/Ho_Chi_Minh. A date range includes its
  whole end day (D28).
- Times typed by staff (campaign windows, date filters) are read as Vietnam time.
- Every displayed date shows the year when it is not the current year, and each date column shows one
  kind of date only (recorded, approved or paid).
- "Payable", "waiting for approval", "paid", "settled by the network", "has a bank account" and every
  status label have one definition in the shared domain code, used by every screen, the chat and the
  exports (D27).
- Every money figure on any screen comes from the shared money package through the server; no
  screen, query or export has its own formula.

### 4.12 Cutover

#### FR-33: Import the live ledger
The new platform imports the live database without changing any customer id, customer code, order,
paid time, payout, campaign award or share code.

**Consequences (testable):**
- After import, every customer's paid amount equals the live system's, to the dong. Payable and
  waiting amounts are checked by a shadow run of the new reconciliation on the rehearsal copy: the
  owner signs off the per-order differences it reports, because the live figures carry known defects
  (D44). An order the report can no longer verify is frozen with a review case.
- The first reconciliation after import sends no messages, and messages the live system already
  sent are never sent again (D46).
- For 72 hours after the switch the new system records no payouts; rollback to the live system is
  allowed only inside that window (D40).
- Old share links and receipt links keep working.
- The import converts every stored time to the one UTC format (FR-38) by a per-column rule (UTC,
  Vietnam time, or approximate), and reports each row it could not convert instead of guessing
  (D45).
- A rehearsal on a copy of the live database passes before the real cutover.

## 5. Cross-Cutting NFRs

- **NFR-1 Money correctness.** Every money change has a golden test. Zero double payouts and zero
  misattributed orders are release blockers.
- **NFR-2 Devices.** Every customer screen works on phones from 360 px wide and inside the Zalo
  in-app browser; every screen covers phone, tablet and desktop.
- **NFR-3 Performance.** Customer website pages are interactive within 2 seconds on a mid-range
  phone on 4G. [ASSUMPTION]
- **NFR-4 Availability.** Link issuing through Zalo is available whenever the host machine, the
  browser bridge and the assistant are up; the platform shows its own degraded state rather than
  failing silently.
- **NFR-5 Security.** Internal routes require tokens, not source addresses; passwords and session
  tokens are stored only as hashes; secrets never live in the repository.
- **NFR-6 Privacy.** Bank accounts and phone numbers are personal data under Vietnam's personal data
  protection law (in force 2026-01-01): consent is recorded, a customer can erase bank details, and
  logs never contain full account numbers.
- **NFR-7 Language.** All customer-facing text is Vietnamese and lives in the resource files; code
  contains no Vietnamese and no emoji (D15).
- **NFR-8 Operability.** The operator's daily work (payouts, review queue, health check) takes at
  most 15 minutes for 30 orders a day. [ASSUMPTION]
- **NFR-9 Maintainability.** No source file over 400 lines on the server or 300 on the frontend.

## 6. Constraints and Guardrails

- **Shopee affiliate account.** No official API is available (refused 2026-09-10). Losing the
  account loses about two months of unpaid commission. Hence D8 and FR-7.
- **Zalo.** One personal account through an unofficial library. A lock cuts every customer at once;
  the customer website is the customer fallback (FR-36). Telegram carries owner alerts only.
- **Exposed secrets.** A deploy webhook secret and a third-party key are committed on `main`. The
  owner rotates both values now on the live system and in Cloudflare, without code changes on
  `main`, and makes the repository private (OQ8, D51).
- **Host.** Production runs on one home machine (currently a Mac) with a Cloudflare tunnel. Two
  machines must never run production at the same time.
- **Money law.** The platform never holds a customer wallet; it records what is owed and the
  operator transfers it. Tax is due on the gross commission.
- **Cost.** Running cost stays near zero: no paid Zalo OA, at most a small VPS if the architecture
  needs one.

## 7. Non-Goals

- No automatic bank transfers and no in-app wallet.
- No referral program, no multi-level rewards.
- No mobile app; the website and Zalo are the surfaces.
- No Lazada in the first release (D17).
- No raising the customer share above 80% of net.
- No seller-facing features.
- No deals, featured products or vouchers (D29).

## 8. MVP Scope

### 8.1 In Scope

- FR-1 to FR-38 for Shopee and TikTok Shop through AccessTrade, delivered in two steps: the v1
  cutover scope, then the rest (§8.3).
- A redesigned customer website and admin desk on one design system.
- Cutover from the live system with a rehearsal.

### 8.2 Out of Scope for MVP

- Lazada (D17).
- Telegram as a customer channel (owner alerts only).
- A staging environment with its own Zalo account. [NOTE FOR PM: needed before cutover rehearsal
  if possible.]
- Public metrics or marketing pages beyond the home page and the guide.

### 8.3 Release scope (v1 cutover vs after cutover)

Cutover is big-bang (one Zalo session, two databases), so v1 is bounded by what paying,
attributing and reconciling depend on (D53, spine AD-28). The FRs below stay in the PRD; only
their delivery moves after cutover. None of them is on the pay, attribute or reconcile path.

| Deferred until after cutover | Reason | Until then |
|---|---|---|
| FR-27 business metrics beyond the one quiet line on the Overview | Reporting, not money; ratios are untrustworthy below 100 approved orders anyway | The Overview line (FR-25) |
| FR-31 fraud flags except the shared-bank-account flag | Detection aids; only the shared bank account can send money to the wrong person | The shared-bank-account flag on the payout row |
| FR-19 network settlement screen | Settlement never changes what a customer is owed | Settlement data kept; no screen |
| FR-23 campaign creation UI | Imported awards are honoured by the balance; a new campaign is rare | An admin command creates a campaign if one must run at cutover |
| FR-11 merge UI | Needed only when the Zalo account changes | An admin command with preview and apply, as live does |
| FR-24 staff management UI | Staff change rarely | Staff are seeded |
| FR-29 audit trail screen | The audit trail is still written by every command | Audit read by admin query |
| Guide page redesign, product and link-request lists beyond a basic list | Not on the money path | Basic list from the list contract |

## 9. Success Metrics

**Primary**
- **SM-1:** Double payouts and misattributed orders: 0 per month. Validates FR-5, FR-12, FR-17.
- **SM-2:** Approved orders per day, monthly average, measured after the first 100 approved orders.
  Validates FR-1, FR-6.
- **SM-3:** Zalo link reply time: 95% within 30 seconds. Validates FR-1, FR-7.

**Secondary**
- **SM-4:** Effective commission rate (approved commission divided by approved order value), reported
  monthly. Validates FR-13.
- **SM-5:** Valid rate (approved orders divided by all orders). Validates FR-12.
- **SM-6:** Share of approved customers with a bank account on file within 7 days of first approval.
  Validates FR-10, FR-21.
- **SM-7:** Operator time per day. Validates FR-16, FR-25.

**Counter-metrics (do not optimize)**
- **SM-C1:** Registered customer count. Many registered customers with few orders is worse than few
  customers with many orders. Counterbalances SM-2.
- **SM-C2:** Links issued. More links with no orders raise the risk to the affiliate account.
  Counterbalances SM-3.
- **SM-C3:** Messages sent. More messages raise the risk of a Zalo lock. Counterbalances SM-6.

## 10. Open Questions

1. OQ1 (storage: keep SQLite or move to PostgreSQL) — for the architecture step.
2. OQ2 (stack: keep the v2 TypeScript monorepo) — for the architecture step.
3. OQ5 (does a copy of the earlier v2 design documents exist) — owner.
4. OQ8 (hard-coded secrets on `main`) — owner action now: rotate the values without code changes
   and make the repository private (D51).
5. Does the operator want a dev environment with a second Zalo account before cutover? — owner.

## 11. Assumptions Index

- §4.3 FR-13: Shopee settlement periods are withheld by default and staff unmark them, because the
  report does not say it (D54).
- §5 NFR-3: 2-second interactive target on a mid-range phone.
- §5 NFR-8: 15 minutes of operator work per day at 30 orders a day.
