# PRD Quality Review — Cashback Platform (hoantiendp.com), re-plan

- **PRD:** `_bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/prd.md` (+ `addendum.md`)
- **Rubric:** `.claude/skills/bmad-prd/assets/prd-validation-checklist.md`
- **Checked against:** `docs/domain-model.json` v0.2.0 (D1–D23, rules, open questions) and the money rules in `CLAUDE.md`
- **Reviewed:** 2026-10-30

## Overall verdict

The PRD's thesis is clear and it is honest about it: the product is trust ("the exact amount, once, from the approved commission"). The journeys are concrete, and most of D1–D23 carry over correctly, often with the consequence written out so it can be tested. The risk sits where real money moves. The withheld-tax rule is stated three different ways, so FR-13 cannot be implemented or golden-tested. "Manual adjustment", review-case "apply" and payout correction are money paths with no rules. D13 (never erase a customer who is owed money) is missing entirely. And the threats specific to this business are not specified: payout redirection through a bank-account change, a race between viewing the payable amount and recording the payout, and loss of the single personal Zalo account. Done-ness is thin for a third of the FRs, which have no testable consequences at all.

## Decision-readiness — adequate

Most choices are stated as decisions and tied to a D-number: one payout path (FR-17/D19), no payout date (FR-15/D11), the guest link rule (FR-3/D5), and the reuse rule backed by a named production incident (FR-5, "the case that broke production on 2026-09-25"). §6 names the real trade-offs. Losing the Shopee account "loses about two months of unpaid commission", and a Zalo lock "cuts every customer at once". Counter-metrics exist.

Where it falls short, decisions are hidden in assumptions, or a tension is left open without a callout. FR-8 settles OQ7 with an `[ASSUMPTION]`. That reverses the observed domain rule `identity.customer.created-from-zalo` ("a private chat ... or membership of the community group"), and the domain model still lists OQ7 as open for the owner. §6 "Tax is due on the gross commission" reads as a decision but has no owner, no source and no link to FR-13. OQ8 (hard-coded secrets on `main`, in a repository the domain model calls public) is filed as a scheduling question ("when"). It is a live exposure and should block the work.

### Findings
- **high** OQ7 decided by assumption against an observed domain rule (§4.2 FR-8, §11) — The domain model keeps OQ7 open for the project owner, and the current rule creates customers from group membership. The PRD quietly picks the other answer. It also never says what happens at cutover to the existing customer rows that came from the group only. *Fix:* Turn the tag into a `[NOTE FOR PM]` that asks the owner to decide. Keep OQ7 in §10 until then, and add an FR-33 consequence for customer rows that came from the group only.
- **high** Exposed secrets treated as a scheduling question (§10 OQ8) — With a public repository and D16 ("made private first"), this is an active incident and a precondition for committing planning docs. It is not a question for later. *Fix:* Make "secrets rotated and removed from `main`, repository private" an explicit precondition in §8 or §6, with the owner named.
- **medium** "Tax is due on the gross commission" has no source or consequence (§6 Money law) — It may conflict with D12 and with the addendum's payout-level withholding (see Done-ness). *Fix:* Cite the source and say how it changes, or does not change, the FR-13 split.

## Substance over theater — adequate

The content is mostly earned. The Vision could not be swapped into another cashback PRD: it names the 15-minute operator day, the two accounts at risk and the specific accidents being removed. The UJs carry real numbers (450,000 dong, "Bạn nhận lại khoảng 9.263đ", the 72-hour flag) and they drive FRs. There are three protagonists (Lan, Tuan, Minh), which is in budget.

Some NFRs are theater. NFR-4 Availability ("available whenever the host machine, the browser bridge and the assistant are up") is true by definition and sets no target. NFR-2 ("every screen covers phone, tablet and desktop") restates CLAUDE.md without bounds beyond 360 px. NFR-9 (file line counts) is a coding standard, not a product requirement.

### Findings
- **medium** NFR-4 has no target (§5) — It describes when the system is up rather than how often it must be. For a single home machine with a Cloudflare tunnel, the operator needs a recovery-time and data-loss bound. *Fix:* State a maximum tolerable outage for link issuing and for the ledger (RTO), and a maximum data loss (RPO, which ties to FR-32 backup frequency).
- **low** NFR-9 is an engineering convention (§5) — *Fix:* Move it to the architecture or coding rules, or keep it labeled as a guardrail.

## Strategic coherence — adequate

The thesis is "trust: exact amount, once, from approved commission", and the feature set follows it. Money-correctness FRs (FR-5, FR-12, FR-13, FR-17) are the core, and NFR-1 makes zero double payouts a release blocker. The MVP is a problem-solving rebuild with a cutover, and the scope logic matches.

The metrics validate the operations more than the thesis. SM-2 (approved orders per day) is an activity measure. Nothing measures trust directly, for example how far the estimate shown is from the cashback approved, missing-order complaints, or how long an approved amount waits before it is paid. The counter-metric pairings are odd. SM-C2 "links issued" is said to counterbalance SM-3 "reply time", but it really counterbalances SM-2. SM-C3 "messages sent" counterbalances SM-6 "bank on file", though the real tension is with every notification FR.

### Findings
- **medium** No metric validates trust (§9) — *Fix:* Add a primary SM for estimate accuracy (median and p90 of approved cashback divided by estimated cashback) and one for customer disputes or missing-order claims per 100 orders.
- **low** Counter-metric pairings do not match the tension (§9 SM-C2, SM-C3) — *Fix:* Re-pair SM-C2 with SM-2. Pair SM-C3 with FR-21 notifications and the D9 pace.

## Done-ness clarity — thin

FRs that have a "Consequences (testable)" block are mostly good: FR-4, FR-5, FR-9, FR-10, FR-12, FR-17, FR-23 and FR-33 each give verifiable conditions. But FR-14, FR-16, FR-18, FR-19, FR-22, FR-24 (partly), FR-25, FR-26, FR-27, FR-28, FR-29, FR-30, FR-31 and FR-32 have no consequence block, or only a single inline sentence. Several of them touch money or account safety. The most serious problem is that the central money formula cannot be implemented as written.

### Findings
- **critical** Withheld-tax rule is contradictory, so FR-13 is untestable (§4.3 FR-13, §6, addendum §D) — FR-13 says "with fee and tax rules per network". D12 says "withheld tax 10% in a withheld period". Addendum §D says "10% personal income tax withheld on payouts of 2,000,000 dong or more". §6 says "Tax is due on the gross commission." These describe tax at order level, at period level, at payout level and on the gross amount. A golden test cannot be written, and the customer amount differs by 10% depending on the reading. *Fix:* Write the split as a numbered formula in FR-13 (cap, then fee 0.98%, then tax, then 80%, then rounding). Define what makes a "withheld period" and how it is known when the order is approved. Give one worked example in dong per network, and add the example as a golden test.
- **high** Rounding points not specified (§4.3 FR-13) — "`roundHalfUp(net x 80%)`" leaves open whether the fee and tax are rounded separately. The D1 example (9,262.5 becomes 9,263) only works if rounding happens once. Whole-dong integers (D1) are never stated. *Fix:* State "all amounts are whole dong; rounding half-up happens once, at <step>", and say whether the payout total is the sum of rounded per-order amounts.
- **high** Review-case resolution has no rules (§4.3 FR-14) — "apply or dismiss" is a manual money path. It is never stated that applying cannot attribute an order to the guest account or a staff member, cannot approve an order without a commission figure (`orders.order.approval-needs-commission`), cannot touch a paid order (D4), or must write history and audit. *Fix:* Add consequences: what "apply" may change, the invariants it keeps, and that it is audited with the staff member.
- **high** "Manual adjustment" is undefined (§4.8 FR-24) — It appears only in the audit list ("Every payout, merge, erase and manual adjustment"). No FR defines it, so it is an unconstrained way to change money that conflicts with D3 and D19. *Fix:* Either remove it, or define it as an FR with an allowed scope, a reason field, sign-off by an admin, and a statement that it never touches a paid order.
- **high** Payout amount race (§4.5 FR-17) — "The amount is computed by the server and shown before confirmation". Hourly reconciliation can approve a new order between showing the amount and confirming it, so the recorded payout could cover more than was transferred. Two staff could also pay the same customer at the same moment. *Fix:* The payout covers exactly the set of orders and bonuses shown (a snapshot). Confirmation fails if the set changed, and only one payout per customer can be in progress at a time. Add both as golden tests.
- **high** No payout correction path (§4.5 FR-17, §7) — Real transfers fail, go to the wrong account or carry the wrong amount. With D4 and D19, a mistaken payout cannot be undone, and nothing says what the operator does. *Fix:* Add an FR to void or correct a payout: admin only, audited, reverting the covered orders only when the operator confirms no money moved, and sending a customer message.
- **medium** FR-16, FR-18, FR-19 lack consequences (§4.5) — FR-18 "random and unguessable" should cite the domain's 24-byte token. It should also say whether a receipt page shows the proof image publicly, since that image may contain the full account number, which conflicts with NFR-6. FR-19 does not say how a settlement is matched to orders. *Fix:* Add a testable consequence block to each, including masking or cropping of proof images.
- **medium** Vague thresholds (§4.10 FR-31, §4.6 FR-22, §4.2 FR-9) — "high cancellation share", "bursts of link requests", "human pace", "no bulk messages" and "trusted phone" have no numbers. Reconciliation can approve 30 orders in one run, so it is unclear whether those 30 messages count as bulk. *Fix:* Give numeric thresholds: a messages-per-minute ceiling for notifications, burst and cancellation limits, and the session's sliding expiry and maximum lifetime.
- **medium** FR-1 "when the browser bridge is healthy" is undefined (§4.1 FR-1, SM-3) — It makes the 95% target unfalsifiable. *Fix:* Define healthy (signed in, no captcha, queue depth under N), or measure SM-3 over all requests and report degraded time separately.
- **medium** Reconciliation lookback not specified (§4.3 FR-12) — Idempotency is stated, but not how far back each run reads. Approval can take weeks. *Fix:* State the overlap and lookback window per network.
- **low** FR-32 lacks numbers (§4.10) — *Fix:* State the retention count, where the off-machine copy lives (by class, not product), and how often a restore is tested.

## Scope honesty — thin

Non-Goals (§7) and Out of Scope (§8.2) do real work: no wallet, no automatic transfers, no Lazada, no share above 80%. The four `[ASSUMPTION]` tags are indexed. But several omissions are silent and touch money or the risk to the accounts.

### Findings
- **high** D13 missing; customer erasure undefined (§4.2, FR-24, FR-29) — The PRD mentions "erase" three times but has no FR for erasing a customer. The money rule "a customer still owed money is never deleted, except by an explicit forced action" (D13, `identity.customer.owed-not-erased`) appears nowhere. The domain's erase action ("erases the customer and the customer's history") also conflicts with FR-29 "audit trail that is never changed", with D4, and with tax records. *Fix:* Add an FR for customer erasure that carries D13. Define what is kept (paid orders, payouts and audit records with personal data removed) and what is deleted under NFR-6.
- **high** Bank-account change can redirect payouts (§4.2 FR-9, FR-10; §4.5 FR-16) — The website can change the bank account. Customer codes are sequential (DP00012), the password strength is not given, and the only protection is a flag the operator "checks". Nothing says the customer is told in Zalo, or that a change made on the web needs confirmation in Zalo. *Fix:* Make every bank change send a Zalo message to the customer. Require a change made on the web to be confirmed in Zalo, or hold the payout until the operator verifies it. Set a minimum password strength.
- **high** No plan for losing the Zalo account (§6 Zalo, §8.2) — §6 calls "an optional Telegram channel" a fallback, but §8.2 puts Telegram out of scope as a customer channel. Passwords come only from /matkhau in Zalo, and registration happens only in Zalo, so with Zalo locked no one can get a password or register. CLAUDE.md notes that changing the assistant account changes every Zalo UID and requires customer merges. That is the identity key of the whole ledger. *Fix:* Add a Zalo-loss FR or a non-goal stating the degraded mode: how customers sign in, how customer ids survive a new account (alias mapping), and what the operator does. Remove the Telegram contradiction.
- **high** Group link requests vs. private-only registration (§4.1 FR-1 vs §4.2 FR-8) — FR-1 allows pasting a link "in a private chat or the community group". FR-8 does not register group members who never write privately. The PRD never says whose link a group member gets. If the link goes to the guest account, it quietly breaks the trust promise. *Fix:* State the behaviour: the reply in the group asks the person to write privately first, or the person is registered when they paste a link. Make it testable.
- **medium** Network clawbacks and adjustments not addressed (§4.3 FR-12) — "an approved order is never rejected later" is a system rule, but networks can reverse or adjust approved commission. The PRD does not say who absorbs a reversal after payout, or whether an adjustment before payout changes the cashback. *Fix:* State the business policy (the operator absorbs it after payout; before payout the change goes to a review case) and make it testable.
- **medium** Two production hosts not prevented (§6 Host) — "Two machines must never run production at the same time" is a constraint with no FR. Two hosts would break D9's single Zalo session and could double-run reconciliation and payouts. *Fix:* Add an FR or NFR saying production refuses to start while another instance holds the lease, and that this is checked at cutover.
- **medium** Cutover with one Zalo account and one browser (§4.11 FR-33, §8.2) — Without staging (§8.2), the rehearsal cannot exercise Zalo or the bridge. The freeze step (stop the Python assistant, notifier and reconciliation before import) is not stated. *Fix:* Add consequences for the cutover freeze and for switching the Zalo and bridge sessions. Promote the `[NOTE FOR PM]` into a decision.
- **medium** Missing-order disputes (§4.4, §2.1 JTBD "trust") — There is no path for "I bought but nothing was recorded", the most common trust failure in cashback. *Fix:* Add a short FR (claim with order id, becomes a review case) or an explicit non-goal.
- **medium** Shopee affiliate terms and link volume (§6, FR-1) — "Zalo has no quota", yet SM-C2 admits that link volume risks the affiliate account. Nothing caps link creation through the bridge, and there is no stated check that cashback incentives are allowed under the program terms. *Fix:* Add a daily ceiling on bridge link creation, or an alert threshold, and record a compliance check of the Shopee and AccessTrade terms as an owner question.
- **low** Group announcements dropped silently (domain `messaging.announce`) — The PRD covers it in neither FRs nor Non-Goals, though UJ-7 relies on it for campaigns. *Fix:* Add it to FR-20/21 with the D9 pace, or list it as a non-goal.

## Downstream usability — adequate

The glossary defers to the domain glossary and adds six terms. FR and UJ numbering is contiguous. Most FRs say which UJ they realize, which UX and story workflows can pick up directly. But some cross-references are wrong, and several statements leak implementation choices that belong to architecture, which constrains that step before it starts.

### Findings
- **medium** Implementation leaks in FRs (FR-7, FR-13, FR-20, NFR-9) — "All waiting happens on the server, never inside a page script" (FR-7). "computed in one shared money package" (FR-13; acceptable only as a citation of D20). "comes from `resources/messages.vi.json`" (FR-20, a file path). File line limits (NFR-9). The "no signature headers" and "page 1 only" rules are acceptable as D8 guardrails. *Fix:* Restate as outcomes (for example, "a link wait never depends on a browser tab being in the foreground"). Move the mechanisms to the addendum or architecture.
- **low** D7 alphanumeric sub_id not stated (§4.1) — FR-7 covers "one customer per submission" but not "letters and digits only". *Fix:* Add it as an FR-1 or FR-7 consequence.
- **low** "Example amount" only for messages and the share page (FR-6, FR-21) — CLAUDE.md rule 11 applies to every percentage shown to a customer, including the website. *Fix:* Lift it to an NFR.

## Shape fit — strong

This is a consumer product with a single operator, a brownfield rebuild at the top of a UX, architecture and stories chain. The shape matches. UJs carry the customer side, and an admin-desk capability list carries the operator side. Brownfield references (the live Python system, the v2 attempt, the audits in the addendum) are kept apart and marked as reference only (D14). The UJ density is right. Operator UJs (UJ-5 to UJ-7) earn their place because operator time is a stated NFR.

## Mechanical notes

- FR-2 says "Realizes UJ-2" (the balance journey). No UJ covers a signed-in customer requesting a link on the web. Add one, or re-point the reference.
- FR-11 (customer merge) says "Realizes UJ-6", but UJ-6 is about report-row review cases, not merges.
- FR-12, FR-13, FR-16 to FR-19 and FR-22 onward have no "Realizes" line, though most map to UJ-5 or UJ-6.
- Term drift: the PRD's "receipt page" and "bill token" against the domain's "bill page" and `billToken`. Order "cancelled" (FR-15) against the domain state `REJECTED`. Choose one, or map them in §3.
- §10 mixes domain OQ ids (OQ1, OQ2, OQ5, OQ8) with an unnumbered item 5. Item 5 duplicates the `[NOTE FOR PM]` in §8.2. OQ7 is dropped, but the domain model still has it open.
- Assumptions Index round trip is clean: 4 inline tags, 4 index entries.
- Open-items density: 5 OQs, 4 assumptions, 1 NOTE FOR PM. That is moderate for a build green-light, but several items that should block (tax rule, D13, OQ7, OQ8) are not flagged as blocking.
