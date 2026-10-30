---
status: final
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
created: 2026-10-30
updated: 2026-10-30
mode: headless (project owner delegated every choice; recommended option taken and logged below)
inputDocuments:
  - docs/domain-model.json
  - .context/decisions/ (D1 to D55)
  - _bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/prd.md
  - _bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/addendum.md
  - _bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/list-defects.md
  - _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cashback-2026-10-30/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cashback-2026-10-30/EXPERIENCE.md
  - docs/operations/status-flows.md
  - docs/rules/code.md
  - SECURITY_MODEL.md
  - docs/design/wireframe/README.md
  - _bmad/custom/bmad-create-epics-and-stories/story-guide/README.md
---

# cashback - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the cashback platform
(hoantiendp.com), decomposing the requirements from the PRD, the UX spines and the architecture
spine into implementable stories. It follows the team story guide
(`_bmad/custom/bmad-create-epics-and-stories/story-guide/README.md`): the 3 C's, INVEST, 4 to 6
testable acceptance criteria, tracer-bullet vertical slices with explicit "Blocked by" edges, and
the project rules (money golden tests, attribution, idempotence, Zalo pace, roles).

Conventions used in every story:

- **Size:** S is about 1 developer day, M about 2 days, L about 3 days (one developer assisted by
  Claude). No story is larger than L.
- **Screens** cite the wireframe sections of `docs/design/wireframe/README.md` as W0 to W7
  (W0 Components, W1 Home and link, W2 My money, W3 Share and receipt, W4 Admin today and payouts,
  W5 Admin orders, customers and review, W6 Admin campaign, links, staff, audit, metrics, settings,
  W7 System states). The UX spines win over the wireframes.
- **Skills:** `cashback-shadcn` (build rules), `cashback-ui-review` (review), `cashback-design-craft`
  (brand, copy, responsive), `cashback-infra` (host, deploy, backups), `cashback-security-model`
  (invariants INV-1 to INV-13).
- Every story that touches money adds a golden test in `packages/golden` and keeps all maths in
  `packages/money` (`docs/rules/code.md` §4). Every UI story covers phone, tablet and desktop.

### Headless decisions log

The owner delegated every choice. Where the workflow would have asked, the recommended option was
taken:

| # | Question the workflow asks | Choice taken |
|---|---|---|
| H1 | Other documents to include or exclude (step 1) | Included the story guide, review-independent.md (Resolution table), status-flows.md, code.md, SECURITY_MODEL.md, list-defects.md and the wireframe README; excluded the Vietnamese current-system notes (reference only) |
| H2 | Output location | `_bmad-output/planning-artifacts/epics/epics-cashback-2026-10-30/epics.md`, following `docs/index.md` step 7 (`planning-artifacts/epics/`) and the dated-folder pattern of the other artifacts |
| H3 | Requirements complete (step 1 menu) | Confirmed [C] |
| H4 | Epic structure approval (step 2 menu) | Approved the spine build order with the adjustments A1 to A4 below; [C] |
| H5 | Advanced elicitation or party mode | Not run; [C] at every menu |
| H6 | Story format | The team story guide template (Card, Context, Screens, Skills, Blocked by, numbered Given/When/Then criteria) wins over the generic BMAD template, as the team override directs |
| H7 | Deferred FRs | Epic 9 "After cutover", stories sketched only (PRD §8.3, AD-28) |
| H8 | "Admin command" for merge, campaign and staff before their screens exist | A server command reached through a small internal CLI that calls the internal listener with a staff token, so the server stays the one writer (AD-2); preview then apply |
| H9 | CI provider | GitHub Actions (the repository is on GitHub); the spine leaves the provider to the first build story |
| H10 | Shopee report source for the shadow run before the bridge exists | A `ReportSource` that reads the operator's Shopee report export file; AccessTrade through its read-only API |

Adjustments to the requested epic order (and why):

- **A1.** The pure order `transition()` function and the pure attribution rule are built in Epic 2,
  not Epic 3, because the spine's build order puts the shadow reconciliation at step 2 and the shadow
  run needs them. Epic 3 wires them into the stateful hourly run on the ledger.
- **A2.** The Drizzle schema and backup-first migrations stay in Epic 1 (as requested) although the
  spine lists the server skeleton at build step 3: the cutover import of step 2 writes the new schema,
  so it needs the database platform first. Each story creates only the tables it needs.
- **A3.** The story guide's walking skeleton ("one product URL to a delivered link for one
  customer") is not Sprint 1. The spine's step 1 (money and core) and the request's Sprint 1 bound
  win; the Epic 1 skeleton proves the workspace, contracts, server and CI, and the link tracer bullet
  is Story 5.1. Flagged as an open question for the owner.
- **A4.** The network status maps (AD-22) are in Epic 1 (Story 1.11) because the spine's build step 1
  names the status-map fixtures and `fromNetworkUnits` as part of the foundations.

## Requirements Inventory

### Functional Requirements

FR-1: Request a link in Zalo: paste a Shopee or TikTok Shop link (private chat or community group), get a share link with product name, price and estimated cashback in dong; 95% within 30 s; late link delivered once; never another customer's id; Lazada refused politely.
FR-2: Request a link on the customer website: signed-in or typed existing customer code; unknown code returns not found, never a guest fallback; quota 60 links per hour overall and 20 per code per day, beyond it `web_busy` to Zalo.
FR-3: Guest links: working link owned by HOUSE, plain "no cashback" warning with Zalo as main action, one guest link per product, no cashback, payouts or messages, never moved to a customer.
FR-4: Link delivery once: delivered on first hand-over; unclaimed after 55 s and younger than 2 h sent once by notification; older marked delivered silently.
FR-5: Link reuse for the same customer inside the attribution window only; never across customers (golden test of the 2026-09-25 case); fresh request with fresh rates outside the window.
FR-6: Share link `/s/<code>`: real browser redirect, Android in-app opens Chrome, iOS guidance; clicks recorded except bots and HEAD; shows product, price and estimated cashback with example amount.
FR-7: Link queue and browser bridge safety: one customer per submission, Zalo first, no Shopee signatures or internal API calls, page 1 lookups, uncounted captcha retries, three counted failures fail and tell the customer, all waiting on the server.
FR-8: Registration from Zalo only: first private message or link pasted in the group; code DP plus five digits never reused; the website never creates a customer; group membership alone registers nobody.
FR-9: Sign in and password: /matkhau issues a new password and ends other sessions; doubling delay after five failures from 1 to 15 minutes; trusted-phone session until sign-out or new password.
FR-10: Bank account: one account, 4 to 30 letters and digits, holder upper case, exactly one VietQR bank, consent time, last four digits only, change message, website change held until Zalo confirmation or staff verification, 72-hour flag; chosen passwords at least 8 characters and not the code.
FR-11: Customer merge after reviewing a proposed pair; never with different bank accounts; aliases resolve to the survivor; awards follow the orders (UI after cutover; admin command in v1).
FR-12: Reconcile Shopee (through the bridge) and AccessTrade (API) every 60 minutes: idempotent, paid never changed, attribution order, status maps (UNPAID awaiting), cancel precedence, FROZEN on unknown, page cap fails the run, hourly 7 days plus nightly sweep, reverse before payout and clawback after.
FR-13: Cashback from approved commission with the one split: Shopee cap 40,000, fee 0.98% Shopee and 0% AccessTrade, 10% tax in a withheld period (Shopee withheld unless unmarked, AccessTrade always), cashback = roundHalfUp(net x 80%); four golden cases; guests 0.
FR-14: Review cases: apply or dismiss with the same rules as reconciliation, never a paid order, a guest order or a typed amount; actor, time and reason recorded; no manual money adjustment anywhere.
FR-15: Balance and order list on the website and with /sodu and /donhang in private chat: server-computed amounts, states in words, /donhang refused in groups, no payout date promised.
FR-16: Payable list: every customer with a payable balance, bank, VietQR, flags; payable means approved and unpaid whatever the settlement; QR equals the payable balance; same figures on every device.
FR-17: Record a payout through one command with optional proof: approved unpaid orders and confirmed bonuses only, server amount, paid with history, one message with receipt link, no bank no payout, snapshot check, one claim per customer, hold re-check, idempotent confirm on an expired unchanged claim, unique transfer reference, abandoned-claim warning, netting-only payout.
FR-18: Receipt page: customer code, last four digits, amount, date; random token; proof image never public, only staff and the signed-in customer.
FR-19: Network settlement: what each network paid and which orders it settles; never changes what is owed (screen after cutover).
FR-20: Chat commands /id, /matkhau, /sodu, /donhang, /stk, /help or a pasted link; private data only in private chat; all text from `resources/messages.vi.json`.
FR-21: Notifications (late link, failed link, recorded, approved, cancelled, payout, held or lost slot), each once; retries 1, 2, 4 minutes up to one hour; example amount with every percentage; no 0 dong payout message.
FR-22: Zalo account safety: human pace, no bulk messages, at most 30 friend requests a day and only to people who wrote first, one session.
FR-23: Create and run a campaign (window, slots, bonus, minimum value, networks, per-customer cap, exclusions); creation UI after cutover; admin command in v1; imported awards honoured.
FR-24: Staff accounts and roles: admin only for staff accounts and campaigns; actor recorded on every money act (UI after cutover; staff seeded in v1).
FR-25: Overview: payable customers, review cases, failed links, bridge, assistant and last reconciliation health, one quiet metrics line.
FR-26: Customers and orders: search customers by code, name or Zalo id; one customer's full page; search orders by id, status and network.
FR-27: Business metrics beyond the Overview line (after cutover).
FR-29: Audit trail of every business act, never changed, bank as fingerprint (written in v1; screen after cutover).
FR-30: Owner alerts on Telegram: bridge stuck, assistant disconnected, reconciliation failing twice, backup failing.
FR-31: Fraud checks: shared bank account (v1); frequent bank changes, high cancellation share, link bursts (after cutover).
FR-32: Backups before every migration and daily, copied off the machine; documented and tested restore.
FR-33: Import the live ledger without changing ids, codes, orders, paid times, payouts, awards or share codes; paid parity to the dong; shadow parity for payable and waiting; quiet first run; 72-hour no-payout window; old links work; per-column time conversion; rehearsal first.
FR-34: Void a mistaken payout (admin): orders return to the state their latest report row gives, bonuses to confirmed or void, netting reversed, payout kept as voided, one correction message.
FR-35: Erase a customer: refused while owed unless an admin forces it with a reason; personal data removed, ledger kept under the permanent id; old links attribute to the erased record, which earns nothing and gets no messages.
FR-36: Zalo account loss: owner alert within 5 minutes, website banner and full website service, notifications wait (dropped after 7 days), new account runs the merge flow.
FR-37: One list contract for every list: server-side filter, sort and pagination, one field per column, normalised search, same-set counts, URL state, page reset and clamp, debounce, distinct states, refresh after actions, a regression test per list defect.
FR-38: One time and status vocabulary: UTC instants in one format, Vietnam business days, whole end day, staff input as Vietnam time, year shown when not current, one date kind per column, one definition per status and shared term, every money figure from the money package.

FR-28 is withdrawn (D29, no deals).

### NonFunctional Requirements

NFR-1: Money correctness: every money change has a golden test; zero double payouts and zero misattributed orders are release blockers.
NFR-2: Devices: every customer screen from 360 px and inside the Zalo in-app browser; every screen covers phone, tablet and desktop.
NFR-3: Performance: customer pages interactive within 2 s on a mid-range phone on 4G.
NFR-4: Availability: Zalo link issuing available whenever host, bridge and assistant are up; degraded state shown, never silent failure.
NFR-5: Security: internal routes need tokens, not addresses; passwords and session tokens stored as hashes; no secrets in the repository.
NFR-6: Privacy: bank accounts and phone numbers are personal data; consent recorded, bank details erasable, no full account numbers in logs.
NFR-7: Language: customer text Vietnamese in resource files only; no Vietnamese or emoji in code.
NFR-8: Operability: daily work at most 15 minutes for 30 orders a day.
NFR-9: Maintainability: no server file over 400 lines, no frontend file over 300.

### Additional Requirements

From the architecture spine (AD-1 to AD-29), the code rules and the security model:

- No starter template. The workspace is the existing pnpm monorepo of the earlier v2 attempt, re-based on the pinned stack (Node 24, pnpm 12.16.1, TypeScript 6.0.3, Fastify 5, Drizzle 0.45 over better-sqlite3 13, Zod 4, Vitest 5, Playwright, dependency-cruiser 18); `packages/money` and `packages/golden` kept and extended, `packages/contracts` rewritten, `packages/core` new, `apps/server` rewritten without NestJS (AD-3, Structural Seed).
- Seven server modules (identity, linking, orders, payouts, campaigns, messaging, operations) with pure `domain/`, plain module files and `http/`; edges enforced by dependency-cruiser (AD-1, AD-4).
- One SQLite file in WAL, one writer process, synchronous `tx(fn)` with `BEGIN IMMEDIATE`, no network I/O in a transaction, forward-only migrations tested on a backup copy and gated on a local backup (AD-2, AD-26).
- One money package, integer dong, one rounding step, `fromNetworkUnits` for report amounts, cashback stored at approval (AD-5); payable defined once by `getBalances` (AD-6).
- One order `transition()` (AD-7); reconciliation fetch apart from apply, per-order transactions, fingerprints, hourly 7 days plus nightly sweep (AD-8); payout claim and idempotent confirm, void (AD-9).
- Status registry tested against status-flows.md (AD-10); one time module (AD-11); one list contract with `defineList()` and `DataList` (AD-12).
- In-process jobs, OS lock file, no job tables (AD-13); link queue and bridge protocol with long-poll and token (AD-14); assistant process pulling notifications (AD-15); outbox with dedup keys, backoff, daily cap and silent mode (AD-16).
- Insert-only audit, history, observations and ledger entries with triggers; actor on every money command; fingerprints only (AD-17).
- Two listeners (public 8080, internal 8081), staff routes only on the admin host with the Cloudflare Access JWT, separate session cookies, argon2id, doubling sign-in delay, Origin checks, constant-time token compare (AD-18).
- Secrets in `~/.config/cashback/<env>.env`, Zod-validated, never in bundles, logs or errors; secret scan on every commit (AD-19).
- Shared Zod contracts and one error envelope (AD-20); two SPAs plus server-rendered share and receipt pages; proof images re-encoded and never public (AD-21).
- One adapter per network with explicit status maps golden-tested on real rows (AD-22); immutable customer ids, DP codes, aliases, merge that moves nothing (AD-23).
- Cutover import, per-column time table, seeded dedup keys, shadow parity, day-one sequence, 72-hour window (AD-24).
- Host processes on the Mac under launchd, separated dev environment with DEV sub_id1 prefix (AD-25); backups with restore check, age and rclone to Google Drive (AD-26); pino with redaction, Telegram alerts with cooldowns, one health model (AD-27); external heartbeat (AD-29).
- v1 cutover scope and build order (AD-28, D53).
- Required checks before merge: typecheck, lint (naming, size, boundaries), depcruise, tests (golden and registry), secret scan (code.md §11).

### UX Design Requirements

UX-DR1: Design tokens from DESIGN.md (colours, Be Vietnam Pro type scale, spacing, radius, touch target 44 px) generated once into `packages/ui` and the server pages' CSS.
UX-DR2: `DataList` component implementing LC-1 to LC-16: table on tablet and desktop, stacked cards on phone (LC-12), sort Select on phone, filter bottom sheet with counts, URL state, debounce, dim-and-keep previous rows, distinct loading, empty, no-matches, error and stale states.
UX-DR3: Money figure (one formatter `79.216đ`, estimate variant with "khoảng" and "ước tính", dash for missing, aria-label in words); status badge from the registry; filter chip with facet count; flag badge; masked account `•• 6789`; copyable code chip `C · Mã`.
UX-DR4: Admin shell: grouped sidebar on desktop, icon rail on tablet, bottom tabs plus "Thêm" on phone; admin-only items hidden for employees; exact count badges only.
UX-DR5: Customer shell: top bar, three bottom tabs on phone, Zalo-down banner, offline strip, `lang="vi"`, works inside the Zalo in-app browser.
UX-DR6: Payout panel (480 px sheet, phone drawer) with server preview, QR panel, transfer reference, proof drop zone, single confirm stating the amount, amount-changed state, abandoned-claim warning, netting-only variant, claim marker for another staff member.
UX-DR7: Void dialog listing each order's resulting state; review case panel with read-only report row, rule candidate, reason and server-previewed result; erase dialog naming what is removed and kept; withheld period toggle with affected count.
UX-DR8: Overview: three to-do tiles, three state figures, aged orders, one quiet metrics line, health line with dot plus word and runbook link.
UX-DR9: Balance card (hero payable, waiting with estimate tag, paid, "Trừ vào lần chuyển sau" line when deductedNext > 0, no payout date sentence); bank account card (normal, missing, pending confirmation); bank form (VietQR picker, number normalisation, upper-case holder, consent).
UX-DR10: Order card with three-step order progress, one labelled date kind, rejected reason; expandable history.
UX-DR11: Link converter, link result card, guest warning (never dismissible, above the link), Zalo hand-off panel, Zalo button (one per region, no floating button).
UX-DR12: Server-rendered share page (Android intent, iOS steps, real-browser redirect, guest variant, unknown code) and receipt page (facts only, voided state, noindex).
UX-DR13: Accessibility floor WCAG 2.2 AA: visible focus, focus return from sheets, live-region result counts, `aria-sort`, `aria-pressed`, field errors tied with `aria-describedby`, paste allowed, reduced motion, reflow at 320 px.
UX-DR14: Interaction bans: no infinite scroll, no hover-only controls, no "select all" on money actions, no typed money amounts, no floating action buttons, no auto-dismissing error toasts; dialogs become sheets on phone.

### FR Coverage Map

FR-1: Epic 5 (5.1, 5.6, 5.7) and Epic 6 (6.3) - link in Zalo
FR-2: Epic 7 (7.6) - website link with code and quota
FR-3: Epic 5 (5.2) and Epic 7 (7.6) - guest link
FR-4: Epic 6 (6.5) - delivered once
FR-5: Epic 5 (5.2) - reuse only for the same customer
FR-6: Epic 5 (5.8) - share page
FR-7: Epic 5 (5.3, 5.4, 5.5, 5.6) - queue and bridge safety
FR-8: Epic 6 (6.2) - registration from Zalo
FR-9: Epic 6 (6.8) and Epic 7 (7.2) - password and sign-in
FR-10: Epic 6 (6.9) and Epic 7 (7.5) - bank account
FR-11: Epic 4 (4.19) admin command; Epic 9 (9.5) UI
FR-12: Epic 1 (1.11), Epic 2 (2.6 to 2.9), Epic 3 (3.3 to 3.8), Epic 5 (5.9) - reconciliation
FR-13: Epic 1 (1.2), Epic 3 (3.4), Epic 4 (4.18) - cashback split and withheld periods
FR-14: Epic 3 (3.5, 3.9) and Epic 4 (4.15) - review cases
FR-15: Epic 4 (4.1), Epic 6 (6.7), Epic 7 (7.3, 7.4) - balance and orders
FR-16: Epic 4 (4.6) - payable list
FR-17: Epic 4 (4.7, 4.8, 4.11) - record a payout
FR-18: Epic 4 (4.9) - receipt page
FR-19: Epic 9 (9.3) - settlement screen (data kept by import)
FR-20: Epic 6 (6.7, 6.8) - chat commands
FR-21: Epic 6 (6.4, 6.6) - notifications
FR-22: Epic 6 (6.1) - Zalo pace
FR-23: Epic 4 (4.20) admin command; Epic 9 (9.4) UI
FR-24: Epic 4 (4.2, 4.20) seeded staff and roles; Epic 9 (9.6) UI
FR-25: Epic 4 (4.17) and Epic 8 (8.3) - Overview and health
FR-26: Epic 4 (4.13, 4.14) - customers and orders
FR-27: Epic 4 (4.17) quiet line; Epic 9 (9.1) metrics screen
FR-29: Epic 3 (3.2) audit written; Epic 9 (9.7) screen
FR-30: Epic 3 (3.2) alert port; Epic 8 (8.3, 8.4) Telegram and heartbeat
FR-31: Epic 4 (4.6) shared bank account flag; Epic 9 (9.2) other flags
FR-32: Epic 1 (1.7) backup before migration; Epic 8 (8.2, 8.6) daily, off-site, restore
FR-33: Epic 2 (2.1 to 2.9), Epic 6 (6.10), Epic 8 (8.7, 8.8) - cutover
FR-34: Epic 4 (4.10) - void
FR-35: Epic 4 (4.16) - erase
FR-36: Epic 6 (6.11) and Epic 7 (7.1) - Zalo loss
FR-37: Epic 4 (4.3, 4.5, 4.13, 4.14), Epic 7 (7.4), Epic 5 (5.10) - list contract
FR-38: Epic 1 (1.3, 1.8, 1.9), Epic 2 (2.1) - time and status vocabulary

NFR-1: Epics 1 to 4 golden tests; NFR-2 and NFR-3: Epics 4, 5, 7; NFR-4: Epics 5, 6, 8; NFR-5 and NFR-6: Epics 1, 4, 6, 7, 8; NFR-7: Epics 6, 7; NFR-8: Epic 4; NFR-9: Epic 1 (1.1 lint).
UX-DR1, UX-DR3, UX-DR4, UX-DR13, UX-DR14: Epic 4 (4.4, 4.5); UX-DR2: Epic 4 (4.5); UX-DR5, UX-DR9, UX-DR10, UX-DR11: Epic 7; UX-DR6: Epic 4 (4.7, 4.8, 4.11); UX-DR7: Epic 4 (4.10, 4.15, 4.16, 4.18); UX-DR8: Epic 4 (4.17); UX-DR12: Epic 4 (4.9) and Epic 5 (5.8).

## Epic List

### Epic 1: Foundations and walking skeleton
A developer can build, test and run the platform from one workspace whose money, time, status and text rules are proven by golden tests, with a server that answers its health route through the shared contracts and a ledger database that never migrates without a backup.
**FRs covered:** FR-13 (money), FR-12 (status maps), FR-32 (backup before migration), FR-37 and FR-38 (core text, time, status), NFR-1, NFR-5, NFR-9.

### Epic 2: Cutover import and shadow reconciliation
The owner can import a copy of the live ledger into the new schema beside the running live system, read-only, and sign off a per-order parity report produced by the new reconciliation rules on real data.
**FRs covered:** FR-33, FR-12 (pure rules), FR-38 (time conversion).

### Epic 3: Reconciliation and the order state machine on the ledger
The reconciliation run keeps every order's state, cashback and review cases correct every hour and every night, idempotently, without ever touching a paid order.
**FRs covered:** FR-12, FR-13, FR-14 (commands), FR-29 (audit written), FR-30 (alert port).

### Epic 4: Payout path and admin desk
The operator can see who is owed, pay each customer once with a QR and a receipt, void a mistake, clear review cases and find any customer or order, on lists that follow the List Contract on phone, tablet and desktop.
**FRs covered:** FR-11 (command), FR-14 (screen), FR-15 (balance), FR-16, FR-17, FR-18, FR-23 and FR-24 (commands, seeded staff), FR-25, FR-26, FR-31 (shared bank flag), FR-34, FR-35, FR-37, FR-38.

#### Story 4.21: Network payouts matched to exact orders

As the operator, I want every Shopee and AccessTrade payout matched to the exact orders it pays, so that I never add up orders by hand against the network again.

**Context:** D59 replaces the live date cut-off (`settle_orders_for_batch`) with exact matching. Realises FR-19 (moved into v1 by D59). Follows AD-4, AD-6, AD-22. Decisions: D27, D59.
**Screens:** Chuyển tiền tab "Sàn thanh toán", payout detail, payout panel (settled marker). **Skills:** cashback-shadcn, cashback-ui-review.
**Blocked by:** Story 3.7, Story 4.3.
**Size:** M

**Acceptance criteria**
1. Given a network payout whose order list is known, when it is recorded, then exactly those orders are marked settled with the payout id, and an order already settled by another payout is refused and opens a review case.
2. Given a payout with no order list, when the orders validated in its billing period have approved commission minus fee and tax equal to the payout amount to the dong, then all of them are settled with the payout id (golden test).
3. Given the same payout when the sums differ, then no order is settled, the difference in dong and the candidate orders are shown, and a review case `settlement_mismatch` opens.
4. Given the "Sàn thanh toán" tab, when staff open a payout, then they see its orders with product thumbnails, the matched total, the payout amount and the difference, from the server.
5. Given the payout panel for a customer, when it shows the covered orders, then each order says whether the network has paid it and by which payout.

## Epic 5: Link issuing, browser bridge and share page
A customer's link request becomes an affiliate link that carries only that customer's id, created through the operator's real browser for Shopee or the AccessTrade API for TikTok Shop, and opened through the share page in a real browser.
**FRs covered:** FR-1, FR-3, FR-5, FR-6, FR-7, FR-12 (Shopee report pages), FR-37 (basic link requests list).

### Epic 6: Zalo assistant and notifications
A customer can register, get links, check balance and orders, set a bank account and receive each notification once in Zalo, at a human pace, with a silent first run after cutover.
**FRs covered:** FR-1, FR-4, FR-8, FR-9 (/matkhau), FR-10 (chat), FR-15 (chat), FR-20, FR-21, FR-22, FR-33 (quiet first run), FR-36.

### Epic 7: Customer website
A customer can sign in on the phone, see the money they are owed and every order in words, manage the bank account, and get a link with a code or as a guest.
**FRs covered:** FR-2, FR-3, FR-9, FR-10 (web), FR-15, FR-36 (banner), FR-37, NFR-2, NFR-3.

### Epic 8: Operations, rehearsal and go-live
The owner can run production unattended on the Mac with separated dev, daily off-site backups that are checked, alerts and an external heartbeat, then rehearse and perform the cutover with a 72-hour no-payout window.
**FRs covered:** FR-30, FR-32, FR-33 (rehearsal and day one), NFR-4, NFR-5.

### Epic 9: After cutover (deferred)
The deferred FRs of PRD §8.3 and AD-28, sketched only, to be detailed after go-live.
**FRs covered:** FR-11 (UI), FR-19, FR-23 (UI), FR-24 (UI), FR-27, FR-29 (screen), FR-31 (other flags), Guide redesign, product and link-request lists beyond basic.

## Epic 1: Foundations and walking skeleton

A developer can build, test and run the platform from one workspace whose money, time, status and
text rules are proven by golden tests, with a server that answers its health route through the
shared contracts and a ledger database that never migrates without a backup. Spine build step 1
(AD-28), plus the database platform the import of Epic 2 writes into (adjustment A2).

### Story 1.1: Workspace on the pinned stack with required checks in CI

As a developer, I want one pnpm workspace on the pinned stack whose required checks run on every push, so that every later story is built and verified the same way.

**Context:** The earlier v2 monorepo is re-based, not restarted: pnpm 12.16.1, Node 24, TypeScript 6.0.3, Vitest 5, ESLint, dependency-cruiser 18 (AD-3, Stack table). The old `apps/*` stay as reference and are excluded from the checks until each is rewritten (Structural Seed disposition table). Production paths (`src/cashback`, `web/`, `zalo_assistant/`, `extension/`, `resources/`) and `main` are never touched. CI runs on GitHub Actions (decision H9). Realises NFR-9, NFR-5 (secret scan). Follows AD-3, AD-19, code.md §2, §3, §11.
**Screens:** none. **Skills:** cashback-infra, cashback-security-model.
**Blocked by:** None.
**Size:** S

**Acceptance criteria**
1. Given a clean clone on Node 24, when `pnpm install --frozen-lockfile` runs, then it succeeds with the versions of the spine's Stack table recorded in the lockfile.
2. Given the workspace, when `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`, `pnpm test` and the secret scan run in CI, then each is a separate required check and the pipeline is green on the empty skeleton.
3. Given a server file of 401 lines, a frontend file of 301 lines or a file name without its role suffix, when lint runs, then it fails naming the file and the rule.
4. Given a committed string shaped like a token or key, when the secret scan runs, then the check fails and the value is not echoed in the CI log.
5. Given the legacy v2 `apps/*` and the Python paths, when the checks run, then they are excluded explicitly by configuration and a change under the production paths fails a path guard in CI.

### Story 1.2: Money package computes the FR-13 split with golden tests

As the reconciliation run, I want one money package that computes commission, fee, tax, net, cashback and operator share in whole dong, so that every screen, message and payout uses the same figures.

**Context:** `packages/money` is kept and its `split.ts` rewritten to FR-13 with integer basis points; the exact net is unrounded and `roundHalfUp(net x 80%)` is the only rounding that affects a customer (D1, D34). `legacyRoundHalfEven` and the unused tax-policy parameter are removed. `fromNetworkUnits(value, scale)` is the only entry for report amounts. Realises FR-13, NFR-1. Follows AD-5, code.md §4. Decisions: D1, D2, D3, D5, D12, D20, D34, D54.
**Screens:** none. **Skills:** none (money rules in CLAUDE.md and code.md §4).
**Blocked by:** Story 1.1.
**Size:** M

**Acceptance criteria**
1. Given a Shopee commission of 100,000 dong in a period not withheld, when the split runs, then fee is 980, net 99,020 and cashback 79,216 (golden).
2. Given a Shopee commission of 100,000 dong in a withheld period, when the split runs, then fee is 980, tax 10,000, net 89,020 and cashback 71,216 (golden); and given an AccessTrade commission of 50,000 dong, then fee 0, tax 5,000, net 45,000 and cashback 36,000 (golden).
3. Given an 84,600,000 dong Shopee order at 3% Shopee and 0% XTRA, when the commission is computed, then it is 40,000, not 2,538,000; and an XTRA part on top of the cap is added uncapped (golden).
4. Given any split, when it is computed, then `operatorShare = commission - fee - tax - cashback` holds exactly, every output is a safe integer, a non-integer or unsafe input throws, and a guest (HOUSE) order gets cashback 0.
5. Given report amounts at each scale the networks use, when `fromNetworkUnits` converts them, then the result is half-up to whole dong and matches the golden fixtures, including the .5 boundary.
6. Given the money package source, when lint runs, then `Math.round`, `toFixed` and `legacyRoundHalfEven` are absent and a golden test run is part of `pnpm test`.

### Story 1.3: Time module stores UTC instants and computes Vietnam business days

As a staff member, I want every date filter, "today" and campaign window to follow Vietnam days, so that a range includes its whole end day and nothing lands 7 hours off.

**Context:** `packages/core/time` is the only code that creates, parses or formats instants; instants are `YYYY-MM-DDTHH:mm:ss.sssZ` text; business days are Asia/Ho_Chi_Minh; ranges are half-open to the next Vietnam day's start; domain code takes a `Clock`. Realises FR-38. Follows AD-11, code.md §7. Decisions: D22, D28. Regression tests for list-defects root cause 1 (end date excludes its day, "today" in UTC, campaigns 7 hours late).
**Screens:** none. **Skills:** none.
**Blocked by:** Story 1.1.
**Size:** S

**Acceptance criteria**
1. Given the calendar range 2026-10-01 to 2026-10-31, when it becomes an instant range, then it is [2026-09-30T17:00:00.000Z, 2026-10-31T17:00:00.000Z) and an order at 23:59 Vietnam time on 31 October is inside it.
2. Given a fixed clock at 2026-10-30T18:30:00.000Z, when "today" is asked, then it is 2026-10-31 in Vietnam, not 2026-10-30 (regression for the dashboard "today in UTC" defect).
3. Given a staff-typed "15/11/2026 00:00" for a campaign end, when it is parsed, then it becomes 2026-11-14T17:00:00.000Z and an order at that exact instant is outside the window (end exclusive).
4. Given a date in a past year, when it is formatted for display, then the year is shown; a date in the current year may omit it.
5. Given code outside `packages/core/time` and `platform/clock`, when lint runs, then `Date.now()` and `new Date()` are rejected.

### Story 1.4: Server walking skeleton answers its health route through the shared contracts

As a developer, I want a Fastify server with its public and internal listeners and a health route whose response is a shared contract, so that every later slice plugs into a running server and one error envelope.

**Context:** `apps/server` is rewritten without NestJS: a composition root, `platform/http` with the two listeners (public 127.0.0.1:8080, internal 127.0.0.1:8081; dev 9080/9081), `trustProxy` off, and the AD-20 envelope. `packages/contracts` is re-created with the health schema and the error envelope. Realises NFR-5 (listener split). Follows AD-1, AD-3, AD-18, AD-20.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 1.1.
**Size:** S

**Acceptance criteria**
1. Given the server started in dev, when `GET /api/health` is called on the public listener, then it returns 200 with a body that the `packages/contracts` health schema parses.
2. Given the internal listener, when any `/internal/*` route is called without its token header, then it returns 401 in the error envelope and the public listener does not serve `/internal/*` at all (404).
3. Given an unknown route, when it is called, then the body is `{ error: { code: "not_found", messageKey } }` with the status from the one mapping, and no stack trace is returned.
4. Given a request carrying `X-Forwarded-For`, when the server reads the caller, then the header is ignored (`trustProxy` off), verified by a test.
5. Given a test run, when the server is started and stopped by the test harness, then both listeners bind only to 127.0.0.1 and close cleanly.

### Story 1.5: Config, single-instance lock and redacted logs

As the operator, I want the server to refuse to start with missing secrets or a second instance, and to never log personal data, so that production cannot run twice or leak a secret.

**Context:** `platform/config` reads `~/.config/cashback/<env>.env` once and validates it with Zod; no `process.env` elsewhere. At startup the server takes an exclusive OS lock on `data/<env>/server.lock`. Logs are pino JSON with the redaction list. Realises NFR-5, NFR-6. Follows AD-13, AD-19, AD-27. Decisions: D51, D52. Invariants INV-9, INV-12.
**Screens:** none. **Skills:** cashback-security-model, cashback-infra.
**Blocked by:** Story 1.4.
**Size:** S

**Acceptance criteria**
1. Given an env file missing a required secret, when the server starts, then it exits with the name of the missing key and never prints any secret value.
2. Given a running server holding `data/dev/server.lock`, when a second instance starts on the same data directory, then it refuses to start and logs `platform.server.lock_held`.
3. Given a crash that left the lock file behind, when the server restarts, then it starts, because the OS lock was released (no PID file is trusted).
4. Given a log call carrying a bank number, phone number, token, session id or password field, when it is written, then the value is redacted in the output (test over each field).
5. Given code outside `platform/config`, when lint runs, then a `process.env` read is rejected.

### Story 1.6: Ledger database with the synchronous transaction helper

As a developer, I want one SQLite ledger opened only by the server with a synchronous `tx(fn)` helper, so that every write runs in `BEGIN IMMEDIATE` and no transaction can await network I/O.

**Context:** Drizzle over better-sqlite3, WAL, `busy_timeout = 1000` with one retry, `foreign_keys = ON`, `synchronous = NORMAL`. `tx(fn)` throws if `fn` returns a thenable; a lint rule rejects an async callback. Migrations are forward-only. This story creates no business table: tables arrive with the first story that needs them. A shared helper creates insert-only triggers for the tables AD-17 names. Follows AD-2, AD-4, AD-17, code.md §5. Decisions: D33.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 1.5.
**Size:** M

**Acceptance criteria**
1. Given the server starts on an empty data directory, when the database opens, then `journal_mode` is WAL, `foreign_keys` is on and `busy_timeout` is 1000, verified by pragma reads in a test.
2. Given `tx(fn)` where `fn` returns a promise, when it runs, then it throws and nothing is committed; and an `async` callback passed to `tx` fails lint.
3. Given a write while another connection holds the write lock past the timeout, when the retry also fails, then the command fails with a typed `ledger_busy` error and no partial write remains.
4. Given a table declared insert-only through the helper, when code issues UPDATE or DELETE on it, then the trigger rejects the statement (test on a fixture table).
5. Given a migration file, when migrations run, then they apply in order, are recorded once, and a down migration is not supported.

### Story 1.7: Migrations run only after a checked local backup

As the operator, I want every startup migration to be preceded by a local backup that passes an integrity check, and a failed migration to restore that copy automatically, so that a schema change can never lose the ledger.

**Context:** The backup job of AD-26 starts here in its migration-gate form: SQLite online backup API, `PRAGMA integrity_check`, then migrate; on failure restore the pre-migration copy. The off-site copy and the daily schedule come in Story 8.2. A command runs pending migrations against a copy of the latest production backup before deploy. Realises FR-32 (before every migration). Follows AD-2, AD-13, AD-26. Decisions: D36, D52 (review M7).
**Screens:** none. **Skills:** cashback-infra.
**Blocked by:** Story 1.6.
**Size:** M

**Acceptance criteria**
1. Given a pending migration, when the server starts, then a local backup is written under `data/<env>/backups/`, passes `integrity_check`, and only then is the migration applied.
2. Given a migration that throws halfway, when startup runs, then the pre-migration copy is restored automatically, the server refuses to start, and the log names the failed migration.
3. Given no pending migration, when the server starts, then no backup is taken at startup.
4. Given a backup copy that fails `integrity_check`, when startup runs, then no migration is applied and the server refuses to start.
5. Given the "rehearse migration" command and a backup file, when it runs, then it applies pending migrations to a temporary copy and reports success or the failing migration without touching the live ledger.

### Story 1.8: Status registry tested against status-flows.md

As a staff member, I want every status, its lifecycle order, tone and label key defined once, so that screens, chat and exports never disagree on what a status or "payable" means.

**Context:** `packages/core/status` holds every entity of `docs/operations/status-flows.md` (order, clawback, link request, payout claim, payout, campaign award, review case, network settlement, customer) with value, lifecycle order, tone, label key, customer message key and allowed transitions, plus the shared definitions (payable, waiting for approval, paid, settled, has a bank account). Label text stays in the resource files; adding missing label keys is additive only, because the live system reads the same files. Realises FR-38. Follows AD-10, code.md §8. Decisions: D23, D27, D39.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 1.1.
**Size:** S

**Acceptance criteria**
1. Given `docs/operations/status-flows.md`, when the registry test parses it, then every state and transition matches the registry and an added or removed state on either side fails the test.
2. Given order statuses, when they are sorted by the registry, then the order is lifecycle order (AWAITING_APPROVAL, FROZEN, APPROVED, REVERSED, PAID, REJECTED as defined), never alphabetical (regression for "status sorts alphabetically").
3. Given the customer entity, when the registry lists stored values, then `LOCKED` is marked derived from `locked_until` and is not a storable value.
4. Given the payout claim, when the registry is read, then it is its own entity (OPEN, CONFIRMED, ABANDONED) and the payout has only RECORDED and VOIDED.
5. Given every label key in the registry, when the resource check runs, then each key resolves in `resources/dashboard.vi.json` or `resources/messages.vi.json`, and a missing key fails the test.

### Story 1.9: Text normalisation builds search text and Vietnamese sort keys

As a staff member, I want search to find "Nguyễn" when I type "nguyen" and names to sort in Vietnamese order, so that no customer or order is missed by a search.

**Context:** `packages/core/text` builds the stored `search_text` (lowercase, diacritics folded including "đ" to "d", spaces removed) and `sort_key` columns, and escapes wildcards in a query. Each table builds its own columns later with these functions. Realises FR-37 (search part). Follows AD-12. Regression tests for list-defects root cause 7.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 1.1.
**Size:** S

**Acceptance criteria**
1. Given the name "Nguyễn Thị Đào", when `search_text` is built, then it is "nguyenthidao", and the query "nguyen thi dao" matches it.
2. Given a query containing `%` or `_`, when it is turned into a match pattern, then both are escaped and match only themselves.
3. Given the names "Đào", "Dung", "An" and "Ánh", when they are sorted by `sort_key`, then the order follows Vietnamese collation (fixture with the expected order).
4. Given a JSON string as input, when `search_text` is built, then the function refuses non-text structured input by type, so raw JSON cannot be indexed.

### Story 1.10: Seven module skeleton with enforced boundaries

As a developer, I want the seven context modules to exist with their `index.ts` and the dependency edges of the spine enforced in CI, so that no module reaches into another's internals.

**Context:** Modules identity, linking, orders, payouts, campaigns, messaging and operations, each with `domain/`, `http/` and `index.ts`; the `platform` ports `outbox.enqueue`, `audit.record` and `alert` are declared as types only. dependency-cruiser encodes exactly the edges of the spine diagram. Follows AD-1, AD-4, code.md §1.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 1.4.
**Size:** S

**Acceptance criteria**
1. Given the module skeleton, when `pnpm depcruise` runs, then it passes and the rule set lists exactly the edges of the spine diagram.
2. Given a test import from `orders` into `payouts` internals (not its `index.ts`), when depcruise runs, then it fails naming both files.
3. Given a file in any `domain/` folder importing Fastify, Drizzle or another module, when depcruise runs, then it fails.
4. Given `apps/web` or `apps/admin` importing `packages/money`, when depcruise runs, then it fails.

### Story 1.11: Network catalog and status maps golden-tested on real report rows

As the reconciliation run, I want each network's raw order and item statuses mapped explicitly to AWAITING, APPROVED or CANCELLED, so that an unpaid Shopee order is never read as a cancel and an unknown status freezes instead of guessing.

**Context:** The linking module's network catalog (fee rate, tax rule, cap rule, sub_id format, amount scale, status map) for Shopee and AccessTrade; Lazada absent (D17). The Shopee map starts from the live `STATUS_MAP` in `src/cashback/shopee/report_reader.py`, read as reference and unchanged. Fixtures are made from real report rows with personal data removed (the owner supplies them). Realises FR-12. Follows AD-22, code.md §4. Decisions: D17, D18, D20, D38.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 1.2, Story 1.10.
**Size:** M

**Acceptance criteria**
1. Given a real Shopee row with `UNPAID`, `PAID`, `COMPLETED` or `DELIVERED`, when it is mapped, then the status is AWAITING (golden), never CANCELLED.
2. Given Shopee rows with cancelled, invalid, fraud or closed statuses, when they are mapped, then the status is CANCELLED; and a validated or approved row maps to APPROVED.
3. Given an AccessTrade transaction fixture for each of its statuses, when it is mapped, then each maps as the catalog defines (golden).
4. Given a raw status not in a map, when it is mapped, then the result is UNKNOWN, and a test proves no default branch maps it elsewhere.
5. Given the catalog, when a module asks for a network's fee rate, tax rule or cap rule, then it reads them through the linking module's `index.ts`, and the money split for each network uses these values (test joins catalog and split).

## Epic 2: Cutover import and shadow reconciliation

The owner can import a copy of the live ledger into the new schema beside the running live system,
read-only, and sign off a per-order parity report produced by the new reconciliation rules on real
data. Spine build step 2 (AD-28); de-risks review findings C1, H4, H5 and H6 on real data first.
The import is a one-shot command in `apps/server/src/cutover/` (AD-24). It never opens the live
production file: only a copy, read-only.

### Story 2.1: Cutover time conversion table with per-column fixtures

As the owner, I want every live timestamp converted to the one UTC format by a rule for its column, so that no campaign window or paid time moves by 7 hours during the import.

**Context:** A per-column table (column, source zone, fallback), each entry with a fixture test: `CURRENT_TIMESTAMP` columns are naive UTC, campaign start and end are Vietnam time, dates synthesized from the order SN prefix are flagged `approximate`; a value that fits no rule is listed in the import report, never guessed. Realises FR-33, FR-38. Follows AD-11, AD-24. Decisions: D28, D45. Regression for list-defects "campaigns open 7 hours late" and "log times mix formats".
**Screens:** none. **Skills:** none.
**Blocked by:** Story 1.3.
**Size:** M

**Acceptance criteria**
1. Given a live value `2026-10-01 05:00:00` in a `CURRENT_TIMESTAMP` column, when it is converted, then it becomes `2026-10-01T05:00:00.000Z`.
2. Given a live campaign start `2026-11-01 08:00:00` (naive Vietnam time), when it is converted, then it becomes `2026-11-01T01:00:00.000Z`.
3. Given values with `+07:00` and `+00:00` offsets in the same column, when they are converted, then both become the correct UTC instant.
4. Given an order date synthesized from the SN prefix, when it is converted, then it carries the `approximate` flag into the new row and the report counts it.
5. Given a value that matches no rule (an unparseable string), when the import runs, then the row is listed in the import report with table, key and column, and no value is written for it.
6. Given a live column with no entry in the table, when the import starts, then it refuses to run and names the column.

### Story 2.2: Import customers, aliases, codes and bank accounts unchanged

As the owner, I want every customer id, customer code, alias and bank account imported exactly, so that every link already carrying a sub_id1 still attributes to the right person.

**Context:** Creates the identity tables it needs (customers, customer_aliases, customer_code_counter, bank_accounts). The counter continues above the highest live code. Bank accounts keep consent time; the audit fingerprint is HMAC-SHA-256 with the fingerprint key. Names get `search_text` and `sort_key`. The import opens the source copy read-only and refuses a path that is the configured live production file. Realises FR-33, FR-8 (codes never reused). Follows AD-4, AD-17, AD-23, AD-24. Decisions: D6, D10, D13, D26. Invariant INV-1.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 1.7, Story 1.9, Story 2.1.
**Size:** M

**Acceptance criteria**
1. Given a copy of the live database, when the import runs, then every customer id, customer code and alias in the new ledger equals the source (row-by-row comparison in the report).
2. Given the highest live code DP00412, when the counter is imported, then the next code issued is DP00413 and no code is ever reissued.
3. Given the configured live production path, or a source opened writable, when the import is started on it, then it refuses before reading any row.
4. Given a customer with a bank account, when it is imported, then the number, bank and upper-case holder are kept with consent time, and the import log and report show only the last four digits.
5. Given the same source copy, when the import runs twice into two fresh ledgers, then both ledgers are identical (deterministic import).

### Story 2.3: Import orders with their stored amounts and paid times

As the owner, I want every live order imported with its stored amounts, status and paid time exactly, so that no paid order can be paid again and no amount is silently recomputed.

**Context:** Creates the orders tables it needs (orders, order_items, order_status_history, order_observations, settlement_periods as imported). Each live order becomes one order with one item; the real items are stored later by reconciliation without recomputing stored amounts (AD-8). Stored cashback is kept even where the live formula differs (D34). Realises FR-33. Follows AD-4, AD-5, AD-24. Decisions: D4, D34. Invariant INV-2.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 2.2.
**Size:** M

**Acceptance criteria**
1. Given a live order with `paid_at` set, when it is imported, then the new order is PAID with the same `paid_at` (converted by Story 2.1) and the same stored cashback.
2. Given a live order with a stored amount that the new split would compute differently, when it is imported, then the stored amount is kept unchanged and the report lists the difference.
3. Given a live order whose status maps to no new status, when it is imported, then it is listed in the import report, not guessed.
4. Given each imported order, when the import finishes, then it has exactly one order item and one history row with actor "cutover".
5. Given a guest (HOUSE) live order, when it is imported, then its cashback is 0 and it stays owned by HOUSE.

### Story 2.4: Import payouts, receipts and campaign awards with paid parity to the dong

As the owner, I want every payout, receipt token and campaign award imported and the paid total per customer checked to the dong, so that I can trust the new ledger before anything is paid from it.

**Context:** Creates payouts, payout_items, ledger_entries (insert-only), campaigns and campaign_awards. Bill tokens keep working as receipt links. Paid parity: each customer's paid total in the new ledger equals the live total to the dong; a mismatch blocks the import report's "pass". Realises FR-33, FR-18 (old receipt links). Follows AD-4, AD-6, AD-17, AD-24. Decisions: D4, D35, D44.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 2.3.
**Size:** M

**Acceptance criteria**
1. Given the source copy, when the import finishes, then for every customer the sum of imported payouts equals the live paid total to the dong, and the report shows "paid parity: pass" only when all match.
2. Given one deliberately altered payout in a test fixture, when parity runs, then the report shows "fail" with that customer and the difference in dong.
3. Given a live bill token, when it is imported, then it is stored unchanged and resolves to its payout.
4. Given a live campaign with awards, when it is imported, then the campaign window uses the Vietnam-time rule of Story 2.1 and every award keeps its order and state.
5. Given the ledger entries table, when any code tries to update an imported entry, then the insert-only trigger rejects it.

### Story 2.5: Import link requests and share codes and seed the already-sent notifications

As the owner, I want old share links to keep working and every notification the live system already sent to be marked as sent, so that the first day after cutover sends no duplicate Zalo message.

**Context:** Creates link_requests, share_codes and product_offers as imported, and the messaging `outbox` with its unique dedup key `<entity>:<id>:<event>` and `messaging.enqueue()` that is a no-op on a duplicate key. Live 8-character share codes are kept. QUEUED live link requests and unsent live notifications are imported or listed. Realises FR-33, FR-6 (old links). Follows AD-14, AD-16, AD-24. Decisions: D46.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 2.2.
**Size:** M

**Acceptance criteria**
1. Given a live share code of 8 characters, when it is imported, then it is stored unchanged with its link request and owner.
2. Given every (entity, event) the live system already notified, when the import runs, then an outbox row with that dedup key exists marked as already sent, and enqueueing the same key later is a no-op.
3. Given live link requests still QUEUED, when the import runs, then each is imported as QUEUED or listed in the report, and none is lost silently.
4. Given unsent live notifications, when the import runs, then each is imported as due or listed, and the report counts both.
5. Given a guest (HOUSE) link request, when it is imported, then it keeps HOUSE as owner and no outbox row is created for it.

### Story 2.6: Order transition function in the pure domain

As the reconciliation run, I want one pure function that gives the next order state and its effects for each observation, so that reconciliation, review apply and payout void can never disagree on a transition.

**Context:** `orders/domain/transition.ts` exports `transition(order, observation, context) -> { next, effects }`; the observation carries normalized statuses (AD-22). It applies the cancel precedence, FROZEN on unknown status or missing order id, REVERSED for a cancel after approval before payout, a clawback effect for PAID, protection under an OPEN payout claim, the D55 commission drop, and REJECTED to AWAITING_APPROVAL only through a review case. Moved from Epic 3 because the shadow run needs it (adjustment A1). Realises FR-12, FR-14. Follows AD-7. Decisions: D4, D30, D31, D38, D39, D55.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 1.8, Story 1.11.
**Size:** M

**Acceptance criteria**
1. Given an AWAITING_APPROVAL order and an observation whose order status is APPROVED with commission above 0, when `transition` runs, then the next state is APPROVED with an effect "store cashback"; and with order status CANCELLED and an item APPROVED, then the next state is REJECTED (order status wins, golden).
2. Given a PAID order and any cancel signal, when `transition` runs, then the order stays PAID and the effects are a clawback and a review case (D4, D30).
3. Given an APPROVED unpaid order covered by an OPEN payout claim and a cancel observation, when `transition` runs, then the state is unchanged and the effect is "store observation, apply after claim" (D39).
4. Given an APPROVED unpaid order whose approved commission drops but stays above 0, when `transition` runs, then the next state is FROZEN with a review case; for a PAID order the effect is a partial clawback (D55).
5. Given an unknown status or a missing order id, when `transition` runs, then the next state is FROZEN with a review case; and given a transition absent from the status-flows table, then it throws.
6. Given a REJECTED order and a review-case context whose latest observation has no cancel signal, when `transition` runs, then the next state is AWAITING_APPROVAL; without the review-case context it stays REJECTED (D38).

### Story 2.7: Attribution rule resolves the owner of a report row

As the reconciliation run, I want one pure rule that finds the customer of a report row from sub_id1, aliases and the sub_id2 request owner, so that an order is credited only to the customer whose link it came from.

**Context:** sub_id1 is resolved through aliases; else the owner of the sub_id2 link request; when both exist and disagree, or neither resolves, the result is a review case. HOUSE stays HOUSE and never moves to a customer. A `DEV`-prefixed sub_id1 never resolves in production. Realises FR-12, FR-3. Follows AD-8, AD-23, AD-25. Decisions: D5, D6, D7. Invariant INV-1.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 1.10.
**Size:** S

**Acceptance criteria**
1. Given a row with sub_id1 equal to a retired customer id that is an alias of a survivor, when attribution runs, then the survivor is returned.
2. Given a row with no sub_id1 and a sub_id2 that names a link request of customer A, when attribution runs, then A is returned.
3. Given a row whose sub_id1 resolves to A and whose sub_id2 request belongs to B, when attribution runs, then the result is a review case "owner disagreement" and no customer is returned (golden).
4. Given a row with sub_id1 `DEV...` in production configuration, when attribution runs, then the result is a review case, never a customer.
5. Given a row attributed to HOUSE, when attribution runs, then HOUSE is returned and the effect carries cashback 0.

### Story 2.8: Report sources for the shadow run read AccessTrade and a Shopee export

As the owner, I want the shadow run to read the real network reports without touching the affiliate browser, so that parity is measured on real data while the live system keeps running.

**Context:** A `ReportSource` yields normalized `ReportRow`s (network, order id, items, mapped statuses, commissions in dong through `fromNetworkUnits`, sub_ids, fingerprint). AccessTrade is read through its API, read-only. Shopee is read from the operator's report export file (decision H10), so no bridge or Shopee call is made. A read that hits the page cap or the 90-day edge fails loudly and freezes nothing. Realises FR-12. Follows AD-8, AD-22. Decisions: D8, D43. Invariant INV-10.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 1.11.
**Size:** M

**Acceptance criteria**
1. Given an AccessTrade API response fixture, when the source reads it, then each transaction becomes one `ReportRow` with commissions in whole dong and a stable fingerprint.
2. Given a Shopee export file fixture with several items per order, when the source reads it, then rows are grouped per order with every item kept and statuses mapped by Story 1.11.
3. Given a read that reaches the page cap, when the source runs, then it fails with `report_page_cap` and yields no partial set to the caller.
4. Given the same input read twice, when fingerprints are compared, then they are identical; a changed status changes the fingerprint.
5. Given the Shopee source, when it runs, then no network call to a Shopee host is made (test with the network blocked).

### Story 2.9: Shadow reconciliation produces a per-order parity report for sign-off

As the owner, I want a shadow run of the new reconciliation over the imported ledger that lists every order whose state or amount would change, so that I sign off the differences instead of importing live defects as payable.

**Context:** Runs attribution (Story 2.7) and `transition` (Story 2.6) over the full report window against the imported ledger copy, in memory or on a scratch copy, writing nothing to the source. "Live payable" is one named SQL in the cutover tool. Orders the report can no longer verify are listed as would-be FROZEN with a review case. The report is a file the owner signs off; the sign-off is recorded with name and time. Realises FR-33, FR-12. Follows AD-24, AD-8. Decisions: D44, D46. NFR-1.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 2.4, Story 2.5, Story 2.6, Story 2.7, Story 2.8.
**Size:** M

**Acceptance criteria**
1. Given the imported ledger and the report rows, when the shadow run finishes, then the report lists per order the current state, the expected transition, the amount difference in dong and the reason.
2. Given a live order cancelled by a later item that the live system kept payable (first-item-only bug), when the shadow run evaluates it, then it is listed as "would be REJECTED or REVERSED", not as payable.
3. Given the named live-payable SQL and the shadow payable per customer, when the report is built, then both figures and their difference are shown for every customer.
4. Given an imported unpaid order older than the report window, when the shadow run cannot find it, then it is listed as "would be FROZEN with review case".
5. Given the same inputs, when the shadow run is repeated, then the report is byte-identical; the source copy's checksum is unchanged after the run.
6. Given a PAID order, when the shadow run evaluates it, then it is never listed as changing state; a cancel after payout is listed only as a would-be clawback.

## Epic 3: Reconciliation and the order state machine on the ledger

The reconciliation run keeps every order's state, cashback and review cases correct every hour and
every night, idempotently, without ever touching a paid order. Spine build step 3, money part
(AD-7, AD-8, AD-13). Every story here that reads a report states how a repeated or overlapping run
leaves orders unchanged.

### Story 3.1: In-process job scheduler that never overlaps a run

As the operator, I want each background job to run inside the server, one run at a time, rescheduled after the previous run ends, so that two reconciliations can never apply the same report at once.

**Context:** `platform/jobs` with an in-memory running flag per job and a fixed delay after the previous run (links 5 s, claim expiry 60 s, health 60 s, reconcile 60 min, nightly sweep 02:00 Vietnam time, backup 03:00 Vietnam time). No `job_leases` or `job_runs` table; outcomes are log lines. Follows AD-13, AD-11. Decisions: D52.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 1.5, Story 1.3.
**Size:** S

**Acceptance criteria**
1. Given a job whose run takes longer than its delay, when the next tick comes, then no second run starts while the first is running (fake clock test).
2. Given a run that throws, when it ends, then the error is logged as `<context>.job.failed` and the job is rescheduled after its delay.
3. Given the nightly sweep, when the next run time is computed from a fixed clock, then it is 02:00 Vietnam time (19:00 UTC the previous day).
4. Given a server shutdown, when jobs are running, then the scheduler waits for the current runs to finish or times out, and starts no new run.

### Story 3.2: Audit trail and owner alert ports written by every command

As the owner, I want every business act recorded with its actor in the same transaction and every alert raised through one port, so that no money act is anonymous and alerts can be delivered later.

**Context:** The operations module implements `audit.record` (table `audit_entries`, insert-only, ids and fingerprints only) and `alert(kind, severity)` (table `alerts`; delivery to Telegram comes in Story 8.3, until then the alert is stored and logged). Every money or personal-data command takes an `Actor` (staff, customer, assistant, system job). Realises FR-29 (written), FR-30 (port). Follows AD-17, AD-27. Invariants INV-11. NFR-6.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 1.6, Story 1.10.
**Size:** S

**Acceptance criteria**
1. Given a command that writes an audit entry, when its transaction rolls back, then no audit entry remains; when it commits, exactly one entry exists with actor kind, actor id and time.
2. Given an audit payload with a bank number, holder name or phone number, when `audit.record` is called, then it is rejected by type and by a runtime check; a bank account appears only as its HMAC fingerprint.
3. Given an UPDATE or DELETE on `audit_entries`, when it is issued, then the trigger rejects it.
4. Given `alert("reconciliation_failed", "high")` called twice within the cooldown, when alerts are stored, then one alert is delivered-pending and the second is counted as suppressed.

### Story 3.3: Apply one report row to one order idempotently

As the reconciliation run, I want each report row applied to its order in its own transaction with attribution, transition, history and audit, so that running the same report twice changes nothing and a paid order is never changed.

**Context:** The orders module command: attribute (Story 2.7), `transition` (Story 2.6), write `order_observations`, history, audit and outbox rows, set `last_seen_in_report_at`, store items for an imported order without recomputing its stored amounts. A row whose fingerprint equals the last applied one for that order is skipped. Domain event `orders.order.recorded` is published for linking to mark the request CONVERTED later. Realises FR-12. Follows AD-7, AD-8, AD-1, AD-16, AD-17. Decisions: D4, D31. Idempotence: the fingerprint skip and the transition table; PAID never changes (INV-2).
**Screens:** none. **Skills:** none.
**Blocked by:** Story 2.3, Story 2.5, Story 2.6, Story 2.7, Story 3.2.
**Size:** M

**Acceptance criteria**
1. Given a new attributed row, when it is applied, then the order is created AWAITING_APPROVAL with its items, an observation, a history row, an audit entry and an outbox row "order recorded" in one transaction.
2. Given the same row applied a second time, when the command runs, then nothing is written except `last_seen_in_report_at` (fingerprint skip, golden).
3. Given a PAID order and a row with different amounts, when it is applied, then the order and its amounts are unchanged and only the effects of `transition` (clawback, review case) are written.
4. Given an imported order seen for the first time, when its row is applied, then its real items are stored and its stored cashback is not recomputed.
5. Given a row for a guest (HOUSE) link, when it is applied, then the order is owned by HOUSE with cashback 0 and no outbox row is created.

### Story 3.4: Cashback stored at approval with withheld settlement periods

As a customer, I want my cashback fixed once, from the approved commission, when my order is approved, so that the amount I see never changes afterwards.

**Context:** On the APPROVED transition the orders module calls `packages/money` with the network catalog and the settlement period's withheld setting, and stores cashback with its split inputs. A Shopee period counts as withheld unless staff unmark it; unmarking affects only approvals after it; AccessTrade is always withheld (D54). Cashback is never recomputed. Realises FR-13. Follows AD-5. Decisions: D3, D12, D20, D34, D54. NFR-1 golden tests.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 3.3, Story 1.2.
**Size:** M

**Acceptance criteria**
1. Given a Shopee order approved with commission 100,000 in a period with no mark, when it is approved, then stored cashback is 71,216 (withheld default) with fee 980 and tax 10,000 stored (golden).
2. Given the same period unmarked by staff before approval, when the order is approved after the unmark, then stored cashback is 79,216; an order approved before the unmark keeps 71,216.
3. Given an AccessTrade order approved at 50,000, when it is approved, then stored cashback is 36,000 (golden).
4. Given an approved order, when a later report repeats the same approved commission, then the stored cashback is unchanged and not recomputed.
5. Given an order whose estimated commission differs from the approved one, when it is approved, then cashback is computed from the approved commission only (D3).

### Story 3.5: Review cases opened by the reconciliation rules

As a staff member, I want a review case for every report row the system will not guess at, with its reason, so that nothing unusual is decided silently.

**Context:** Creates `review_cases` (OPEN to RESOLVED applied or dismissed). Reasons: unattributed row, sub_id1 and sub_id2 owner disagreeing, unknown status, frozen order, cancel signal on an APPROVED or PAID order, commission drop after approval, imported order the report can no longer verify. A case stores only the candidate the rules produce. One open case per order and reason. Realises FR-14, FR-12. Follows AD-7, AD-8. Decisions: D31, D38, D44, D55. Status-flows §6.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 3.3.
**Size:** M

**Acceptance criteria**
1. Given an unattributed row, when it is applied, then one OPEN case "no customer found" exists with the report row and no order is attributed.
2. Given the same unattributed row in the next run, when it is applied, then no second case is opened (idempotent by order and reason).
3. Given a cancel signal on an APPROVED order, when it is applied, then the order is REVERSED, a case opens and an owner alert is raised.
4. Given an owner disagreement, when the case is opened, then it carries the candidates the rules produce and no field allows another customer.
5. Given an unknown status, when it is applied, then the order is FROZEN, it is excluded from every total, and its campaign award is suspended, not voided (D55).

### Story 3.6: Clawback entries for a cancel after payout

As the operator, I want a cancel after payout to create a clawback the next payout deducts, so that a paid order stays paid and the money owed back is never forgotten.

**Context:** A clawback is a series of insert-only `ledger_entries` sharing one clawback id: the negative original (stored cashback plus any PAID bonus on that order, D35) and later positive netting and write-off entries; its open amount is the sum of its entries. A commission drop on a PAID order gives a partial clawback of the difference (D55). One clawback per order and cause. Realises FR-12. Follows AD-6, AD-7, AD-17. Decisions: D30, D35, D42, D55. NFR-1.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 3.3, Story 2.4.
**Size:** M

**Acceptance criteria**
1. Given a PAID order with cashback 79,216 and a paid bonus of 20,000, when a cancel signal is applied, then one clawback opens at -99,216 and the order stays PAID (golden).
2. Given the same cancel observed again in a later run, when it is applied, then no second clawback is created.
3. Given a PAID order whose approved commission drops from 100,000 to 60,000, when it is applied, then a partial clawback for the cashback difference is created, computed in `packages/money` (golden).
4. Given a clawback with entries -99,216 and +50,000, when its open amount is read, then it is -49,216, computed as the sum of entries.
5. Given an outbox row for the clawback, when it is enqueued, then its dedup key is `clawback:<id>:opened` and the customer sentence key is the status-flows §2 sentence.

### Story 3.7: Hourly reconciliation over the last 7 days with run records

As the operator, I want reconciliation to run every hour over the last 7 days and record what it did, so that orders follow the networks without me watching.

**Context:** The reconcile job (Story 3.1) reads each enabled network's `ReportSource` for the last 7 days by purchase time (AccessTrade through its API now; Shopee through the bridge in Story 5.9) outside any transaction, then applies each row (Story 3.3). Each run writes one `reconciliation_runs` row with counts. Two failed runs in a row raise the owner alert. Realises FR-12, FR-30. Follows AD-8, AD-13, AD-27. Decisions: D43. Idempotence: overlapping windows hit the fingerprint skip; PAID untouched.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 3.4, Story 3.5, Story 3.6, Story 2.8, Story 3.1.
**Size:** M

**Acceptance criteria**
1. Given a run over a window, when it finishes, then one `reconciliation_runs` row records network, window, rows read, applied, skipped, review cases opened and duration.
2. Given two consecutive runs over overlapping windows with the same report, when the second finishes, then no order, amount, history row or outbox row changed (golden).
3. Given a source that fails twice in a row, when the second failure ends, then one high owner alert `reconciliation_failed` is raised; a single failure raises none.
4. Given a source that hits the page cap, when the run ends, then the run is marked failed, no order is frozen or changed, and an alert is raised (D43).
5. Given the report fetch, when it runs, then no ledger transaction is open during the network read (test asserts no open transaction).

### Story 3.8: Nightly sweep reads every day that still holds an open order

As the operator, I want a nightly paced sweep over every day that still holds an awaiting or approved unpaid order, so that approvals 30 to 70 days after purchase are seen.

**Context:** At 02:00 Vietnam time the sweep reads, in one-day slices with a page cap per slice, every calendar day holding an AWAITING_APPROVAL or APPROVED unpaid order. A slice at its cap fails the run, freezes nothing and alerts. R5 aging: awaiting orders not seen for 14 days are flagged; over 60 days they count as aged for the Overview. Realises FR-12. Follows AD-8, AD-13. Decisions: D43. Status-flows R5, R6. Idempotence as Story 3.7.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 3.7.
**Size:** M

**Acceptance criteria**
1. Given open orders purchased on 3 different days in the last 90 days, when the sweep runs, then it reads exactly those 3 day slices and no others.
2. Given an order approved 45 days after purchase in the report, when the sweep reads its day, then the order becomes APPROVED with its cashback stored.
3. Given a slice that hits its page cap, when the sweep runs, then the run fails loudly, no order changes, and an alert is raised.
4. Given an awaiting order whose `last_seen_in_report_at` is 15 days old, when aging is computed, then it is flagged; at 61 days it is counted as aged.
5. Given the sweep and the hourly run over the same day, when both have run, then the result equals one run (idempotent).

### Story 3.9: Review case apply and dismiss commands

As a staff member, I want to apply or dismiss a review case with a reason, through the same rules reconciliation uses, so that I fix what the system would not guess without ever typing an amount.

**Context:** Apply runs attribution with the rule candidate and `transition` with the review-case context; it can never change a PAID order, attribute a guest order to a customer, choose another customer or set an amount. A wrong rejection returns REJECTED to AWAITING_APPROVAL only when the latest observation has no cancel signal (D38). Role: admin or employee, staff session (Story 4.2 adds the HTTP route). Realises FR-14. Follows AD-7, AD-8, AD-17. Decisions: D38. Invariants INV-1, INV-2, INV-11.
**Screens:** none (screen in Story 4.15). **Skills:** cashback-security-model.
**Blocked by:** Story 3.5.
**Size:** M

**Acceptance criteria**
1. Given an OPEN "no customer found" case with a rule candidate, when staff apply it with a reason, then the order is attributed to that candidate in AWAITING_APPROVAL (or the state the report gives), and the case is RESOLVED applied with staff, time and reason.
2. Given a case on a PAID order, when staff apply it, then the command refuses with `order_paid` and nothing changes.
3. Given a guest order, when staff try to apply it to a customer, then the command refuses with `guest_order`.
4. Given a REJECTED order whose latest observation shows no cancel signal, when a "wrong rejection" case is applied, then the order returns to AWAITING_APPROVAL; with a cancel signal, the command refuses.
5. Given any case, when it is dismissed without a reason, then the command refuses; with a reason, the case is RESOLVED dismissed and the order is unchanged.
6. Given a preview call before apply, when it runs, then it returns the resulting order state without writing anything.

## Epic 4: Payout path and admin desk

The operator can see who is owed, pay each customer once with a QR and a receipt, void a mistake,
clear review cases and find any customer or order, on lists that follow the List Contract on phone,
tablet and desktop. Spine build step 3 (payout screens) plus the v1 admin desk of AD-28. Every
action here is staff-only; admin-only actions are named.

### Story 4.1: One payable definition returns balances for any customer

As the operator, I want payable, waiting, paid and deducted-next amounts computed by one query, so that the payout list, the QR, the customer page, chat and the website always agree.

**Context:** The payouts module query `getBalances(customerIds)`: `gross = sum of stored cashback of APPROVED orders with paid_at null + sum of CONFIRMED bonuses`; `payable = max(0, gross - open clawbacks)`; returns payable, waiting, paid and `deductedNext`, resolved over the customer and its aliases. FROZEN and REVERSED count nowhere; HOUSE never appears. SQL may SUM stored integers; any other arithmetic is in `packages/money`. Realises FR-15, FR-16, FR-38. Follows AD-6, AD-5, AD-10. Decisions: D11, D27, D42. NFR-1.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 3.6, Story 2.4.
**Size:** M

**Acceptance criteria**
1. Given a customer with two APPROVED unpaid orders (79,216 and 36,000) and a CONFIRMED bonus of 20,000, when `getBalances` runs, then payable is 135,216 (golden).
2. Given the same customer with an open clawback of -49,216, when `getBalances` runs, then payable is 86,000 and `deductedNext` is 49,216; with a clawback of -200,000, payable is 0, never negative.
3. Given a customer with an AWAITING_APPROVAL, a FROZEN and a REVERSED order, when `getBalances` runs, then only the awaiting order's estimate appears, in waiting, and the other two count nowhere.
4. Given a merged customer whose orders sit under the old id, when the survivor's balance is read, then the old id's orders are included through aliases.
5. Given HOUSE, when `getBalances` is asked for it, then it returns no balance and HOUSE is excluded from every payable list.

### Story 4.2: Staff sign in on the admin host behind Cloudflare Access

As a staff member, I want to sign in on the admin host with my staff account, so that only staff reach the admin desk and admin-only actions need the admin role.

**Context:** Creates `staff` and `sessions` (customer and staff kinds, token stored as SHA-256 hash). Staff are seeded by Story 4.20; the root admin cannot be demoted. The staff route group is registered only for `Host` = the admin host and every staff route verifies the `Cf-Access-Jwt-Assertion` JWT (team domain and audience from config) plus the staff session. Passwords use argon2id. Realises FR-24 (roles), NFR-5. Follows AD-18, AD-19. Decisions: D48. Invariants INV-8.
**Screens:** none beyond the admin sign-in form (W4 shell). **Skills:** cashback-security-model, cashback-shadcn.
**Blocked by:** Story 1.5, Story 1.10, Story 3.2.
**Size:** M

**Acceptance criteria**
1. Given a request to `hoantiendp.com/api/admin/payouts`, when it reaches the server, then it returns 404, because staff routes exist only for the admin host.
2. Given a request on the admin host without a valid Access JWT (wrong audience, expired or missing), when it reaches a staff route, then it returns 401 even with a valid staff session.
3. Given a valid Access JWT and a customer session cookie, when a staff route is called, then it returns 401; staff and customer cookies are separate (HttpOnly, Secure, SameSite=Lax).
4. Given an employee session, when an admin-only action (payout void, forced erase) is called, then it returns 403 checked on the server.
5. Given a successful sign-in, when the session is stored, then only the SHA-256 hash of the 32-byte token is in the database, and the sign-in is in the audit trail.

### Story 4.3: List contract on the server with defineList

As a staff member, I want every list endpoint to filter, sort, search and paginate on the server over the full set, so that counts, totals and rows always describe the same records.

**Context:** `platform/list/defineList()` names each field once (column key = sort key = displayed value), its search fields, facets and summary, and generates the Zod query schema (`q`, `filter[<field>]`, `sort=<field>:<asc|desc>`, `page`, `pageSize`). Response `{ rows, total, page, pageSize, facets, summary, asOf }`, page clamped, facets and summary over the same filtered set, search over stored `search_text`. Realises FR-37, FR-38. Follows AD-12, AD-20, code.md §6. Regression tests for list-defects root causes 3, 6, 7, 8.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 1.9, Story 1.8, Story 1.4.
**Size:** M

**Acceptance criteria**
1. Given a list spec and 41 rows with `pageSize=20&page=3` after a filter leaves 40 rows, when it is queried, then the server returns page 2 with "21 to 40 of 40" data and never page 3 (regression "41 - 40 of 40").
2. Given a filter, when the response is built, then `total`, `facets` and `summary` are computed over the same filtered set as `rows`, and no count is capped.
3. Given a sort on a field, when rows are returned, then they are ordered by exactly that field's stored value; a field not declared sortable is rejected with `invalid_sort`.
4. Given `q=nguyen%`, when it is queried, then it matches `search_text` with the wildcard escaped and never searches raw JSON.
5. Given a status sort, when rows are returned, then they follow registry lifecycle order; and a date sort orders by instant.

### Story 4.4: Admin desk shell on the design tokens

As a staff member, I want the admin desk to open with its navigation on phone, tablet and desktop, so that I can reach every daily screen from any device.

**Context:** `apps/admin` Vite SPA rebuilt on `packages/ui` (shadcn/ui with the DESIGN.md tokens generated once), TanStack Router and Query. Sidebar groups "Hằng ngày", "Khách", "Quản trị" on desktop, icon rail on tablet, bottom tabs plus "Thêm" on phone; admin-only items hidden for employees. Labels from `resources/dashboard.vi.json` by key. Realises NFR-2, NFR-7. Follows AD-21, code.md §10. UX-DR1, UX-DR4, UX-DR13, UX-DR14.
**Screens:** W0 Components (admin sidebar and phone tabs), W4 Today shell (desktop, tablet, phone), W7 not found. **Skills:** cashback-shadcn, cashback-design-craft, cashback-ui-review.
**Blocked by:** Story 4.2.
**Size:** M

**Acceptance criteria**
1. Given a signed-in employee on desktop, when the shell renders, then the sidebar shows the three groups and hides Staff and Campaigns; an admin sees them.
2. Given a phone at 390 px, when the shell renders, then the bottom tab bar shows "Tổng quan", "Chuyển tiền", "Đơn", "Khách" and "Thêm", with 44 px targets and safe-area padding.
3. Given a tablet at 820 px, when the shell renders, then navigation is an icon rail with tooltips and focus is always visible.
4. Given an employee opening an admin-only URL directly, when it renders, then the page shows "Chỉ quản trị viên xem được trang này." from the label file.
5. Given the built bundle, when it is scanned, then it contains no secret, no Vietnamese literal outside the imported label file, and no import of `packages/money`.

### Story 4.5: DataList renders every list with URL state

As a staff member, I want every list to keep its search, filters, sort and page in the URL and to show loading, empty, error and stale states distinctly, so that refresh or a shared link restores the same view and an error is never shown as "no rows".

**Context:** One `DataList` in `packages/ui` over TanStack Table, bound to a TanStack Router search schema generated from the list contract. Table on tablet and desktop, stacked cards on phone (LC-12), sort Select and filter bottom sheet on phone. Realises FR-37. Follows AD-12, AD-21. UX-DR2, UX-DR3, UX-DR13. Regression tests for list-defects root cause 8 and "sortable headers that do nothing".
**Screens:** W5 list states (loading, no matches, error), phone filter sheet; W0 filter chips, status badges, money figures. **Skills:** cashback-shadcn, cashback-ui-review.
**Blocked by:** Story 4.3, Story 4.4.
**Size:** M

**Acceptance criteria**
1. Given a list with a search, two filter chips and a sort, when the page is refreshed or the URL is opened in a new tab, then the same rows, chips and sort are shown; defaults are omitted from the URL.
2. Given typing in search, when keys are pressed, then one request fires 300 ms after the last key (Enter fires at once), previous rows stay dimmed with the progress line, and a late response for an older query is discarded.
3. Given a request that fails, when the list renders, then it shows "Không đọc được danh sách" with retry and keeps previous rows marked stale; it never shows the empty-list text.
4. Given a column without a sortable field, when it renders, then it has no sort affordance; sortable headers are buttons with `aria-sort`, chips carry `aria-pressed` and their count.
5. Given a phone at 390 px, when the list renders, then rows are cards (identity and status first, amount right, one labelled date), filters open in a bottom sheet with the same counts, and the page never scrolls sideways.
6. Given a changed filter chip, when it is toggled, then the page resets to 1 and the live region announces the new count.

### Story 4.6: Payouts list shows who can be paid and who needs action

As the operator, I want the Payouts screen to list every customer with a payable balance, bank, settlement facts and flags, so that I see in one place who I can pay now and who needs action first.

**Context:** Tabs "Chuyển được" (payable now) and "Cần xử lý" (no bank, held website bank change, bank changed in 72 hours, shared bank account flag, the only FR-31 flag in v1). Amounts come only from `getBalances`; settlement is separate information. A customer whose clawbacks reach the gross shows as "netting only". A row taken by another staff member shows "<name> đang chuyển". Role: admin or employee. Realises FR-16, FR-31 (shared bank), FR-37. Follows AD-6, AD-12. Decisions: D11, D27. Regression tests for every list-defects "Payments" line.
**Screens:** W4 Payouts (desktop, tablet, phone). **Skills:** cashback-shadcn, cashback-ui-review, cashback-design-craft.
**Blocked by:** Story 4.1, Story 4.5.
**Size:** M

**Acceptance criteria**
1. Given customers with approved unpaid cashback, when "Chuyển được" loads, then each row's amount equals `getBalances` payable and the summary "N khách · X đ" is the sum of the same filtered set (regression "total paid counts the last 100", "cards use the unfiltered set").
2. Given a customer with only awaiting orders, when Payouts loads, then the customer is absent; there is no "show awaiting orders" toggle anywhere.
3. Given a customer without a bank account, a held website bank change, a bank change within 72 hours, or a bank account shared with another customer, when Payouts loads, then the row is in "Cần xử lý" with the matching flag badge and is never hidden.
4. Given the same customer opened on phone, tablet and desktop, when the amounts render, then they are identical (regression "desktop and phone show different amounts").
5. Given a partly settled customer, when the list loads, then they are shown with settlement as a separate fact (regression "partly settled customers are hidden").

### Story 4.7: Payout claim and preview with VietQR

As the operator, I want opening a customer's payout to claim it for me and show the server's preview with a VietQR for exactly that amount, so that two staff never pay the same person and the QR can never include unapproved money.

**Context:** Creates `payout_claims` (OPEN unique per customer, staff id, snapshot of covered order ids, bonus ids, clawback ids, amount, bank fingerprint and hold flag, snapshot hash, `qr_shown_at`, transfer reference = customer code plus a short claim id). The claim-expiry job marks a claim idle for 10 minutes ABANDONED; rows are never deleted. Opening a customer whose last claim is ABANDONED with `qr_shown_at` shows the "may have transferred" warning. A bank name that matches no single VietQR bank shows no QR. Role: admin or employee. Realises FR-16, FR-17. Follows AD-9, AD-7. Decisions: D19, D39. Invariants INV-2, INV-4. UX-DR6.
**Screens:** W4 payout panel (desktop sheet, phone drawer). **Skills:** cashback-shadcn, cashback-ui-review, cashback-security-model.
**Blocked by:** Story 4.6, Story 3.1.
**Size:** M

**Acceptance criteria**
1. Given a payable customer, when staff open the panel, then one OPEN claim is created and the preview lists the covered orders and bonuses, the total, bank, holder, masked account, transfer reference and a VietQR for exactly the total.
2. Given an OPEN claim by staff A, when staff B opens the same customer, then B sees "A đang chuyển" and no claim is created.
3. Given an OPEN claim idle for 10 minutes, when the expiry job runs, then it becomes ABANDONED and is not deleted.
4. Given a customer whose last claim was ABANDONED after its QR was shown, when the panel opens, then it warns "Có thể đã chuyển <amount> lúc <time>, kiểm tra ngân hàng trước khi chuyển".
5. Given a phone, when the panel opens, then it is a full-height drawer with the QR full width and copy buttons for account number, amount and reference; the preview does not refetch while open.

### Story 4.8: Confirm a payout once, idempotently

As the operator, I want to confirm a transfer I already made with one button, so that the covered orders become paid exactly once even if I press twice or the claim expired.

**Context:** Confirm takes only claim id, snapshot hash and an optional proof; in one `BEGIN IMMEDIATE` transaction it returns the existing payout if the claim is CONFIRMED; accepts an OPEN claim, or an ABANDONED one when no other OPEN claim exists; re-reads every covered order (APPROVED, paid_at null, owned), the bank account and the hold; recomputes the hash; on any difference writes nothing and returns `amount_changed` with a new preview. On success: payout, payout items, paid_at and history, netting of clawbacks (AD-6), audit, outbox row "payout recorded" with the receipt link, claim CONFIRMED. During the 72-hour go/no-go window confirm is refused (Story 8.8 sets the flag). Role: admin or employee. Realises FR-17. Follows AD-9, AD-6, AD-16, AD-17. Decisions: D4, D19, D32, D39, D42. Invariants INV-2, INV-3, INV-4. NFR-1 golden tests.
**Screens:** W4 payout panel, amount changed. **Skills:** cashback-shadcn, cashback-security-model.
**Blocked by:** Story 4.7.
**Size:** M

**Acceptance criteria**
1. Given an OPEN claim whose orders are unchanged, when staff confirm, then the payout is recorded, every covered order is PAID with paid_at and history, the claim is CONFIRMED, and one outbox row is enqueued (golden).
2. Given a CONFIRMED claim, when confirm is retried with the same claim id, then the same payout is returned and nothing new is written.
3. Given a covered order that became REVERSED, or a bank account or hold changed since the preview, when staff confirm, then nothing is written and the panel shows "Số tiền đã thay đổi, xem lại" with a new preview.
4. Given an ABANDONED claim with unchanged orders and no other OPEN claim, when staff confirm, then it succeeds (the transfer already left the bank).
5. Given a request body carrying an amount or an order list, when it reaches confirm, then the extra fields are rejected by the contract; there is no route that pays an awaiting or paid order.
6. Given a customer with open clawbacks below the gross, when confirm runs, then netting entries are written up to the gross and the rest carries forward (golden).

### Story 4.9: Proof image upload and the facts-only receipt page

As a customer, I want a receipt link that shows my payout's facts, so that I can trust the transfer without my bank screenshot ever being public.

**Context:** Proof images: JPEG or PNG only, re-encoded with EXIF stripped, stored in `payout_proofs` under the backed-up `data/<env>/files/`, served only to staff and to the signed-in customer with a fixed Content-Type, `nosniff` and a strict CSP. `/b/<token>` is server-rendered with no client framework: customer code, last four digits, amount, date, voided state, `noindex`. Live bill tokens keep working. Realises FR-18, FR-17 (proof). Follows AD-21, AD-26. Decisions: D49. Invariants INV-13. UX-DR12. (The DESIGN.md receipt card still lists a proof thumbnail; D49 wins.)
**Screens:** W3 receipt (phone, desktop, voided). **Skills:** cashback-design-craft, cashback-security-model, cashback-ui-review.
**Blocked by:** Story 4.8.
**Size:** M

**Acceptance criteria**
1. Given a proof upload that is a GIF, an SVG or an HTML file renamed .png, when it is uploaded, then it is refused; a JPEG with GPS EXIF is stored re-encoded without EXIF.
2. Given a receipt token, when `/b/<token>` is opened without a session, then it shows only customer code, last four digits, amount and date, carries `noindex`, and never includes the proof image or its URL.
3. Given a voided payout, when its receipt is opened, then the card shows "Đã huỷ ghi nhận" with the void date.
4. Given an unknown token, when it is opened, then a plain "Không tìm thấy biên nhận" page is returned with the same status as any missing page.
5. Given the proof URL, when it is requested without a staff session or the owner's customer session, then it returns 404; with one, it returns the image with `X-Content-Type-Options: nosniff` and the strict CSP.
6. Given an imported live bill token, when it is opened, then its payout renders.

### Story 4.10: Void a mistaken payout

As an admin, I want to void a payout recorded by mistake with a reason, so that the orders return to the state their reports give and the ledger keeps the full story.

**Context:** Admin-only command in one transaction: each covered order gets the state `transition()` gives from its latest observation (REVERSED if a cancel was seen, else APPROVED) with paid_at cleared; a clawback on that order is closed by an offsetting entry; netting entries written by the payout are reversed by offsetting entries; bonuses return to CONFIRMED, or VOID when their order is REVERSED. The payout stays as VOIDED. If the customer was told, one correction message is enqueued. Realises FR-34. Follows AD-9, AD-7, AD-17. Decisions: D24, D41. Invariants INV-2, INV-11. UX-DR7. All four void combinations golden-tested.
**Screens:** W4 void dialog. **Skills:** cashback-shadcn, cashback-security-model.
**Blocked by:** Story 4.8.
**Size:** M

**Acceptance criteria**
1. Given a payout whose orders saw no cancel, when an admin voids it with a reason, then the orders return to APPROVED with paid_at cleared, bonuses to CONFIRMED, and the payout shows VOIDED (golden combination 1).
2. Given a covered order whose latest observation is a cancel, when the payout is voided, then that order becomes REVERSED, its bonus VOID, and its clawback is closed by an offsetting entry (golden combinations 2 and 3).
3. Given a payout that wrote netting entries, when it is voided, then offsetting entries reverse them and the open clawback returns to its prior amount (golden combination 4).
4. Given an employee, or an admin without a reason, when void is called, then it is refused (403 or `reason_required`).
5. Given the dialog, when it opens, then it lists each order with the state it will return to from the server; after void, the payouts list, customer page and Overview refresh (LC-10).
6. Given a customer already told about the payout, when it is voided, then one correction message is enqueued with dedup key `payout:<id>:voided`.

### Story 4.11: Netting-only payout and clawback write-off

As the operator, I want to record a payout whose transfer is 0 when open clawbacks cover the whole payable, and an admin to write off a clawback with a reason, so that a clawback can always close.

**Context:** A netting-only payout marks the covered orders PAID, writes the netting entries, shows no QR and sends no message (outbox refuses it). Write-off is an admin-only command that adds a positive write-off entry with a reason. Realises FR-17. Follows AD-6, AD-9, AD-16. Decisions: D42. NFR-1 golden test.
**Screens:** W4 payout panel (netting-only variant). **Skills:** cashback-shadcn.
**Blocked by:** Story 4.8.
**Size:** S

**Acceptance criteria**
1. Given gross 50,000 and open clawbacks of -80,000, when the panel opens, then it shows the netting-only variant with "Xác nhận trừ nợ", no QR and transfer 0.
2. Given that netting-only confirm, when it succeeds, then orders are PAID, a netting entry of +50,000 is written, the clawback's open amount becomes -30,000, and no outbox row is created (golden).
3. Given an admin write-off with a reason, when it runs, then a positive entry closes the open amount and the audit entry names the admin and reason.
4. Given an employee calling write-off, when it reaches the server, then it returns 403.

### Story 4.12: Payout history lists every payout including voided ones

As the operator, I want a history of every payout with its receipt and void state, so that I can check what was paid and void a mistake from one place.

**Context:** The "Lịch sử" tab of Payouts on the list contract: customer code, amount, date paid, staff, voided state, receipt link; void action for admins only. Totals over the same filtered set. Realises FR-17, FR-34, FR-37. Follows AD-12. Regression "total paid counts only the last 100 transfers".
**Screens:** W4 Payouts (history tab). **Skills:** cashback-shadcn, cashback-ui-review.
**Blocked by:** Story 4.10.
**Size:** S

**Acceptance criteria**
1. Given 150 payouts, when history loads with no filter, then the total paid summary covers all 150 and is labelled as the filtered set.
2. Given a voided payout, when it is listed, then it shows the voided badge and is excluded from the paid sum, labelled so.
3. Given an employee, when history renders, then no void action is shown; an admin sees it.
4. Given a date filter "this month", when it is applied, then it uses Vietnam days and includes the whole last day.

### Story 4.13: Orders list with search, filters and sort on the list contract

As a staff member, I want to search and filter every order by id, status, network and date kind, so that I can answer any customer's question about an order in seconds.

**Context:** `GET /api/admin/orders` built with `defineList()` in `orders.list.ts` (joins customers' `search_text` read-only); one date kind per column (recorded, approved, paid); money columns are stored values. Role: admin or employee. Realises FR-26, FR-37, FR-38. Follows AD-12, AD-4. Every list-defects "Orders" line becomes an acceptance test.
**Screens:** W5 Orders (desktop, filtered, tablet, phone), list states, phone filter sheet. **Skills:** cashback-shadcn, cashback-ui-review, cashback-design-craft.
**Blocked by:** Story 4.5, Story 3.4.
**Size:** M

**Acceptance criteria**
1. Given the filter "Today" or a range ending today, when it is applied, then orders recorded on the whole Vietnam day are returned (regression "end date excludes its day", "Today returns nothing").
2. Given a sort on "commission" or "cashback", when rows are returned, then they sort by exactly the displayed approved or stored value (regression for `dashboard.py:2026` and `:2028`).
3. Given a search "nguyen" or a search containing `%`, when it runs, then Vietnamese names match without diacritics, `%` is escaped and raw estimate JSON is never searched.
4. Given the status chips, when they render, then each shows its facet count from the same filtered set, "Tất cả" shows the overall total labelled so, and only one network filter exists (regression "All (N)" and "two all-platforms filters").
5. Given an order in a past year, when it is displayed, then the date shows the year; status sorts in lifecycle order.
6. Given there is no one-click "refund" or "mark paid" action on any order row, when the screen is reviewed, then the only path to PAID is the payout confirm (regression `OrdersView.tsx:716`).

### Story 4.14: Customers list and one customer's page

As a staff member, I want to find a customer by code, name or Zalo id and open one page with their balance, orders, links, payouts and bank account, so that I answer questions and spot problems from one place.

**Context:** Customers list on the list contract; customer page reads `getBalances` (same figures as Payouts), the orders, link requests and payouts lists filtered to that customer, the bank account with its 72-hour flag and masked number, open clawbacks. Panels are keyed by customer and reset on open. Role: admin or employee. Realises FR-26, FR-15, FR-37. Follows AD-6, AD-12. Regression tests for the list-defects "Customers (admin)" and "Customer detail dialog" lines.
**Screens:** W5 Customers (desktop, phone), customer page (desktop, tablet). **Skills:** cashback-shadcn, cashback-ui-review, cashback-design-craft.
**Blocked by:** Story 4.13, Story 4.1.
**Size:** M

**Acceptance criteria**
1. Given a search by Zalo id, code or name without diacritics, when it runs, then the customer is found on the list (regression "search does not cover the Zalo id").
2. Given a customer, when the list row, the customer page and the Payouts row are compared, then the payable amount is identical (regression "list and detail dialog use different formulas", "ready counts unsettled orders").
3. Given the code column, when it is sorted, then it sorts by customer code, not Zalo id; "has bank" uses the shared definition.
4. Given staff open customer A then customer B, when B's page renders, then no amount or panel state from A is shown (regression `UserDetailDialog.tsx:85`).
5. Given a bank change within 72 hours, when the page renders, then the flag shows with the change time and the account shows only `•• 1234`.
6. Given a tablet, when the page renders, then secondary columns move behind the "Cột" menu and the figures are unchanged.

### Story 4.15: Review cases screen with apply and dismiss

As a staff member, I want a review queue where I open each case, see the report row and the rule's candidate, and apply or dismiss it with a reason, so that I clear the queue in minutes without guessing.

**Context:** Review list on the list contract (chips by reason, oldest first) and the review case panel (read-only report row, candidate customer with recent orders, the system's reason), using the commands of Story 3.9 with server preview. Role: admin or employee. Realises FR-14, UJ-6, FR-37. Follows AD-7, AD-12. Decisions: D38. UX-DR7.
**Screens:** W5 review with side panel. **Skills:** cashback-shadcn, cashback-ui-review.
**Blocked by:** Story 3.9, Story 4.5.
**Size:** M

**Acceptance criteria**
1. Given open cases, when the queue loads, then chips show counts per reason from the same set and rows are oldest first.
2. Given a case, when the panel opens, then the report row is a read-only key/value list and there is no field that edits an amount or picks another customer.
3. Given "Áp dụng" with a reason, when staff confirm, then the panel first shows the server's resulting state ("Đơn sẽ thuộc DP00031, Chờ sàn duyệt") and, after confirm, the case leaves the open list and the counts, Overview tile and customer page refresh.
4. Given an apply the server refuses (paid order, guest order), when it returns, then the panel shows the reason from the label file and the case stays open.
5. Given an empty queue, when it loads, then it reads "Không có ca nào cần xem."; on phone the panel is a drawer.

### Story 4.16: Erase a customer's personal data

As a staff member, I want to erase a customer's personal data at their request while keeping the ledger, so that we respect the privacy law without breaking any payout or attribution.

**Context:** Identity command: refused while the customer is owed money (payable or waiting above 0) unless an admin forces it with a reason; clears name, Zalo ids, bank account, password, `search_text` and `sort_key`; keeps orders, payouts, ledger and audit under the permanent customer id; the record becomes ERASED, earns nothing further and receives no messages; its old links still attribute to it. Role: admin or employee; force is admin-only. Realises FR-35, NFR-6. Follows AD-17, AD-23. Decisions: D13, D26. UX-DR7.
**Screens:** W5 customer page (danger zone, erased state). **Skills:** cashback-shadcn, cashback-security-model.
**Blocked by:** Story 4.14.
**Size:** S

**Acceptance criteria**
1. Given a customer with payable 79,216, when an employee erases them, then the command refuses showing the owed amount; an admin with a reason can force it.
2. Given an erase, when it commits, then personal columns, `search_text` and `sort_key` are empty, and orders, payouts and ledger entries are unchanged under the same customer id.
3. Given an order later reported on an erased customer's old link, when it is applied, then it is attributed to the erased record with cashback 0 and no outbox row.
4. Given the customer page of an erased customer, when it renders, then the header reads "Đã xoá dữ liệu" with the date, personal fields show the dash and every action is disabled.

### Story 4.17: Overview shows what needs the operator now

As the operator, I want one landing screen with my to-dos, the business state, aged orders and system health, so that I know in a glance what needs me today.

**Context:** Three to-dos (customers to pay with amount, open review cases, failed links), three state figures (what networks still owe us, what we keep this month, cancellation rate with change; SQL SUM over stored integers, ratios in `packages/money`), orders awaiting over 60 days (R5), one quiet metrics line (FR-27 marked "Chưa đủ dữ liệu" below 100 approved orders), and the health line fed by the one health model (components not yet reporting show "not known yet"). Role: admin or employee. Realises FR-25, FR-27 (line), FR-38. Follows AD-5, AD-27. Regression tests for every list-defects "Dashboard" line. UX-DR8.
**Screens:** W4 Today (desktop, tablet, phone); W6 Overview dashboard. **Skills:** cashback-shadcn, cashback-design-craft, cashback-ui-review.
**Blocked by:** Story 4.6, Story 4.15, Story 3.8.
**Size:** M

**Acceptance criteria**
1. Given 8 payable customers, when the Overview loads, then the tile reads "8 khách chờ chuyển · <sum>" with the same definition as Payouts and links to it with its filter in the URL.
2. Given the clock at 06:30 Vietnam time, when "this month" and "today" figures are computed, then they use the Vietnam day (regression "today and month in UTC").
3. Given fewer than 100 approved orders, when the metrics line renders, then values are muted with "Chưa đủ dữ liệu", and no fallback or placeholder number is ever shown (regression "37 members, 15.2%").
4. Given a period change, when the new figures load, then the old figures are dimmed, not shown under the new label (regression "all-time numbers under the new period label").
5. Given HOUSE, when top figures are computed, then HOUSE is excluded and its orders count 0 cashback.
6. Given a down component in the health model, when the health line renders, then it shows a dot plus a word and a link to the runbook step.

### Story 4.18: Settings: mark a Shopee settlement period withheld or not

As a staff member, I want to unmark a Shopee settlement period that turned out not withheld, so that orders approved afterwards get the cashback without the 10% tax.

**Context:** Settings screen row per Shopee settlement period with the switch "Sàn đã khấu trừ thuế kỳ này" (on by default, D54); changing it shows the server's count of orders it affects (approvals after the change only) and asks once; AccessTrade periods show "Luôn khấu trừ". Stored amounts are never recomputed. Role: admin or employee; recorded with actor. Realises FR-13. Follows AD-5, AD-17. Decisions: D54. UX-DR7.
**Screens:** W6 settings (withheld periods). **Skills:** cashback-shadcn.
**Blocked by:** Story 3.4, Story 4.4.
**Size:** S

**Acceptance criteria**
1. Given a Shopee period, when the settings load, then it shows as withheld by default; AccessTrade periods are shown as always withheld and are not editable.
2. Given staff unmark a period, when they open the confirmation, then it shows the server's count of future approvals affected and states that already-approved orders keep their amount.
3. Given the unmark is confirmed, when an order of that period is approved later, then its cashback has no tax (ties to Story 3.4 golden), and the audit entry names the staff member.
4. Given a save that fails, when the server answers, then the switch returns to its stored state with the error from the label file.

### Story 4.19: Customer merge by admin command with preview and apply

As an admin, I want to merge two duplicate customers through a command that previews the result first, so that a changed Zalo account does not split a customer's money.

**Context:** An identity command reached through the internal CLI (decision H8) with preview then apply: refuses different bank accounts; in one transaction marks the merged customer MERGED and records it as an alias of the survivor; moves no order, award or ledger entry; balances, lists and attribution resolve through aliases. The merge UI is after cutover (Story 9.5). Role: admin. Realises FR-11. Follows AD-23, AD-6, AD-17. Decisions: D42. Invariant INV-1.
**Screens:** none (CLI). **Skills:** cashback-security-model.
**Blocked by:** Story 4.1, Story 3.2.
**Size:** M

**Acceptance criteria**
1. Given two customers with different bank accounts, when merge is previewed or applied, then it refuses naming the difference.
2. Given a valid pair, when merge is previewed, then it shows both customers, the survivor and the resulting balances from `getBalances`, and writes nothing.
3. Given apply, when it commits, then the merged customer is MERGED, an alias row points to the survivor, no order row changed, and the survivor's balance equals the sum of both previews (golden).
4. Given a later report row with the merged customer's id in sub_id1, when it is applied, then it attributes to the survivor.
5. Given the CLI without an admin staff token, when it is called, then the internal listener refuses it.

### Story 4.20: Seed staff accounts and create a campaign by admin command

As the owner, I want to seed the staff accounts and, if one must run at cutover, create a campaign by command, so that the desk works without the staff and campaign screens that come after cutover.

**Context:** Internal CLI commands (decision H8): seed staff (root admin cannot be demoted; employees with argon2id passwords), reset a staff password, create a campaign with window typed in Vietnam time and shown back as "đến trước 00:00 ngày 15/11" (end exclusive), slots, bonus, minimum value, networks, per-customer cap and exclusions. Imported awards are honoured by `getBalances`; slot allocation mechanics wait for their own AD (Story 9.4). Role: admin. Realises FR-24, FR-23 (command). Follows AD-11, AD-18, AD-28. Decisions: D22, D53.
**Screens:** none (CLI). **Skills:** cashback-security-model.
**Blocked by:** Story 4.2.
**Size:** S

**Acceptance criteria**
1. Given the seed command, when it runs on an empty staff table, then the root admin and the listed employees exist and a rerun changes nothing.
2. Given a command to demote or disable the root admin, when it runs, then it refuses.
3. Given a campaign created with end "15/11/2026 00:00" Vietnam time, when it is read back, then the stored end is 2026-11-14T17:00:00.000Z and the preview reads the exclusive end.
4. Given a campaign create without the admin role, when it is called, then it is refused, and every command writes an audit entry.

## Epic 5: Link issuing, browser bridge and share page

A customer's link request becomes an affiliate link that carries only that customer's id, created
through the operator's real browser for Shopee or the AccessTrade API for TikTok Shop, and opened
through the share page in a real browser. Spine build step 4 (AD-14, AD-22). Every story here that
makes or reuses a link says whose sub_id1 it carries.

### Story 5.1: Link request to share link through the fake bridge (tracer bullet)

As a customer, I want a product link I send to become my own affiliate link with a share code, so that my purchase is credited to me.

**Context:** The thin end-to-end slice the story guide calls the walking skeleton (adjustment A3): `POST /internal/link-requests` (assistant token) creates a QUEUED link request; the link job claims the oldest by priority (Zalo, web, HOUSE) and creates one `bridge_jobs` row for one customer; the fake bridge returns a link; the request becomes ISSUED with a new 10-character base62 share code. sub_id1 = the requesting customer's id, sub_id2 = the request id (D47); in dev sub_id1 carries the `DEV` prefix. Uses an imported or seeded customer. Realises FR-1, FR-7. Follows AD-14, AD-15, AD-25. Decisions: D6, D7, D47. Invariant INV-1.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 2.5, Story 3.1, Story 1.11.
**Size:** M

**Acceptance criteria**
1. Given a known customer and a Shopee product URL, when the assistant posts a link request with its token, then a QUEUED request exists and, after the link job and the fake bridge run, it is ISSUED with a share code of 10 base62 characters.
2. Given the bridge job, when it is created, then it carries exactly one customer with sub_id1 = that customer's id and sub_id2 = the request id, both `[a-zA-Z0-9]+`.
3. Given requests from Zalo, web and HOUSE queued together, when the link job claims work, then the Zalo request is served first.
4. Given dev configuration, when the link is created, then sub_id1 starts with `DEV`.
5. Given a request without the assistant token, when it reaches `/internal/link-requests`, then it returns 401.

### Story 5.2: Link reuse only for the same customer and one guest link per product

As a customer, I want a repeat request for the same product to give me back my own link, and never anyone else's, so that my purchase can only be credited to me.

**Context:** Reuse looks up the same customer's own link for the same product inside the attribution window; outside it a fresh request is made with fresh rates (D23). Product facts (`product_offers`) may be shared across customers; links never are. HOUSE reuses one link per product (D5). sub_id1 of a reused link is always the requester's id, because the lookup key includes the customer id. Realises FR-5, FR-3. Follows AD-14. Decisions: D5, D6, D23. Invariant INV-1. Golden test of the 2026-09-25 production case.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 5.1.
**Size:** M

**Acceptance criteria**
1. Given customer A's issued link for product P inside the window, when A asks for P again, then A gets the same share link and no bridge job is created.
2. Given customer A's link for P, when customer B asks for P, then B gets a new request with B's own sub_id1, never A's link (golden, the 2026-09-25 case).
3. Given A's link for P older than the attribution window, when A asks again, then a fresh request is made with fresh rates.
4. Given two guest requests for P, when both are served, then they share one HOUSE link.
5. Given a request whose customer resolves through an alias, when reuse is checked, then the survivor's links are used and no other customer's link can match.

### Story 5.3: Browser bridge extension takes one job at a time over the internal API

As the operator, I want the affiliate Chrome to take link, lookup and report work one job at a time from the server, so that Shopee sees a real browser and a Zalo link is never delayed by more than one report page.

**Context:** `apps/bridge` is a Chrome MV3 extension in TypeScript, ported from `extension/` (read as reference, unchanged). It long-polls `GET /internal/bridge/next` and posts `POST /internal/bridge/results` with `X-Bridge-Token`; every wait and timeout is on the server; it keeps its tab awake and not discarded. Order of service: link, product lookup, report page. Dev uses the fake bridge or a Chrome profile never signed in to production Shopee (AD-25). Realises FR-7. Follows AD-14, AD-25. Decisions: D8, D47. Invariant INV-10.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 5.1.
**Size:** M

**Acceptance criteria**
1. Given queued link, lookup and report jobs, when the bridge polls, then it receives the link job first and only one job is outstanding at a time.
2. Given no work, when the bridge polls, then the server holds the request until work arrives or the server-side timeout ends; the extension itself never sleeps in a page script.
3. Given a call without the bridge token or with a wrong one, when it reaches the internal routes, then it returns 401 compared in constant time.
4. Given the extension source, when it is checked, then it contains no Shopee signature construction and no direct call to a Shopee internal API.
5. Given the bridge tab, when Chrome would discard it, then the extension keeps it alive (manual test step recorded in the runbook).

### Story 5.4: Returned links are checked before they are attached

As a customer, I want the server to check every link the browser returns, so that a wrong or tampered link is never sent to me.

**Context:** Before attaching a returned link the server checks its host against an allow-list (Shopee and AccessTrade domains) and, outside any transaction, resolves the short link's redirect to check it carries the request's sub_ids; a failed check drops the link and counts as a failure. `/s/<code>` can only redirect to a stored, checked link. Realises FR-7, FR-1. Follows AD-14. Decisions: D47 (review M16). Invariant INV-1.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 5.3.
**Size:** S

**Acceptance criteria**
1. Given a returned link on a host outside the allow-list, when results arrive, then it is dropped, counted as a failure and logged without the URL's query.
2. Given a returned short link whose redirect carries another request's sub_id2, when it is resolved, then it is dropped and counted.
3. Given the redirect resolution, when it runs, then no ledger transaction is open.
4. Given a correct link, when both checks pass, then it is attached and the request becomes ISSUED.

### Story 5.5: Captcha, page errors and a lost login pause or fail requests safely

As a customer, I want a link that cannot be made to fail clearly after three real attempts, so that I am told instead of waiting forever, and the affiliate account is never pushed into captcha.

**Context:** A captcha or page error is retried without counting and alerts the owner; three counted failures fail the request (FAILED) and enqueue the "link failed" notification; a redirect of the custom-link page to the login page pauses the queue, alerts the owner and points to the runbook re-login step. Realises FR-7, FR-30. Follows AD-14, AD-27. Decisions: D8.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 5.4, Story 3.2.
**Size:** M

**Acceptance criteria**
1. Given a bridge result "captcha", when it arrives, then the job is retried without counting and one owner alert `bridge_captcha` is raised within the cooldown.
2. Given three counted failures for one request, when the third arrives, then the request is FAILED and one outbox row "link failed" is enqueued for its customer (none for HOUSE).
3. Given a result "login redirect", when it arrives, then the link queue pauses, a critical alert is raised, and no further bridge job is handed out until the queue is resumed.
4. Given a paused queue, when the owner resumes it by command, then work restarts with the oldest request first.

### Story 5.6: Product lookup reads page 1 and shows the estimated cashback with an example

As a customer, I want my link reply to show the product, the price and about how much I get back in dong, so that I know the value before I buy.

**Context:** A product lookup bridge job reads page 1 of results only; `product_offers` stores the product facts. The estimated cashback is computed in `packages/money` from the estimated commission and marked as an estimate; every percentage carries an example amount. Realises FR-1, FR-7, FR-6. Follows AD-5, AD-14. Decisions: D3 (estimate never pays), D8.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 5.3, Story 1.2.
**Size:** M

**Acceptance criteria**
1. Given a lookup job, when the bridge performs it, then only page 1 is read (the job contract has no page parameter).
2. Given a product at 450,000 dong with the rates found, when the estimate is computed, then it comes from `packages/money` and is returned with an estimate flag (golden for the UJ-1 example).
3. Given an estimate with a percentage in the reply data, when it is built, then an example amount in dong is included.
4. Given a lookup that finds no rate, when the reply is built, then the estimate is absent (dash), never 0 or a placeholder.

### Story 5.7: TikTok Shop links through AccessTrade and a polite Lazada refusal

As a customer, I want a TikTok Shop link to work like a Shopee link, and an unsupported link to be refused politely, so that I know which shops earn cashback.

**Context:** The AccessTrade adapter creates the link through its HTTP API with sub1 = customer id and sub2 = request id; no bridge involved. Lazada and other networks get the refusal naming the supported networks (D17). Realises FR-1, UJ-8. Follows AD-22, AD-14. Decisions: D17, D20, D47.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 5.1.
**Size:** S

**Acceptance criteria**
1. Given a TikTok Shop URL, when the request is served, then the AccessTrade API is called with sub1 = customer id and sub2 = request id and the request becomes ISSUED.
2. Given a Lazada URL, when it is submitted, then the request is refused with `network_unsupported` and the message key that names Shopee and TikTok Shop.
3. Given an AccessTrade API error, when it occurs, then it counts as a failure under Story 5.5 rules (three counted failures fail the request).
4. Given the AccessTrade key, when logs are written, then it never appears.

### Story 5.8: Share page opens a real browser and records clicks

As a customer, I want the share link to open my phone's real browser and go to the shop, so that my purchase is attributed even when I tap it inside Zalo.

**Context:** `/s/<code>` is server-rendered with no client framework: Android in-app browsers are sent to Chrome by intent; iOS in-app shows the "open in Safari" steps with a copy-link fallback; a real browser shows product, price and estimated cashback with an example for about one second, then redirects to the stored, checked link only (never an open redirect). A guest link shows the guest warning. Clicks are recorded per visit; preview bots and HEAD are not. Live 8-character codes work. Realises FR-6, FR-3. Follows AD-21, AD-14. UX-DR12.
**Screens:** W3 share page (Android in Zalo, iPhone in Zalo, real browser, guest link); W7 not found. **Skills:** cashback-design-craft, cashback-ui-review, cashback-security-model.
**Blocked by:** Story 5.2, Story 5.6.
**Size:** M

**Acceptance criteria**
1. Given an Android Zalo in-app user agent, when `/s/<code>` is opened, then the response sends the browser to Chrome by intent to the same share URL.
2. Given an iOS Zalo in-app user agent, when it is opened, then the page shows the step "Bấm ••• rồi chọn Mở bằng Safari" and a copy-link button, and does not redirect.
3. Given a real browser, when it is opened, then the page shows product, price and the estimated cashback with an example, then redirects to the stored link; no query parameter can change the target.
4. Given a HEAD request or a known preview bot, when it is received, then no click is recorded; a GET from a browser records one click.
5. Given an imported 8-character code or an unknown code, when it is opened, then the first works and the second shows "Link này không còn dùng được" with the Zalo button.
6. Given a guest link, when it is opened, then the guest warning replaces the cashback line; the page meets WCAG 2.2 AA and `lang="vi"`.

### Story 5.9: Shopee report pages through the bridge feed reconciliation

As the reconciliation run, I want the Shopee conversion report read page by page through the bridge, yielding to link jobs, so that Shopee orders reconcile hourly without delaying a customer's link.

**Context:** The Shopee `ReportSource` creates report-page bridge jobs; between pages it yields to link jobs; the page cap per slice fails the run without freezing orders (D43). Rows are normalized through the status map (Story 1.11) and amounts through `fromNetworkUnits`. It replaces the export-file source for production runs; the file source stays for rehearsal. Idempotence as Story 3.7. Realises FR-12. Follows AD-8, AD-14, AD-22. Decisions: D8, D38, D43.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 5.3, Story 3.8.
**Size:** M

**Acceptance criteria**
1. Given a report of 3 pages and a link request arriving after page 1, when the run proceeds, then the link job is served before page 2.
2. Given a slice that hits the page cap, when the run ends, then it fails, no order changes, and an alert is raised.
3. Given the same report read in two consecutive hourly runs, when both finish, then the second changes no order (golden through the fingerprint skip).
4. Given report rows with UNPAID orders, when they are applied, then the orders stay AWAITING_APPROVAL.

### Story 5.10: Basic link requests list for staff

As a staff member, I want a list of link requests with their queue state, channel, delivery and failures, so that I can see failed links from the Overview and help the customer.

**Context:** Basic list on the list contract (the fuller product and link-request lists are after cutover, Story 9.9). Filters by state (QUEUED, ISSUED, DELIVERED, CONVERTED, FAILED) and channel; counts from facets. Role: admin or employee. Realises FR-37, FR-25 (failed links tile target), FR-7. Follows AD-12. Regression "last requested sorts by update time".
**Screens:** W6 link requests. **Skills:** cashback-shadcn, cashback-ui-review.
**Blocked by:** Story 5.5, Story 4.5.
**Size:** S

**Acceptance criteria**
1. Given failed requests, when the Overview "failed links" tile is followed, then this list opens filtered to FAILED with the same count.
2. Given the "requested" column, when it is sorted, then it sorts by request time, the displayed value.
3. Given a phone, when the list renders, then rows are cards with state badge, customer code chip and one labelled time.
4. Given a guest request, when it is listed, then the owner shows as the guest account, not as a customer.

## Epic 6: Zalo assistant and notifications

A customer can register, get links, check balance and orders, set a bank account and receive each
notification once in Zalo, at a human pace, with a silent first run after cutover. Spine build step 4
(AD-15, AD-16). Every story that sends Zalo messages states its pace; the pacer of Story 6.1 governs
all of them.

### Story 6.1: Assistant process on the internal API with a human-pace pacer

As the operator, I want the Zalo assistant to run as its own process that talks only to the server's internal API and paces every send like a person, so that the Zalo account is never locked for bulk behaviour.

**Context:** `apps/assistant` ported from the v2 attempt (pacer, message parsing, friend requests, zca adapter and their tests) onto `packages/contracts`; it never opens the database and serves no listener; it calls `/internal/*` with `X-Assistant-Token`; one Zalo session; heartbeat every 60 s; fake Zalo client in dev (D37). Pacer: human delays between sends, no bulk sends, at most 30 friend requests a day and only to people who wrote first. All text from `resources/messages.vi.json` by key. Realises FR-22, NFR-4. Follows AD-15, AD-25. Decisions: D9, D37, D52.
**Screens:** none. **Skills:** cashback-security-model, cashback-infra.
**Blocked by:** Story 1.4, Story 1.10.
**Size:** M

**Acceptance criteria**
1. Given 10 replies due at once, when the pacer sends them, then consecutive sends are separated by the configured human delay (test with a fake clock) and never sent in one burst.
2. Given 31 friend requests in one Vietnam day, when they are due, then the 31st waits for the next day; a friend request to someone who never wrote first is refused.
3. Given the assistant running, when 60 s pass, then a heartbeat reaches `/internal/assistant/heartbeat`.
4. Given the assistant source, when it is checked, then it opens no database file, binds no port and contains no Vietnamese literal outside the message file.
5. Given dev configuration, when the assistant starts, then it uses the fake Zalo client or the dev Zalo account, never the production credentials path.

### Story 6.2: Registration from Zalo assigns a customer code

As a person writing to the assistant for the first time, I want to be registered with a customer code, so that my links and money belong to me.

**Context:** The identity register command is reachable only from the internal listener: the first private message, or a product link pasted in the community group, registers the sender; group membership alone does not. The code is DP plus five digits from the counter that only goes up. Rate: the welcome reply goes through the pacer. Realises FR-8. Follows AD-23, AD-15. Decisions: D10, D25. Invariant INV-6.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 6.1, Story 2.2.
**Size:** M

**Acceptance criteria**
1. Given a first private message from an unknown Zalo id, when the assistant forwards it, then one customer is created with the next DP code and a welcome reply is paced.
2. Given the same Zalo id writing again, when it is forwarded, then no second customer is created.
3. Given someone who only joined the group, when no message or link is sent, then no customer exists for them.
4. Given any public route, when it is called with registration data, then no customer is created (the command exists only on the internal listener).
5. Given a Zalo id that is an alias of a merged customer, when it writes, then the survivor is used.

### Story 6.3: A product link pasted in Zalo gets a share link reply

As a customer, I want to paste a product link in Zalo and get back a share link with the product, price and estimated cashback, so that I can buy with cashback without leaving the chat.

**Context:** End to end: the assistant posts the link request (Story 5.1); the reply carries product name, price, estimated cashback with an example and the share link (never the raw affiliate link). If the link is not ready in time the assistant says it is on its way and delivery follows (Story 6.5). Works in the private chat and the group. Reply pace by the pacer. The link carries the sender's own sub_id1. Realises FR-1, UJ-1, UJ-8. Follows AD-14, AD-15. Decisions: D6, D17.
**Screens:** none (chat; text in `messages.vi.json`). **Skills:** none.
**Blocked by:** Story 6.2, Story 5.6, Story 5.8.
**Size:** M

**Acceptance criteria**
1. Given a Shopee link in a private chat with the bridge healthy, when the reply arrives, then it contains the product, price, "khoảng <amount>đ" and the `hoantiendp.com/s/<code>` link, within 30 seconds in the fake-bridge test.
2. Given the link not ready within the reply wait, when the wait ends, then the assistant says the link is on its way and no second request is made.
3. Given a Lazada link, when it is pasted, then the reply is the polite refusal naming the supported networks.
4. Given a link pasted in the group by a registered customer, when it is answered, then the link carries that customer's sub_id1, never the group's or another member's.

### Story 6.4: Notification outbox delivered by pull and acknowledgement

As a customer, I want each notification delivered once, even after a restart, so that I am never told twice or never told.

**Context:** Builds on the outbox of Story 2.5: `GET /internal/notifications/next` hands out one due row; `POST /internal/notifications/<id>/ack`; a row not acknowledged within 2 minutes is due again after 1, 2, 4 minutes up to 60; rows older than 7 days are dropped; a hard daily cap on proactive sends (default 150) holds rows to the next day and alerts the owner; `enqueue` refuses guests and netting-only payouts; the assistant keeps a local sent-ids file so a redelivered row is not sent twice. Pace: one row at a time through the pacer. Realises FR-21, FR-36. Follows AD-16, AD-15. Decisions: D5, D9, D46.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 6.1, Story 2.5.
**Size:** M

**Acceptance criteria**
1. Given two due rows, when the assistant pulls, then it gets one row; after its ack the next pull gives the second.
2. Given a row not acknowledged within 2 minutes, when time passes, then it is due again after 1, then 2, then 4 minutes, capped at 60 (fake clock).
3. Given a redelivered row whose id is in the local sent-ids file, when the assistant receives it, then it acks without sending.
4. Given the 151st proactive send of a Vietnam day, when it would become due, then it waits for the next day and one owner alert is raised.
5. Given a row older than 7 days, when it would be handed out, then it is dropped and counted; a guest enqueue is refused.

### Story 6.5: Link delivered once by chat or by notification

As a customer, I want a late link to reach me once, and an old forgotten link not to arrive at all, so that I am neither left waiting nor spammed.

**Context:** A link is marked DELIVERED the first time any channel hands it over; a link unclaimed after 55 s and younger than 2 hours is sent once by notification; an older undelivered link is marked delivered without a message. Pace: through the outbox and pacer. Realises FR-4. Follows AD-14, AD-16.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 6.3, Story 6.4.
**Size:** S

**Acceptance criteria**
1. Given an ISSUED link not handed over after 55 s, when the link job runs, then one notification "link ready" is enqueued with dedup key `link_request:<id>:delivered`.
2. Given the reply already handed the link over, when the 55 s check runs, then no notification is enqueued.
3. Given an undelivered link older than 2 hours, when the check runs, then it is marked DELIVERED with no message.
4. Given the link delivered by notification, when the customer asks for the same product again, then the reuse rule applies and no second notification is sent.

### Story 6.6: Order, clawback and payout notifications told once

As a customer, I want to be told when my order is recorded, approved, cancelled or clawed back and when I am paid, once each, so that I always know where my money is.

**Context:** Producers enqueue inside their own transactions with dedup keys: order recorded, order approved (with the amount and, without a bank account, the request to add one), order cancelled with reason, clawback opened, payout recorded (receipt link; never for 0 dong or netting-only), payout voided (correction). Every percentage carries an example amount; no message promises a payout date. Pace: pacer and daily cap. Realises FR-21, UJ-3, UJ-5. Follows AD-16. Decisions: D11, D35, D46.
**Screens:** none (texts in `messages.vi.json`). **Skills:** cashback-design-craft (copy).
**Blocked by:** Story 6.4, Story 4.10.
**Size:** M

**Acceptance criteria**
1. Given an order approved twice in the report, when both runs finish, then exactly one "approved" message is enqueued.
2. Given an approved order of a customer without a bank account, when the message is built, then it states the amount and asks for a bank account.
3. Given a payout recorded, when its message is built, then it carries the receipt link `/b/<token>`; a netting-only or 0 dong payout enqueues nothing.
4. Given every message key used, when the message test runs, then each exists in `messages.vi.json`, none promises a date, and every percentage has an example amount.
5. Given an erased customer or HOUSE, when an event fires for them, then nothing is enqueued.

### Story 6.7: Chat commands for balance, orders, code, bank and help

As a customer, I want /id, /sodu, /donhang, /stk and /help in Zalo, so that I can check my code, balance and orders without opening the website.

**Context:** Internal command routes called by the assistant. /sodu uses `getBalances` (the same figures as the website and payouts); /donhang lists recent orders with states in words; /donhang and /stk answer only in the private chat and are refused in groups with a pointer to the private chat; /id gives the customer code; /help lists commands. Pace: replies through the pacer. Realises FR-20, FR-15. Follows AD-6, AD-15, AD-10. Decisions: D11, D27.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 6.2, Story 4.1.
**Size:** M

**Acceptance criteria**
1. Given a customer with payable 79,216 and waiting 9,263, when they send /sodu, then the reply shows the same figures `getBalances` returns.
2. Given /donhang in the group, when it is sent, then the reply refuses and points to the private chat, showing no order.
3. Given /donhang in a private chat, when it is sent, then orders show their state from the status registry sentence and no payout date.
4. Given /id, when it is sent, then the reply is the customer code; /help lists the commands from the message file.

### Story 6.8: /matkhau issues a new password and ends other sessions

As a customer, I want /matkhau to give me a new password for the website, so that I can sign in, and anyone else signed in with my old one is signed out.

**Context:** The identity command issues 8 random characters, stores the argon2id hash and ends every other session of that customer (D21). Answered only in the private chat. Pace: one reply through the pacer. Realises FR-9, FR-20. Follows AD-18, AD-23. Decisions: D21. Invariant INV-8.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 6.2, Story 4.2.
**Size:** S

**Acceptance criteria**
1. Given /matkhau in a private chat, when it is handled, then a new 8-character random password is replied once and only its argon2id hash is stored.
2. Given two open customer sessions, when /matkhau is handled, then both sessions are ended.
3. Given /matkhau in the group, when it is sent, then it is refused with the pointer to the private chat.
4. Given the password value, when logs are written, then it never appears.

### Story 6.9: Bank account saved or changed from the Zalo private chat

As a customer, I want to send my bank, number and name in the private chat when my order is approved, so that the operator can pay me.

**Context:** /stk or a reply to the approved message: number 4 to 30 letters and digits after removing spaces and dashes; holder in upper case; the bank must match exactly one VietQR bank, otherwise the customer picks from the matches; consent time stored; confirmation with the last four digits; a change from the private chat needs no further confirmation (accepted risk in SECURITY_MODEL.md) but raises the 72-hour flag and sends a message with the new last four digits. Refused in groups. Pace: pacer. Realises FR-10, UJ-3. Follows AD-23, AD-17. Decisions: D26. NFR-6. Invariant INV-5.
**Screens:** none. **Skills:** cashback-security-model.
**Blocked by:** Story 6.7.
**Size:** M

**Acceptance criteria**
1. Given "Vietcombank 0123-456-789 nguyen thi lan" in a private chat, when it is handled, then the account is saved as number 0123456789, holder NGUYEN THI LAN, consent time set, and the reply shows only `•• 6789`.
2. Given a bank name matching two VietQR banks, when it is handled, then the reply lists both to choose from and nothing is saved.
3. Given a number of 3 characters or with letters outside the rule, when it is handled, then it is refused with the rule's message.
4. Given a bank change, when it commits, then the 72-hour flag is raised, an audit entry stores only the fingerprint, and one change message with the new last four digits is enqueued.
5. Given bank details sent in the group, when they are received, then they are refused and nothing is stored.

### Story 6.10: Quiet first run after cutover reports would-be sends

As the owner, I want the first reconciliation after the import to send nothing and list what it would have sent, so that day one cannot burst messages and lock the Zalo account.

**Context:** The server flag `messaging.silent` makes `enqueue` record would-be sends without making them due; the import seeds dedup keys (Story 2.5); the first run's report lists would-be sends per event. Turning the flag off makes only rows created after it due. Realises FR-33, FR-21. Follows AD-16, AD-24. Decisions: D46.
**Screens:** none. **Skills:** none.
**Blocked by:** Story 6.4, Story 3.7.
**Size:** S

**Acceptance criteria**
1. Given `messaging.silent` on, when a reconciliation run enqueues 40 events, then none becomes due and the run report lists the 40 would-be sends by event.
2. Given the flag turned off, when the next events are enqueued, then only those become due; the silent rows never do.
3. Given an event whose dedup key was seeded as already sent, when it is enqueued, then it is a no-op in both modes.
4. Given the flag, when it is changed, then the change is audited with the actor.

### Story 6.11: Zalo account loss keeps customers served and alerts the owner

As the owner, I want to know within 5 minutes when the assistant loses its Zalo session, and customers to keep the website, so that a Zalo lock does not stop the business.

**Context:** A missing heartbeat for 5 minutes raises the critical owner alert and sets the assistant-down state the website banner reads (Story 7.1); notifications wait while down and those older than 7 days are dropped; connecting a new Zalo account runs the merge flow (Story 4.19) because Zalo ids differ per viewing account. Realises FR-36, FR-30. Follows AD-15, AD-16, AD-27. Decisions: D9.
**Screens:** none (banner in Story 7.1). **Skills:** none.
**Blocked by:** Story 6.4, Story 4.19.
**Size:** S

**Acceptance criteria**
1. Given no heartbeat for 5 minutes, when the health check runs, then one critical alert `assistant_down` is raised and the health model reports the assistant down.
2. Given the assistant down, when notifications are due, then they wait and are delivered once it is back; rows older than 7 days are dropped and counted.
3. Given a new Zalo account connected, when the first messages arrive from known customers under new Zalo ids, then merge proposals are produced for the admin command, never automatic merges.
4. Given the heartbeat returns, when the next health check runs, then the down state clears and no further alert is raised.

## Epic 7: Customer website

A customer can sign in on the phone, see the money they are owed and every order in words, manage
the bank account, and get a link with a code or as a guest. Spine build step 5 (AD-21). Every screen
works from 360 px and inside the Zalo in-app browser; amounts come only from the server.

### Story 7.1: Customer website shell with the Zalo-down banner

As a customer, I want the website to work on my phone and inside Zalo and to tell me how to reach the operator when Zalo is down, so that I am never stuck.

**Context:** `apps/web` Vite SPA on `packages/ui` and the DESIGN.md tokens: top bar, three bottom tabs on phone ("Trang chủ", "Tiền của tôi", "Hướng dẫn"), no floating Zalo button, Zalo-down banner while the server reports the assistant down (Story 6.11) with the fallback contact path, offline strip, `lang="vi"`, labels from `resources/dashboard.vi.json`. Static files served by the public listener. Realises FR-36, NFR-2, NFR-3, NFR-7. Follows AD-21, code.md §10. UX-DR5, UX-DR13, UX-DR14.
**Screens:** W0 customer top bars and bottom tabs; W7 Zalo down banner, first-load skeleton, not found. **Skills:** cashback-shadcn, cashback-design-craft, cashback-ui-review.
**Blocked by:** Story 4.4, Story 6.11.
**Size:** M

**Acceptance criteria**
1. Given the assistant reported down, when any customer page loads, then the banner shows the fallback contact path, is not dismissible, and Zalo buttons point to the fallback.
2. Given the assistant back, when the next page loads, then the banner is gone.
3. Given a mid-range phone profile on 4G throttling, when Home loads, then it is interactive within 2 seconds (Lighthouse or Playwright trace recorded).
4. Given a phone at 360 px and the Zalo in-app browser user agent, when each tab is opened, then nothing scrolls sideways, targets are at least 44 px and the bottom bar hides while the keyboard is open.
5. Given the bundle, when it is scanned, then it imports no `packages/money`, contains no secret and no Vietnamese literal outside the label file.

### Story 7.2: Customer sign in with code and password

As a customer, I want to sign in with my customer code and the password from /matkhau, so that I can see my money on the website.

**Context:** `POST /api/session` on the public listener: argon2id check; session cookie (HttpOnly, Secure, SameSite=Lax) with a random 32-byte token stored as SHA-256; after five failed sign-ins the code waits a delay that doubles from 1 minute to 15 (`locked_until`, LOCKED derived); a burst of failures across codes raises an owner alert; every mutating public route checks Origin; Cloudflare rate-limit rules cover `/api/session` (set up in Story 8.5). Session stays valid until sign-out or a new password. Realises FR-9, NFR-5. Follows AD-18, AD-23. Decisions: D21. Invariants INV-5, INV-8. (EXPERIENCE.md's "wait 15 minutes" label is read as the doubling delay of AD-18.)
**Screens:** W2 sign in (normal, error). **Skills:** cashback-shadcn, cashback-security-model, cashback-ui-review.
**Blocked by:** Story 6.8, Story 7.1.
**Size:** M

**Acceptance criteria**
1. Given a correct code and password, when the customer signs in, then a session cookie is set and only the token's hash is stored.
2. Given five wrong passwords for one code, when the sixth attempt comes within 1 minute, then it is refused as locked; after further failures the delay doubles up to 15 minutes, and other codes are unaffected.
3. Given 50 failed sign-ins across many codes in a short window, when the threshold is crossed, then one owner alert is raised.
4. Given a POST without a matching Origin header, when it reaches the route, then it is refused.
5. Given a session ended by a new password, when the customer opens any signed-in page, then it shows "Phiên đăng nhập đã kết thúc vì có mật khẩu mới." and the sign-in form.
6. Given a phone at 360 px inside the Zalo in-app browser, when the form is used, then labels are visible, paste is allowed in the password field and errors are tied to their fields.

### Story 7.3: My money shows payable, waiting and paid amounts

As a customer, I want to see what I will be sent, what is waiting for the network and what I was already paid, so that I know exactly where my money is.

**Context:** Balance card from `getBalances` scoped to the session's customer: hero payable "Chờ chuyển cho bạn", waiting with the estimate tag, paid; the "Trừ vào lần chuyển sau" line when `deductedNext` is above 0; a sentence that there is no fixed payout date; tapping a figure filters the order list (URL state). Bank account card: normal, missing with payable above 0 ("Thêm tài khoản để nhận <amount>"), pending Zalo confirmation. Realises FR-15, UJ-2. Follows AD-6, AD-21. Decisions: D11, D27. Invariant INV-5. UX-DR9. Regression for the list-defects "Customer site" balance lines.
**Screens:** W2 My money (phone, tablet, desktop, missing bank). **Skills:** cashback-shadcn, cashback-design-craft, cashback-ui-review.
**Blocked by:** Story 7.2, Story 4.1.
**Size:** M

**Acceptance criteria**
1. Given a signed-in customer, when My money loads, then the three figures equal `getBalances` for that customer and are rendered by the one formatter (`79.216đ`).
2. Given `deductedNext` of 9,263, when the card renders, then the line "Trừ vào lần chuyển sau −9.263đ" shows and taps through to the clawed-back orders.
3. Given a request for another customer's balance with this session, when it reaches the server, then it returns only the session customer's data (scoping test).
4. Given payable above 0 and no bank account, when the page renders, then the bank card becomes the one thing to fix with a button to Account.
5. Given any text on the page, when it is checked, then no payout date or "automatic transfer" is promised (regression "automatic transfer is false").

### Story 7.4: My orders list with states in words

As a customer, I want my orders listed with their state, amount and one clear date, so that I can see each order's progress.

**Context:** The customer's own orders through the list contract (`GET /api/me/orders`), scoped to the session; order card with network, status badge from the registry, three-step order progress, cashback (estimate or approved by status), one date with its kind; rejected reason in words; tap expands history; payout rows show the proof image to the signed-in owner only. Realises FR-15, FR-37, FR-38, FR-18 (proof for owner). Follows AD-12, AD-21. Invariant INV-5, INV-13. UX-DR10. Regression for the list-defects "Customer site" lines.
**Screens:** W2 My money order list, order detail, "Không thấy đơn?" self-check. **Skills:** cashback-shadcn, cashback-ui-review, cashback-design-craft.
**Blocked by:** Story 7.3, Story 4.5, Story 4.9.
**Size:** M

**Acceptance criteria**
1. Given the list, when it renders, then each card shows one date with its kind ("Ghi nhận 12/10"), never a mix of paid, approved and recorded dates in one column (regression `MyOrders.tsx` date column).
2. Given any sort control shown, when it is used, then it changes the order on the server; no header is sortable without a field (regression "sortable headers that do nothing").
3. Given a rejected order, when it renders, then the progress bar is replaced by the rejected state with the reason in words.
4. Given the balance card's figures, when the list is filtered to their states, then the rows add up to the card, including bonuses as their own rows (regression "balance cards include bonuses rows never show").
5. Given no orders, when the list loads, then the empty text with the link to Home shows; an error shows the error state, never the empty text.

### Story 7.5: Account page manages the bank account and password

As a customer, I want to add, change or erase my bank account and change my password on the website, so that I can fix my details without chat.

**Context:** Bank form: VietQR picker (several matches shown to pick), number normalised to 4 to 30 letters and digits, holder upper-cased, consent checkbox required; a change made on the website is held until the customer confirms it in the Zalo private chat or staff verify it, carries the 72-hour flag and sends a Zalo message with the new last four digits; erase bank details with one confirmation. A chosen password has at least 8 characters and is not the customer code. Signed-in customer only. Realises FR-10, UJ-3, NFR-6. Follows AD-23, AD-17, AD-18. Invariant INV-5. UX-DR9.
**Screens:** W2 account and bank form (normal, waiting for Zalo confirmation). **Skills:** cashback-shadcn, cashback-security-model, cashback-ui-review.
**Blocked by:** Story 7.2, Story 6.9.
**Size:** M

**Acceptance criteria**
1. Given a bank change on the website, when it is saved, then the account shows "Đang chờ bạn xác nhận trên Zalo", payouts for the customer are held (the Payouts row moves to "Cần xử lý") and a confirmation message is enqueued.
2. Given the customer confirms in the Zalo private chat, when the confirmation arrives, then the hold is lifted and the 72-hour flag stays.
3. Given a password of 7 characters or equal to the customer code, when it is saved, then it is refused with the field error.
4. Given erase bank details, when it is confirmed once, then the account is removed, an audit entry with the fingerprint is written and the customer is told in Zalo.
5. Given the consent box unchecked, when the form is submitted, then it is refused; on phone the bank picker is a drawer.

### Story 7.6: Home link converter with a customer code or as a guest

As a visitor, I want to paste a product link on the home page and get a link, with my code for cashback or as a guest with a clear warning, so that I can buy even before I join Zalo.

**Context:** Public link endpoint: signed-in customers submit with their session; signed-out visitors may type an existing customer code; an unknown code returns "Không tìm thấy mã khách hàng", never a guest fallback (D10); without a code the link is a HOUSE guest link with the guest warning above it and the Zalo button as main action; quota 60 new links per hour overall and 20 per code per day, beyond it the Zalo hand-off panel (`web_busy`); the page polls while the server waits. The link carries the code's own sub_id1, or HOUSE's. Realises FR-2, FR-3, UJ-4. Follows AD-14, AD-18. Decisions: D5, D10. Invariant INV-1, INV-6. UX-DR11.
**Screens:** W1 home (phone, tablet, desktop), link result, guest link, creating link, web busy, unknown code. **Skills:** cashback-shadcn, cashback-design-craft, cashback-ui-review, cashback-security-model.
**Blocked by:** Story 7.1, Story 5.8, Story 6.5.
**Size:** M

**Acceptance criteria**
1. Given an unknown customer code, when a link is requested, then the form shows "Không tìm thấy mã khách hàng" and no link or customer is created.
2. Given no code, when a link is requested, then the result shows the guest warning above the link with the Zalo button first, and the link's owner is HOUSE.
3. Given the 21st request for one code in a Vietnam day, or the 61st request in an hour overall, when it is made, then the Zalo hand-off panel replaces the result and no retry button is offered.
4. Given a valid code, when the link is ready, then the result card shows product, price, "khoảng <amount>đ" with the estimate tag and the share link with "Mở link mua hàng" and "Chép link".
5. Given a Lazada link, when it is submitted, then the server's polite refusal is shown.
6. Given the Zalo in-app browser on a phone, when the flow runs, then it completes without pop-ups or new windows.

### Story 7.7: Basic guide page with the money rules stated correctly

As a customer, I want a guide that explains the steps, the chat commands and how cashback is split with example amounts, so that I trust the amounts I see.

**Context:** The v1 guide is a basic page from the label file (the redesign is after cutover, Story 9.8): steps, the commands (/id, /matkhau, /sodu, /donhang, /stk, /help), the split with the server's example amounts (100,000 dong commission gives 79,216 dong), when cashback is not paid. The current label copy that contradicts D11 is rewritten, not reused. Realises FR-20, FR-13 (explanation), NFR-7. Follows AD-21. Decisions: D11.
**Screens:** W2 guide. **Skills:** cashback-design-craft, cashback-ui-review.
**Blocked by:** Story 7.1.
**Size:** S

**Acceptance criteria**
1. Given the guide, when it renders, then every percentage has an example amount supplied by the server, not typed in the page.
2. Given the guide text, when it is checked, then it promises no payout date and no automatic transfer.
3. Given the commands list, when it renders, then it matches the commands of Story 6.7 and 6.8.
4. Given a phone at 360 px, when the page renders, then it reflows with no sideways scroll.

## Epic 8: Operations, rehearsal and go-live

The owner can run production unattended on the Mac with a separated dev environment, daily off-site
backups that are checked, alerts and an external heartbeat, then rehearse and perform the cutover
with a 72-hour no-payout window. Spine build step 6 (AD-25, AD-26, AD-27, AD-29, AD-24 day one).
Story 8.1 can be scheduled as soon as Epic 1 is done; it is planned before the bridge and assistant
stories that need it.

### Story 8.1: Dev environment separated from production in every resource

As a developer, I want a dev environment with its own ports, database, secrets file, Zalo account or fake client and Chrome profile, so that nothing I do can touch the production Zalo account, ledger or affiliate session.

**Context:** Dev: ports 9080/9081, `data/dev/`, `~/.config/cashback/dev.env`, fake Zalo client or the dev Zalo account, fake bridge or a Chrome profile never signed in to production Shopee, no tunnel, empty `PUBLIC_BASE_URL`, `DEV` sub_id1 prefix. Start and stop scripts act only on the PIDs they recorded. Realises NFR-5, D37. Follows AD-25, AD-13. Decisions: D37. Review M11.
**Screens:** none. **Skills:** cashback-infra, cashback-security-model.
**Blocked by:** Story 1.5, Story 1.7.
**Size:** M

**Acceptance criteria**
1. Given the dev start script, when it runs, then the server binds 9080/9081 on `data/dev/` with `dev.env`, and refuses to start if pointed at a production path or production env file.
2. Given the stop script, when it runs, then it stops only the PIDs it recorded and never a process it did not start.
3. Given a dev link request, when the link is made, then its sub_id1 carries `DEV` and production attribution turns it into a review case (test from Story 2.7).
4. Given dev configuration, when the assistant and bridge start, then they use the fake clients or the dev account and profile, verified by a startup log line naming the mode.
5. Given the env files, when the repository is scanned, then no env file or credential path content is committed.

### Story 8.2: Daily and off-site encrypted backups that check their own restore

As the owner, I want the ledger and proof images backed up every day, checked by a restore, encrypted and copied to Google Drive, so that losing the Mac never loses the money records.

**Context:** The backup job (03:00 Vietnam time and before every migration): SQLite online backup of the ledger with `data/<env>/files/`, `integrity_check`, restore into a temporary file and compare row counts, encrypt with age to the owner's public key, copy to Google Drive with rclone; retention 30 daily and 12 monthly. The off-site step never gates migrations. Any failure raises a high alert and shows on the Overview. Secrets and cloudflared credentials are not in the backup. Realises FR-32, FR-30. Follows AD-26, AD-13, AD-27. Decisions: D36, D52.
**Screens:** none (health line on the Overview). **Skills:** cashback-infra, cashback-security-model.
**Blocked by:** Story 1.7, Story 3.1, Story 3.2.
**Size:** M

**Acceptance criteria**
1. Given the daily run, when it finishes, then a local copy exists that passed `integrity_check`, its restored row counts equal the live counts, and the encrypted file is on Google Drive.
2. Given an rclone failure, when the run ends, then the local copy is kept, a high alert is raised and the Overview health line shows the last good backup time.
3. Given 40 daily copies, when retention runs, then 30 daily and the monthly copies remain.
4. Given the backup file, when it is inspected, then it is age-encrypted and contains no env file or cloudflared credentials.
5. Given the proof images directory, when a backup is restored to a temporary location, then the images are present.

### Story 8.3: Telegram owner alerts and one health model

As the owner, I want alerts on Telegram only when something needs me, with cooldowns, and the same health shown on the Overview, so that I can trust silence.

**Context:** The operations module delivers stored alerts (Story 3.2) to Telegram with cooldowns (critical 5 min, high 15, warning 30). One health model (bridge, assistant, last reconciliation, last backup, queue depth) feeds the Overview health line and the alerts. Kinds: bridge stuck on captcha or error, assistant disconnected, reconciliation failing twice, backup failing, daily send cap reached, failed sign-in burst. Realises FR-30, FR-25 (health). Follows AD-27. NFR-4, NFR-6.
**Screens:** W4 Today health line. **Skills:** cashback-infra.
**Blocked by:** Story 3.2, Story 4.17.
**Size:** M

**Acceptance criteria**
1. Given a critical alert repeated 3 times in 4 minutes, when it is delivered, then Telegram receives one message.
2. Given a component down in the health model, when the Overview loads, then it shows the same state the alert reported.
3. Given an alert text, when it is built, then it contains no personal data, bank number or token.
4. Given Telegram unreachable, when an alert is due, then it is retried and the failure is logged, without blocking any command.

### Story 8.4: External heartbeat alerts when the Mac goes silent

As the owner, I want an outside checker to alert me when the server stops reporting, so that a power cut, sleep or FileVault reboot never goes unnoticed.

**Context:** The server pings the external heartbeat checker (healthchecks.io free tier or a Cloudflare Worker cron) every 5 minutes while its health model is green; the checker alerts the owner on Telegram after 15 minutes of silence. The Mac is set with `pmset` to never sleep and to restart after power failure; the runbook has the FileVault reboot step. Realises FR-30, NFR-4. Follows AD-29. Decisions: D50.
**Screens:** none. **Skills:** cashback-infra.
**Blocked by:** Story 8.3.
**Size:** S

**Acceptance criteria**
1. Given a green health model, when 5 minutes pass, then one ping reaches the heartbeat URL from config.
2. Given a red health model, when the ping is due, then no ping is sent, so the checker alerts.
3. Given the server stopped for 15 minutes in a test, when the checker evaluates, then the owner receives the Telegram alert (recorded manual test).
4. Given the runbook, when it is read, then it contains the `pmset` settings and the FileVault reboot step.

### Story 8.5: Production host services on the Mac behind the tunnel

As the owner, I want production to run as launchd services on the Mac behind the Cloudflare tunnel with Access and rate limits, so that it restarts on its own and only the public listener is reachable.

**Context:** Server, assistant and cloudflared as launchd services; the affiliate Chrome as a LaunchAgent in the logged-in GUI session with its own profile; tunnel config exposes only 127.0.0.1:8080; the admin host behind Cloudflare Access; Cloudflare rate-limiting and WAF rules on `/api/session` and the link endpoints; production env file outside the repository; start and stop act on recorded PIDs. No containers in v1. Realises NFR-4, NFR-5. Follows AD-25, AD-18, AD-19. Decisions: D37, D48, D51.
**Screens:** none. **Skills:** cashback-infra, cashback-security-model.
**Blocked by:** Story 8.1, Story 4.2.
**Size:** M

**Acceptance criteria**
1. Given the Mac rebooted and unlocked, when the login session starts, then the server, assistant, cloudflared and the affiliate Chrome start without manual steps.
2. Given the tunnel config, when it is inspected, then only 127.0.0.1:8080 is exposed; a request to the internal port from outside fails.
3. Given a request to the admin host without Cloudflare Access, when it is made, then Access blocks it; with Access and no staff session, the server returns 401.
4. Given a burst of requests to `/api/session` above the configured rate, when they arrive, then Cloudflare limits them.
5. Given the secrets, when the deployment is reviewed, then they live only in the production env file and the rotated values (D51) are not those committed on main.

### Story 8.6: Restore drill procedure

As the owner, I want a written and tested restore procedure, so that I can bring the ledger back from Google Drive on a new machine.

**Context:** Restore: stop the server, delete the `-wal` and `-shm` files with the database, put the restored file in place, run `integrity_check`, start; rebuild secrets and cloudflared credentials by hand from the password manager. A manual drill runs at cutover and once a quarter. Realises FR-32. Follows AD-26. Decisions: D36.
**Screens:** none. **Skills:** cashback-infra.
**Blocked by:** Story 8.2.
**Size:** S

**Acceptance criteria**
1. Given an encrypted backup on Google Drive, when the runbook steps are followed on a clean dev machine, then the server starts on the restored ledger and the balances equal those at backup time.
2. Given a restore without deleting `-wal` and `-shm`, when the runbook is followed, then the step order prevents it (the runbook checks for the files first).
3. Given the drill, when it is done, then its date, duration and result are recorded in the runbook log.
4. Given the quarterly schedule, when a quarter passes without a drill, then the Overview health line shows the drill as due.

### Story 8.7: Cutover rehearsal on a copy of the live database

As the owner, I want to rehearse the whole day-one sequence on a copy of the live database, so that the real cutover holds no surprise.

**Context:** On the dev or rehearsal environment: copy of the live database, import (Epic 2), paid parity, shadow diff, first reconciliation with `messaging.silent` on and its would-be-send report, old share and receipt links checked, timings recorded; a go/no-go checklist the owner signs. Realises FR-33. Follows AD-24, AD-28. Decisions: D40, D44, D45, D46.
**Screens:** none. **Skills:** cashback-infra.
**Blocked by:** Story 2.9, Story 6.10, Story 8.2, Story 4.8.
**Size:** M

**Acceptance criteria**
1. Given a fresh copy of the live database, when the rehearsal runs, then the import report, paid parity "pass" and the shadow diff are produced and the owner signs off the diff.
2. Given the first reconciliation in silent mode, when it ends, then the would-be-send report is produced and no message is sent from the rehearsal environment.
3. Given 20 sampled old share codes and bill tokens, when they are opened on the rehearsal server, then each works.
4. Given the rehearsal, when it ends, then each step's duration is recorded and the total fits the planned downtime.
5. Given any rehearsal failure, when it occurs, then the go/no-go checklist records it as "no-go" until fixed and re-rehearsed.

### Story 8.8: Go-live runbook with the 72-hour no-payout window

As the owner, I want a go-live runbook and a server-enforced 72-hour no-payout window, so that I can roll back safely if something is wrong and never pay twice.

**Context:** Day-one sequence: shadow diff signed off, secrets confirmed rotated, live stopped (server, assistant, and the old extension removed from the affiliate Chrome profile), backup, import with seeded keys, parity, first reconciliation silent, tunnel switch, no payouts for 72 hours, watch the pacer counters. A server flag refuses payout confirm until the window ends (Story 4.8); rollback is allowed only inside the window: switch the tunnel back to the untouched live system. After it the new system is final. Realises FR-33. Follows AD-24. Decisions: D40, D46, D51.
**Screens:** none (a banner on Payouts states the window end). **Skills:** cashback-infra, cashback-security-model.
**Blocked by:** Story 8.7, Story 8.5, Story 8.4.
**Size:** M

**Acceptance criteria**
1. Given the window flag on, when staff try to confirm a payout, then the server refuses with `cutover_window` and the Payouts screen shows when the window ends.
2. Given 72 hours passed, when the flag is cleared by the owner command, then confirm works and the change is audited.
3. Given the runbook, when it is followed, then each step has a check, and the old extension and live assistant are confirmed stopped before the import.
4. Given a no-go inside the window, when rollback is run, then the tunnel points back to the live system and the runbook records the time; rollback is not offered after the window.
5. Given the pacer counters, when the first day runs, then the proactive sends stay under the daily cap and are shown on the Overview.

## Epic 9: After cutover (deferred)

The deferred FRs of PRD §8.3 and AD-28, sketched only. Each is detailed with this workflow after
go-live; none is on the pay, attribute or reconcile path. Sizes are rough.

### Story 9.1: Business metrics screen

As the operator, I want the FR-27 metrics (approved orders per day, effective commission rate, valid rate, approved order value, orders per active customer per month), marked untrustworthy below 100 approved orders, so that I can steer the business. Sketch: W6 metrics; ratios in `packages/money`. **Blocked by:** Story 4.17. **Size:** M (rough).

### Story 9.2: Fraud flags beyond the shared bank account

As a staff member, I want flags for frequent bank changes, a high cancellation share and link bursts (FR-31), so that I notice abuse early. Sketch: Customers fraud filter. **Blocked by:** Story 4.14. **Size:** M (rough).

### Story 9.3: Network settlement screen

As the operator, I want the "Sàn thanh toán" tab showing what each network paid and which approved orders it settles (FR-19), never changing what is owed. Sketch: W4 Payouts tab. **Blocked by:** Story 4.12. **Size:** M (rough).

### Story 9.4: Campaign creation screen and slot mechanics

As an admin, I want to create and watch a campaign on the desk with its slot meter (FR-23, UJ-7), so that promotions need no command. Sketch: needs its own AD for slot allocation, re-evaluation and closing (review M14); W6 campaign. **Blocked by:** Story 4.20. **Size:** L (rough, likely split).

### Story 9.5: Merge proposal screen

As a staff member, I want merge proposals side by side in the review queue (FR-11), so that a Zalo account change is handled on the desk. Sketch: W5 merge dialog over the Story 4.19 command. **Blocked by:** Story 4.19, Story 4.15. **Size:** M (rough).

### Story 9.6: Staff management screen

As an admin, I want to create employees, change roles and reset passwords on the desk (FR-24). Sketch: W6 staff; root admin protected. **Blocked by:** Story 4.20. **Size:** S (rough).

### Story 9.7: Audit trail screen

As an admin, I want to search the append-only audit trail with bank accounts as fingerprints (FR-29). Sketch: W6 audit trail, list contract. **Blocked by:** Story 3.2, Story 4.5. **Size:** S (rough).

### Story 9.8: Guide page redesign

As a customer, I want the redesigned guide of the UX spine. Sketch: W2 guide. **Blocked by:** Story 7.7. **Size:** S (rough).

### Story 9.9: Product and link-request lists beyond the basic list

As a staff member, I want full product and link-request lists with their facets and counts. Sketch: W6 link requests; regression "request and order counts recomputed after sorting". **Blocked by:** Story 5.10. **Size:** M (rough).

## Final validation (step 4)

| Check | Result |
|---|---|
| Every FR (FR-1 to FR-38, FR-28 withdrawn) maps to at least one story | Pass (FR Coverage Map) |
| Every UX-DR covered by at least one story | Pass |
| Starter template | None in the spine; Story 1.1 re-bases the existing workspace |
| Tables created only by the first story that needs them | Pass: identity tables in 2.2, orders in 2.3, payouts and campaigns in 2.4, linking and outbox in 2.5, review cases in 3.5, staff and sessions in 4.2, payout claims in 4.7 |
| No forward dependency (every "Blocked by" points to an earlier story) | Pass |
| Every money story has a golden test criterion | Pass (1.2, 2.4, 2.6, 3.3, 3.4, 3.6, 3.7, 4.1, 4.8, 4.10, 4.11, 4.19, 5.6) |
| Every list story carries its list-defects regressions | Pass (4.3, 4.5, 4.6, 4.12, 4.13, 4.14, 4.17, 5.10, 7.3, 7.4) |
| Security criteria inside the stories, no separate security epic | Pass |
| File churn | Accepted: Epics 4 and 7 both build on `packages/ui`; the split follows the two surfaces and the spine's build order |

Known conflicts surfaced, not silently resolved: DESIGN.md's receipt card lists a proof thumbnail
(D49 forbids it; Story 4.9 follows D49); EXPERIENCE.md's locked state says "wait 15 minutes" while
AD-18 doubles the delay from 1 to 15 minutes (Story 7.2 follows AD-18); the story guide's walking
skeleton differs from the spine's step 1 (adjustment A3).
