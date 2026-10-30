# Status flows (operations standard)

Owner: Operations Lead. Agreed in the party session of 2026-10-30 (Mary, Winston, Hà; log in
`.context/discussions/domain/2026-10-30-status-flows-party.md`). This file is the single definition
of every status the platform shows. The UI status registry (EXPERIENCE.md, "Status vocabulary"),
the chat messages, the exports and the domain model follow it. A status not listed here does not
exist.

Each state has: meaning, who moves it, the trigger, the guard, and the sentence a customer reads.

Revised 2026-10-30 after the independent architecture review
(`_bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md`,
decisions D38 to D55).

## 1. Order

Source of truth: the network's conversion report, read by the reconciliation run every 60 minutes.

| State | Meaning | Customer sentence (vi) | Counts as payable |
|---|---|---|---|
| `AWAITING_APPROVAL` | Recorded, the network has not decided | "Đơn đã ghi nhận, chờ sàn duyệt" | No |
| `FROZEN` | The report says something we do not understand | "Đơn đang được mình kiểm tra lại" | No, and excluded from every total |
| `APPROVED` | The network approved a commission above 0 | "Sàn đã duyệt, chờ mình chuyển tiền" | Yes |
| `REVERSED` | Approved, then cancelled before we paid | "Đơn bị huỷ sau khi duyệt, không được hoàn" | No |
| `PAID` | Covered by a recorded payout | "Đã chuyển tiền" | No (already paid) |
| `REJECTED` | Cancelled, returned, invalid or 0 commission before approval | "Không được duyệt: <reason>" | No |

Transitions:

| From | To | Trigger | Guard |
|---|---|---|---|
| none | AWAITING_APPROVAL | first report row attributed to a customer | sub_id1 (through aliases) or the sub_id2 owner resolves and they agree; otherwise a review case |
| AWAITING_APPROVAL | APPROVED | the network's status map says approved | approved commission > 0 |
| AWAITING_APPROVAL | REJECTED | any cancel signal (below) | none |
| AWAITING_APPROVAL, APPROVED | FROZEN | unknown status string, missing order id; or (APPROVED, unpaid) the approved commission drops but stays above 0 (D55) | none; opens a review case |
| FROZEN | previous state or REJECTED | staff resolve the review case | reason recorded |
| REJECTED | AWAITING_APPROVAL | staff apply a review case for a wrong rejection (D38) | the latest report row shows no cancel signal; reason recorded |
| APPROVED | REVERSED | any cancel signal after approval, before payout | the order is not covered by an OPEN payout claim; otherwise the cancel is recorded and applied by the first run after the claim ends (D39); alert sent; review case opened |
| APPROVED | PAID | payout confirmed | status re-read inside the transaction (R2) |
| PAID | PAID + clawback entry | any cancel signal after payout, or a commission drop (partial clawback, D55) | the order never changes (D4); a negative ledger entry is created; review case opened |
| PAID | APPROVED or REVERSED | an admin voids the payout (FR-34, D41) | the state the latest report row gives: REVERSED if a cancel was seen, else APPROVED; paid_at cleared; the clawback on the order closed by an offsetting entry |

**Cancel signal** (any one is enough, checked in this order): the order-level status maps to
`CANCELLED` in the network's status map; any item maps to `CANCELLED` (cancelled, returned or
refunded: the item's commission is removed; the order is rejected when no live item remains);
commission 0 in a later report. Item status never overrides an order-level cancellation.

Each network adapter keeps an explicit status map (raw value to `AWAITING`, `APPROVED` or
`CANCELLED`; anything else is unknown and freezes the order), golden-tested on real report rows
(D38). Shopee's `UNPAID` means the buyer has not paid yet (a just-placed or COD order): it maps to
`AWAITING`, never to a cancel signal. Shopee's cancelled, invalid, fraud and closed statuses map to
`CANCELLED`.

Rules:

- R1. Only `APPROVED` with approved commission above 0 is payable. No client option widens this.
- R2. Confirming a payout re-reads every covered order inside the transaction; any order that is not
  `APPROVED`, unpaid and owned by that customer fails the whole confirm.
- R3. Every item and every order of a checkout is evaluated; the payable commission is the sum of
  live items.
- R4. Estimates follow every report, downwards included; an estimate is never shown after a cancel
  signal.
- R5. An awaiting order not seen in the report for 14 days (`last_seen_in_report_at`) is flagged;
  over 60 days it appears on the Overview as aged. The nightly sweep reads every day that still
  holds an awaiting or approved unpaid order (D43).
- R6. A report read that hits the page cap or the 90-day window edge fails the run loudly and
  alerts the owner; no order is frozen and no state changes because of it (D43).

## 2. Clawback (cancel after payout)

The paid order stays `PAID`. A clawback entry of the order's stored cashback plus any campaign
bonus already paid on that order (D35) is added to the customer's ledger. Its open amount is the
sum of its insert-only entries (the negative original plus positive netting and write-off
entries, D42). A payout nets open clawbacks up to the customer's gross payable and carries the rest
forward; a transfer is never negative. When the open clawbacks reach the gross, staff record a
netting-only payout (transfer 0): the orders become `PAID`, no QR is shown and no message is sent.
The balance card shows open clawbacks as "trừ vào lần chuyển sau" (deducted at the next payout). The customer is told once: "Đơn X bị sàn huỷ sau khi mình đã chuyển tiền, mình sẽ trừ
9.263đ vào lần chuyển sau." Staff see open clawbacks on the customer page and the Overview. An
admin may write off a clawback with a reason.

## 3. Link request

`QUEUED → ISSUED → DELIVERED → CONVERTED`, or `QUEUED → FAILED` after three counted attempts.
Being outside the attribution window is derived, not a state (D23).

## 4. Payout

**Payout claim** (its own entity, D39): `OPEN` (a staff member opened the panel; one per
customer) → `CONFIRMED` (the payout was recorded), or `ABANDONED` (10 minutes idle). A claim is
never deleted. Confirm on an `ABANDONED` claim still succeeds when no other claim is open and every
covered order is unchanged; a retried confirm returns the same payout. Opening a customer whose last
claim was abandoned after the QR was shown warns that a transfer may already have been made.

**Payout:** `RECORDED` → optionally `VOIDED` (admin, reason required). Void returns each covered
order to the state its latest report row gives (`REVERSED` if a cancel was seen, else `APPROVED`),
reverses the netting entries the payout wrote, and returns bonuses to `CONFIRMED` (or `VOID` when
their order is now `REVERSED`) (D41).

## 5. Campaign award

`HELD → CONFIRMED → PAID`, or `VOID`. An award is voided whenever its order becomes `REJECTED` or
`REVERSED`, whatever the campaign's own status. While its order is `FROZEN` the award is
suspended: it keeps its slot and state but is not payable; it resumes when the order leaves
`FROZEN` (D55). A held award is never payable.

## 6. Review case

`OPEN → RESOLVED (applied | dismissed)`, reason required. Opened by: unattributed row, sub_id1 and
sub_id2 owner disagreeing, unknown status, frozen order, cancel signal on an approved or paid
order, a commission drop after approval, a wrong rejection reported by staff, an imported order the
report can no longer verify. Apply offers only the candidate the rules produce (alias, sub_id2
owner, merge survivor); staff cannot choose another customer.

## 7. Network settlement

Per network payout batch: `PROCESSING → PAID` or `FAILED`. Shopee makes a batch every three or
four days with its gross commission and what the operator received; their difference is the 0.98%
fee and, in a withheld batch, 10% tax on the gross, so each batch's withholding is read from the two
amounts, and the latest batch's is the estimate later approvals take (the Settings period mark
overrides it). Settlement marks orders settled; it never changes an order's customer status (D27).
A paid batch is matched to exact orders (D59): the orders the network lists (APPROVED or PAID only),
or else the network's approved, unsettled orders approved in the batch's window (from the previous
batch's creation to this one's) when their gross fits inside the batch's; the rest of the gross is
recorded as unattributed (guest or unknown orders). Orders above the batch, a withholding that fits
no split, or a listed order that cannot be settled settles nothing for it and opens a review case
(`settlement_mismatch`, `settlement_conflict`, `settlement_not_approved`); a later record that
states other facts opens `settlement_facts_changed`. These cases change no order and are only
dismissed; a dismissed case is not reopened for the same facts. Batches imported at cutover are
`HISTORIC`: facts and totals only, never matched to orders, no case; window matching uses only
orders this system approved and starts at the go-live for the first new batch.

## 8. Customer

`ACTIVE`, `LOCKED` (after five failed sign-ins, for a delay that doubles from 1 minute up to 15;
derived from `locked_until`, never stored), `DISABLED`, `MERGED`, `ERASED`.
