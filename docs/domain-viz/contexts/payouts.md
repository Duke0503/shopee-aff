# Cashback Payouts

`payouts`

## Purpose & classification

> Pay every customer exactly what is owed, once

**Subdomain type:** core · **Status:** observed · exists in code · **Strategic importance:** high · **Owner:** Operator

**Context map patterns:** customer–supplier

Turns approved cashback into bank transfers the operator makes, and tracks what the networks paid the operator.

**Subdomain:** Attribution and cashback (core)

Issuing attributable links, tracking orders and paying cashback.

## Ubiquitous language

| Term | Source | Note |
|---|---|---|
| `BillToken` | domain-primitive | A 192-bit random token for the public bill page. |
| `Money` | value-object | Type of field amount on Payout |
| `ProofImage` | value-object | Type of field proof on Payout |

## Aggregates

### Payout · `payment_transfers`
_observed · exists in code_
One bank transfer the operator made to one customer. It covers that customer's approved, unpaid orders and confirmed bonuses. It holds the amount, the transfer reference, the proof and the bill token.
**Identity:** `payoutId : PayoutId`
> Must be correct together: customer, covered orders, covered bonuses, amount, reference, proof and bill token.
**Invariants:**
- A payout covers only approved orders without a paid time, and only confirmed campaign bonuses (D19: Every payout goes through one command. It covers only approved orders without a paid time and only confirmed bonuses,…).
- The payout amount equals the sum of the cashback and bonuses it covers, computed by the server.
- A payout is never made to a customer without a bank account.
- A guest order is never covered by a payout (D5: A link made without a customer code belongs to the guest account HOUSE).
**9 fields:**
| Field | Type / reference | Required | Description |
|---|---|---|---|
| `payoutId` | `PayoutId` | yes |  |
| `customerId` | → `identity.customer` | yes |  |
| `orderIds` | `OrderId[]` | yes |  |
| `amount` | `Money` | yes |  |
| `reference` | `TransferReference` |  | The customer code only, no commercial wording. |
| `proof` | `ProofImage` |  |  |
| `billToken` | `BillToken` |  | 24 random bytes; opens the public bill page. |
| `notifyMode` | `NotifyMode` |  |  |
| `createdBy` | `StaffId` |  |  |


### NetworkSettlement · `payout_batches`
_observed · exists in code_
One payment a network made to the operator. It settles the approved orders it covers. It is separate from paying customers.
**Identity:** `batchId : SettlementBatchId`
> Must be correct together: batch id, network, amount, status and settled orders.
**Invariants:**
- Settlement never changes an order's customer status.
**4 fields:**
| Field | Type / reference | Required | Description |
|---|---|---|---|
| `batchId` | `SettlementBatchId` | yes |  |
| `network` | `AffiliateNetwork` |  |  |
| `status` | `SettlementBatchStatus` |  |  |
| `amount` | `Money` |  |  |

## Identity & building blocks

**Identity**: what names exactly one record. It separates an entity from a value object.

| Aggregate | Field | Type | Rule |
|---|---|---|---|
| Payout | `payoutId` | `PayoutId` |  |
| NetworkSettlement | `batchId` | `SettlementBatchId` |  |

**Aggregate root** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `Payout` | Owns one transfer and the orders and bonuses it covers. |  | aggregate, in payouts.payout |


**Domain primitive** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `BillToken` | A 192-bit random token for the public bill page. |  | aggregate, in payouts.payout |


**Adapter** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `VietQrAdapter` | Builds the transfer QR from the customer's bank account. |  | integration |


**Read model** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `PayableBalance` | Each customer's approved, unpaid cashback and confirmed bonuses. |  | bounded-context |


**Not modelled yet:** `entity`, `value-object`, `domain-service`, `repository`, `specification`, `policy`. This is not always a gap: a supporting domain often keeps its rules inside the aggregate root.

## Lifecycle

_Nothing here changes state in a way that changes what is allowed._

## Commands & use cases

| Command / use case | From | Note |
|---|---|---|
| Pay a customer | Operator | The operator opens the payable list, transfers by QR, and records the payout with proof. |
| Ask for a bank account | Operator | The operator asks a customer who is owed money to add a bank account. |

## Events

| Event | Happens when | Who listens |
|---|---|---|
| payouts.payout.recorded | The operator recorded a transfer. The covered orders become paid and the customer gets one message with the bill link. | orders, campaigns, messaging |

## Rules & policies

**invariant** (6)

| Rule | Declared on | Status |
|---|---|---|
| Every payout goes through one command that checks status, paid time and bonus state, and writes the order history (D19: Every payout goes through one command. It covers only approved orders without a paid time and only confirmed bonuses,…). | Payout | target · agreed goal |
| A payout covers only approved orders without a paid time, and only confirmed campaign bonuses (D19: Every payout goes through one command. It covers only approved orders without a paid time and only confirmed bonuses,…). | Payout |  |
| The payout amount equals the sum of the cashback and bonuses it covers, computed by the server. | Payout |  |
| A payout is never made to a customer without a bank account. | Payout |  |
| A guest order is never covered by a payout (D5: A link made without a customer code belongs to the guest account HOUSE). | Payout |  |
| Settlement never changes an order's customer status. | NetworkSettlement |  |


**policy** (2)

| Rule | Declared on | Status |
|---|---|---|
| Every approved, unpaid order is payable. The operator decides when to pay, and no message promises a date (D11: Every approved, unpaid order is payable, grouped by customer). | Payout | observed · exists in code |
| A bank account changed in the last 72 hours raises a flag before the operator pays. | Payout | target · agreed goal |


**authorization** (1)

| Rule | Declared on | Status |
|---|---|---|
| Only staff may record a payout. | Payout | observed · exists in code |

## Integration & hotspots

| Direction | Context | Kind | Via | Pattern | Status |
|---|---|---|---|---|---|
| notifies | Order Tracking | event | orders.order.approved | published language | observed · exists in code |
| calls | Customer Identity | port | BankAccountReader | customer–supplier | observed · exists in code |
| calls | Campaigns | port | ConfirmedBonuses | customer–supplier | observed · exists in code |
