# Status flows (operations standard)

Owner: Operations Lead. Agreed in the party session of 2026-10-30 (Mary, Winston, Hà; log in
`.context/discussions/domain/2026-10-30-status-flows-party.md`). This file is the single definition
of every status the platform shows. The UI status registry (EXPERIENCE.md, "Status vocabulary"),
the chat messages, the exports and the domain model follow it. A status not listed here does not
exist.

Each state has: meaning, who moves it, the trigger, the guard, and the sentence a customer reads.

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
| none | AWAITING_APPROVAL | first report row attributed to a customer | sub_id1, alias or sub_id2 resolves; otherwise a review case |
| AWAITING_APPROVAL | APPROVED | report says validated/approved | approved commission > 0 |
| AWAITING_APPROVAL | REJECTED | any cancel signal (below) | none |
| AWAITING_APPROVAL, APPROVED | FROZEN | unknown status string, missing order id, page cap reached | none; opens a review case |
| FROZEN | previous state or REJECTED | staff resolve the review case | reason recorded |
| APPROVED | REVERSED | any cancel signal after approval, before payout | not in a payout being confirmed; alert sent |
| APPROVED | PAID | payout confirmed | status re-read inside the transaction (R2) |
| PAID | PAID + clawback entry | any cancel signal after payout | the order never changes (D4); a negative ledger entry is created |

**Cancel signal** (any one is enough, checked in this order): order-level status cancelled,
invalid, fraud, unpaid or closed; any item cancelled, returned or refunded (the item's commission
is removed; the order is rejected when no live item remains); commission 0 in a later report.
Item status never overrides an order-level cancellation.

Rules:

- R1. Only `APPROVED` with approved commission above 0 is payable. No client option widens this.
- R2. Confirming a payout re-reads every covered order inside the transaction; any order that is not
  `APPROVED`, unpaid and owned by that customer fails the whole confirm.
- R3. Every item and every order of a checkout is evaluated; the payable commission is the sum of
  live items.
- R4. Estimates follow every report, downwards included; an estimate is never shown after a cancel
  signal.
- R5. An awaiting order not seen in the report for 14 days is flagged; over 60 days it appears on
  the Overview as aged.
- R6. A report read that hits the page cap or the 90-day window edge fails loudly and freezes
  nothing silently.

## 2. Clawback (cancel after payout)

The paid order stays `PAID`. A clawback entry of the cashback amount is added to the customer's
ledger. Open clawbacks are netted against the customer's next payable balance; a transfer is never
negative. The customer is told once: "Đơn X bị sàn huỷ sau khi mình đã chuyển tiền, mình sẽ trừ
9.263đ vào lần chuyển sau." Staff see open clawbacks on the customer page and the Overview. An
admin may write off a clawback with a reason.

## 3. Link request

`QUEUED → ISSUED → DELIVERED → CONVERTED`, or `QUEUED → FAILED` after three counted attempts.
Being outside the attribution window is derived, not a state (D23).

## 4. Payout

`CLAIMED` (a staff member opened the panel; released after 10 minutes idle) → `RECORDED` →
optionally `VOIDED` (admin, reason required; covered orders return to `APPROVED`).

## 5. Campaign award

`HELD → CONFIRMED → PAID`, or `VOID`. An award is voided whenever its order becomes `REJECTED`,
`REVERSED` or `FROZEN`, whatever the campaign's own status. A held award is never payable.

## 6. Review case

`OPEN → RESOLVED (applied | dismissed)`, reason required. Opened by: unattributed row, unknown
status, frozen order, cancel signal on an approved or paid order, page-cap failure.

## 7. Network settlement

Per network batch: `PROCESSING → PAID` or `FAILED`. Settlement marks orders settled; it never
changes an order's customer status (D27).

## 8. Customer

`ACTIVE`, `LOCKED` (15 minutes after five failed sign-ins), `DISABLED`, `MERGED`, `ERASED`.
