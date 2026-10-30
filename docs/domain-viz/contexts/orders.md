# Order Tracking

`orders`

## Purpose & classification

> Know exactly which customer earned which approved commission

**Subdomain type:** core · **Status:** observed · exists in code · **Strategic importance:** high · **Owner:** Platform team

**Context map patterns:** anti-corruption layer, published language

Reads the networks' conversion reports, attributes each order to a customer, and follows it to approval or cancellation.

**Subdomain:** Attribution and cashback (core)

Issuing attributable links, tracking orders and paying cashback.

## Ubiquitous language

| Term | Source | Note |
|---|---|---|
| `CommissionSplit` | shared-kernel | The one implementation of the cap, fee, tax, cashback share and half-up rounding, used by every context. |
| `Money` | value-object | Type of field orderValue on Order |

## Aggregates

### Order · `orders`
_observed · exists in code_
One purchase a network reported, attributed to one customer. It holds the order value, the estimated and approved commission and the cashback owed. A paid order never changes.
**Identity:** `orderId : OrderId`. The network's order number or transaction id.
> Must be correct together: owner, network, status, estimated and approved commission, cashback, paid time and status history.
**Invariants:**
- Cashback is calculated from the approved commission only (D3: Cashback is calculated from the approved commission only, never from the estimate shown to the customer).
- An order with a paid time is never changed or paid again (D4: An order with a payout time (paid_at) is never changed or paid again).
- An approved order is never rejected later.
- A guest order always has 0 cashback and is never moved to another customer (D5: A link made without a customer code belongs to the guest account HOUSE).
- Every status change is appended to the status history.
**12 fields:**
| Field | Type / reference | Required | Description |
|---|---|---|---|
| `orderId` | `OrderId` | yes | The network's order number or transaction id. |
| `customerId` | → `identity.customer` | yes |  |
| `requestId` | → `linking.link-request` |  |  |
| `network` | `AffiliateNetwork` | yes |  |
| `status` | `OrderStatus` | yes |  |
| `orderValue` | `Money` |  |  |
| `estimatedCommission` | `Money` |  |  |
| `approvedCommission` | `Money` |  |  |
| `cashback` | `Money` |  | Derived from the approved commission by the commission split. |
| `recordedAt` | `Instant` |  | When the platform first recorded the order. Campaign ranking uses it. |
| `paidAt` | `Instant` |  |  |
| `settlement` | `SettlementStatus` |  | Whether the network has paid the operator for this order. |


### ReviewCase · `manual_review`
_observed · exists in code_
A report row the system will not guess at, waiting for the operator. One open case per order and reason.
**Identity:** `caseId : ReviewCaseId`
> Must be correct together: order id, reason, report row and resolution.
**Invariants:**
- Only one open review case exists per order and reason.
**4 fields:**
| Field | Type / reference | Required | Description |
|---|---|---|---|
| `caseId` | `ReviewCaseId` | yes |  |
| `orderId` | `OrderId` |  |  |
| `reason` | `ReviewReason` |  |  |
| `resolved` | `Boolean` |  |  |

## Identity & building blocks

**Identity**: what names exactly one record. It separates an entity from a value object.

| Aggregate | Field | Type | Rule |
|---|---|---|---|
| Order | `orderId` | `OrderId` | The network's order number or transaction id. |
| ReviewCase | `caseId` | `ReviewCaseId` |  |

**Aggregate root** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `Order` | Owns an order's status, commission and cashback, and refuses any change after payment. |  | aggregate, in orders.order |


**Domain service** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `OrderAttribution` | Finds the customer of a report row by sub_id1, alias, then request owner. |  | aggregate, in orders.order |


**Anti-corruption layer** (3)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `ConversionReportTranslator` | Translates each network's report rows and statuses into the Order language. |  | integration |
| `ShopeeReportAdapter` | Shopee conversion reports are read page by page through the same browser. Via: Browser bridge report reader. |  | integration |
| `AccessTradeReportAdapter` | AccessTrade transactions are grouped per order and translated. Via: AccessTrade transactions API. |  | integration |


**Process manager** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `ReconciliationRun` | Reads each network report every hour and applies it idempotently. |  | bounded-context |


**Shared kernel** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `CommissionSplit` | The one implementation of the cap, fee, tax, cashback share and half-up rounding, used by every context. |  | shared-kernel |


**Not modelled yet:** `entity`, `value-object`, `repository`, `specification`, `policy`, `read-model`. This is not always a gap: a supporting domain often keeps its rules inside the aggregate root.

## Lifecycle

### Order · `OrderStatus`
A recorded order waits for the network's approval, then waits for the operator's payout.
```mermaid
stateDiagram-v2
    direction LR
    [*] --> AWAITING_APPROVAL
    AWAITING_APPROVAL --> APPROVED: approve [approval-needs-commission]
    AWAITING_APPROVAL --> REJECTED: reject [network-status-map]
    APPROVED --> PAID: mark_paid [pay-once]
    AWAITING_APPROVAL --> FROZEN: freeze [cancel-signal-precedence]
    FROZEN --> AWAITING_APPROVAL: resolve
    APPROVED --> REVERSED: reverse [cancel-signal-precedence, claim-protection]
    PAID --> PAID: claw_back
    APPROVED --> FROZEN: freeze [unknown-status-review]
    FROZEN --> APPROVED: resolve_approved [approval-needs-commission]
    FROZEN --> REJECTED: resolve_rejected
    REJECTED --> AWAITING_APPROVAL: reopen [network-status-map]
    PAID --> APPROVED: void_to_approved [void-observed-state]
    PAID --> REVERSED: void_to_reversed [void-observed-state]
    REVERSED --> [*]
```
**13 transitions**: guard, event emitted, what happens next

| From | Command | To | Guard | Emits | Then |
|---|---|---|---|---|---|
| AWAITING_APPROVAL | approve | APPROVED | approval-needs-commission | orders.order.approved | The customer balance grows. · The customer is told the amount, without a payout date (D11: Every approved, unpaid order is payable, grouped by customer). · Reconciliation sees the network approve the order with a commission figure. The cashback becomes owed. |
| AWAITING_APPROVAL | reject | REJECTED | network-status-map | orders.order.rejected | The customer is told the reason. · Reconciliation sees a cancel signal through the network's status map. Shopee UNPAID is not one (D38: Every network adapter reads statuses through an explicit status map (raw value to AWAITING, APPROVED or CANCELLED). |
| APPROVED | mark_paid | PAID | pay-once | orders.order.paid | A payout covering this order is recorded. |
| AWAITING_APPROVAL | freeze | FROZEN | cancel-signal-precedence | orders.order.frozen | A review case opens. The order leaves every total. · The report carries an unknown status or no order id. A page-cap read fails the run and freezes nothing (D43: The hourly reconciliation reads the last 7 days by purchase time). |
| FROZEN | resolve | AWAITING_APPROVAL | — | — | Staff resolve the review case and the order returns to its known state. |
| APPROVED | reverse | REVERSED | cancel-signal-precedence, claim-protection | orders.order.reversed | The order leaves the payable balance. · Staff get an alert. The customer is told once. · A cancel signal arrives after approval and before payout, and no OPEN payout claim covers the order (D39: Payout claims are kept with status OPEN, CONFIRMED or ABANDONED and a qr_shown_at time). |
| PAID | claw_back | PAID | — | orders.order.clawed-back | A cancel signal, or a commission drop (partial), arrives after payout. The order does not change; a clawback of the cashback plus any paid bonus is netted against later payouts (D35: A clawback after payout also recovers a campaign bonus already paid on that order, D42 (A clawback's open amount is the sum of its insert-only ledger entries: the negative original (stored cashback plus an…), D55: A FROZEN order suspends its campaign award instead of voiding it). [compensating] |
| APPROVED | freeze | FROZEN | unknown-status-review | orders.order.frozen | A review case opens. The order leaves every total; its campaign award is suspended. · An unknown status, a missing order id, or an approved commission that drops but stays above 0 on an unpaid order (D55: A FROZEN order suspends its campaign award instead of voiding it). |
| FROZEN | resolve_approved | APPROVED | approval-needs-commission | — | Staff resolve the review case and the order returns to approved. |
| FROZEN | resolve_rejected | REJECTED | — | — | Staff resolve the review case as a rejection, with a reason. |
| REJECTED | reopen | AWAITING_APPROVAL | network-status-map | — | Staff apply a review case for a wrong rejection; the latest report row shows no cancel signal (D38: Every network adapter reads statuses through an explicit status map (raw value to AWAITING, APPROVED or CANCELLED). |
| PAID | void_to_approved | APPROVED | void-observed-state | — | An admin voids the payout and the latest report row shows no cancel; paid_at is cleared (D41: Voiding a payout sets each covered order to the state transition() gives from its latest report row (REVERSED if a ca…). [compensating] |
| PAID | void_to_reversed | REVERSED | void-observed-state | — | An admin voids the payout and a cancel was seen; paid_at is cleared and the clawback is closed by an offsetting entry (D41: Voiding a payout sets each covered order to the state transition() gives from its latest report row (REVERSED if a ca…). [compensating] |


### ReviewCase
```mermaid
stateDiagram-v2
    direction LR
    [*] --> OPEN
    OPEN --> RESOLVED: resolve
    RESOLVED --> [*]
```
**1 transitions**: guard, event emitted, what happens next

| From | Command | To | Guard | Emits | Then |
|---|---|---|---|---|---|
| OPEN | resolve | RESOLVED | — | — | The operator applies or dismisses the row. |

## Commands & use cases

| Command / use case | From | Note |
|---|---|---|
| Reconcile a network report | Reconciliation run | Every hour the system reads each network's report and records, approves or rejects orders. |
| View my orders | Customer | A customer reads the order list and balance with /donhang or on the web. |
| Resolve a manual review | Operator | The operator decides a report row the system would not guess at. |
| approve | Order | Reconciliation sees the network approve the order with a commission figure. The cashback becomes owed. |
| reject | Order | Reconciliation sees a cancel signal through the network's status map. Shopee UNPAID is not one (D38: Every network adapter reads statuses through an explicit status map (raw value to AWAITING, APPROVED or CANCELLED). |
| mark_paid | Order | A payout covering this order is recorded. |
| freeze | Order | The report carries an unknown status or no order id. A page-cap read fails the run and freezes nothing (D43: The hourly reconciliation reads the last 7 days by purchase time). |
| resolve | Order | Staff resolve the review case and the order returns to its known state. |
| reverse | Order | A cancel signal arrives after approval and before payout, and no OPEN payout claim covers the order (D39: Payout claims are kept with status OPEN, CONFIRMED or ABANDONED and a qr_shown_at time). |
| claw_back | Order | A cancel signal, or a commission drop (partial), arrives after payout. The order does not change; a clawback of the cashback plus any paid bonus is netted against later payouts (D35: A clawback after payout also recovers a campaign bonus already paid on that order, D42 (A clawback's open amount is the sum of its insert-only ledger entries: the negative original (stored cashback plus an…), D55: A FROZEN order suspends its campaign award instead of voiding it). |
| resolve_approved | Order | Staff resolve the review case and the order returns to approved. |
| resolve_rejected | Order | Staff resolve the review case as a rejection, with a reason. |
| reopen | Order | Staff apply a review case for a wrong rejection; the latest report row shows no cancel signal (D38: Every network adapter reads statuses through an explicit status map (raw value to AWAITING, APPROVED or CANCELLED). |
| void_to_approved | Order | An admin voids the payout and the latest report row shows no cancel; paid_at is cleared (D41: Voiding a payout sets each covered order to the state transition() gives from its latest report row (REVERSED if a ca…). |
| void_to_reversed | Order | An admin voids the payout and a cancel was seen; paid_at is cleared and the clawback is closed by an offsetting entry (D41: Voiding a payout sets each covered order to the state transition() gives from its latest report row (REVERSED if a ca…). |
| resolve | ReviewCase | The operator applies or dismisses the row. |

## Events

- command `approve` → aggregate `Order` → event **orders.order.approved**; then The customer balance grows.; The customer is told the amount, without a payout date (D11: Every approved, unpaid order is payable, grouped by customer).
- command `reject` → aggregate `Order` → event **orders.order.rejected**; then The customer is told the reason.
- command `mark_paid` → aggregate `Order` → event **orders.order.paid**
- command `freeze` → aggregate `Order` → event **orders.order.frozen**; then A review case opens. The order leaves every total.
- command `reverse` → aggregate `Order` → event **orders.order.reversed**; then The order leaves the payable balance.; Staff get an alert. The customer is told once.
- command `claw_back` → aggregate `Order` → event **orders.order.clawed-back**
- command `freeze` → aggregate `Order` → event **orders.order.frozen**; then A review case opens. The order leaves every total; its campaign award is suspended.

Commands that emit no event (nothing elsewhere can react): `resolve`, `resolve_approved`, `resolve_rejected`, `reopen`, `void_to_approved`, `void_to_reversed`

| Event | Happens when | Who listens |
|---|---|---|
| orders.order.recorded | A network reported a new attributed order. The customer is told the estimate; campaigns may give it a slot. | messaging, campaigns, linking |
| orders.order.approved | The network approved the order. The cashback is now owed to the customer. | payouts, campaigns, messaging |
| orders.order.rejected | The network cancelled the order. No cashback is owed; a held campaign slot is freed. | campaigns, messaging |
| orders.order.paid | A payout covered the order. It never changes again. | campaigns, messaging |
| orders.order.frozen | The report said something the system does not understand. The order left every total and a review case opened. | operations, payouts |
| orders.order.reversed | The network cancelled an approved order before payout. It left the payable balance. | payouts, campaigns, messaging |
| orders.order.clawed-back | The network cancelled an order after payout. A clawback entry will reduce the next payout. | payouts, messaging |

## Rules & policies

**invariant** (12)

| Rule | Declared on | Status |
|---|---|---|
| An order is approved only when the report carries a commission figure; otherwise it goes to manual review. | Order | observed · exists in code |
| Only an approved order without a paid time can be marked paid (D4: An order with a payout time (paid_at) is never changed or paid again). | Order | observed · exists in code |
| Running reconciliation again over the same period leaves every order unchanged. | Order | observed · exists in code |
| Only an approved order with commission above 0 is payable. Awaiting, frozen, reversed and rejected money is never shown as owed (D32: Payout confirmation re-reads every covered order inside the transaction and fails if any is not APPROVED, unpaid and…). | Order | target · agreed goal |
| A cancel signal on an order covered by an OPEN payout claim is recorded but applied only after the claim ends (D39: Payout claims are kept with status OPEN, CONFIRMED or ABANDONED and a qr_shown_at time). | Order | target · agreed goal |
| Only the admin payout void clears paid_at, and it sets the state the latest report row gives (D41: Voiding a payout sets each covered order to the state transition() gives from its latest report row (REVERSED if a ca…). | Order | target · agreed goal |
| Cashback is calculated from the approved commission only (D3: Cashback is calculated from the approved commission only, never from the estimate shown to the customer). | Order |  |
| An order with a paid time is never changed or paid again (D4: An order with a payout time (paid_at) is never changed or paid again). | Order |  |
| An approved order is never rejected later. | Order |  |
| A guest order always has 0 cashback and is never moved to another customer (D5: A link made without a customer code belongs to the guest account HOUSE). | Order |  |
| Every status change is appended to the status history. | Order |  |
| Only one open review case exists per order and reason. | ReviewCase |  |


**policy** (1)

| Rule | Declared on | Status |
|---|---|---|
| A report status the system does not know goes to manual review instead of a guess. | Order | observed · exists in code |


**specification** (4)

| Rule | Declared on | Status |
|---|---|---|
| Shopee's unpaid, paid, completed and delivered statuses mean awaiting approval; UNPAID is the buyer's payment state and never a cancel signal (D38: Every network adapter reads statuses through an explicit status map (raw value to AWAITING, APPROVED or CANCELLED). Only validated or approved means approved. | Order | observed · exists in code |
| AccessTrade lines are grouped per transaction. The order is approved only when every non-rejected line is confirmed, and rejected when every line is rejected. | Order | observed · exists in code |
| A cancel signal is read in a fixed order: order status, then each item, then a zero commission, always through the network's status map. Item status never overrides an order-level cancellation (D31: A cancel signal is checked in a fixed order: order-level status, then each item, then a commission of 0). A page-cap read freezes nothing (D43: The hourly reconciliation reads the last 7 days by purchase time). | Order | target · agreed goal |
| Each network adapter maps every raw status explicitly to awaiting, approved or cancelled; anything else is unknown. Each map is golden-tested on real report rows (D38: Every network adapter reads statuses through an explicit status map (raw value to AWAITING, APPROVED or CANCELLED). | Order | target · agreed goal |


**workflow** (1)

| Rule | Declared on | Status |
|---|---|---|
| Reconciliation attributes an order by sub_id1, then by customer alias, then by the owner of the sub_id2 request. Anything else goes to manual review. | Order | observed · exists in code |

## Integration & hotspots

| Direction | Context | Kind | Via | Pattern | Status |
|---|---|---|---|---|---|
| calls | Customer Identity | port | CustomerDirectory | customer–supplier | observed · exists in code |
| calls | Link Issuing | reference | RequestId in sub_id2 | upstream–downstream | observed · exists in code |
| listens to | Cashback Payouts | event | orders.order.approved | published language | observed · exists in code |
| listens to | Campaigns | event | orders.order.* | published language | observed · exists in code |
| listens to | Customer Conversation | event | orders.order.* | published language | observed · exists in code |
