# Customer Conversation

`messaging`

## Purpose & classification

> Reach every customer in chat without getting the Zalo account locked

**Subdomain type:** supporting · **Status:** observed · exists in code · **Strategic importance:** high · **Owner:** Platform team

**Context map patterns:** conformist

Talks to customers in Zalo through one personal account, and sends the notifications the system starts on its own.

**Subdomain:** Customer engagement (supporting)

Who the customer is, how we talk to them, and promotions.

## Ubiquitous language

_No words declared for this domain. A word can mean something else in the next domain without anyone noticing._

## Aggregates

### Notification · `orders.notified_status`
_observed · exists in code_
A message the system starts on its own: late link, failed link, order recorded, approved, rejected, paid, slot held or lost. It is derived from the gap between what happened and what the customer was told.
**Identity:** `subjectId : SubjectId`
> Must be correct together: subject, customer, kind and sent state.
**Invariants:**
- A customer is told each change once.
- A guest never receives a notification (D5: A link made without a customer code belongs to the guest account HOUSE).
- No notification promises a payout date (D11: Every approved, unpaid order is payable, grouped by customer).
- A paid notification is never sent for 0 dong.
**5 fields:**
| Field | Type / reference | Required | Description |
|---|---|---|---|
| `customerId` | → `identity.customer` | yes |  |
| `kind` | `NotificationKind` | yes |  |
| `subjectId` | `SubjectId` |  |  |
| `sentAt` | `Instant` |  |  |
| `retryAt` | `Instant` |  |  |

## Identity & building blocks

**Identity**: what names exactly one record. It separates an entity from a value object.

| Aggregate | Field | Type | Rule |
|---|---|---|---|
| Notification | `subjectId` | `SubjectId` |  |

**Repository** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `MessageCatalog` | The Vietnamese message texts, outside the code. |  | bounded-context |


**Port** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `ZaloAssistantPort` | Sends a private or group message through the assistant. |  | integration |


**Adapter** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `ZcaJsAdapter` | All chat goes through one personal Zalo account (D9: Customer chat runs on one personal Zalo account at a human pace). Via: zca-js personal account. |  | integration |


**Process manager** (1)

| Building block | Purpose | Detail | Scope |
|---|---|---|---|
| `Notifier` | Every 10 seconds sends what customers have not yet been told, with backoff. |  | bounded-context |


**Not modelled yet:** `entity`, `value-object`, `domain-service`, `specification`, `policy`, `read-model`. This is not always a gap: a supporting domain often keeps its rules inside the aggregate root.

## Lifecycle

_Nothing here changes state in a way that changes what is allowed._

## Commands & use cases

| Command / use case | From | Note |
|---|---|---|
| Use chat commands | Customer | A customer types /id, /sodu, /donhang, /stk, /matkhau or pastes a link. Private data is answered in a private chat only. |
| Announce to the group | Operator | The operator previews an announcement in the test group, then sends it to the main group. |

## Events

_This domain emits no events. Nothing elsewhere can react to what happens here._

## Rules & policies

**invariant** (5)

| Rule | Declared on | Status |
|---|---|---|
| One Zalo account runs one session. Dev and test use another account. | Notification | observed · exists in code |
| A customer is told each change once. | Notification |  |
| A guest never receives a notification (D5: A link made without a customer code belongs to the guest account HOUSE). | Notification |  |
| No notification promises a payout date (D11: Every approved, unpaid order is payable, grouped by customer). | Notification |  |
| A paid notification is never sent for 0 dong. | Notification |  |


**policy** (3)

| Rule | Declared on | Status |
|---|---|---|
| The assistant keeps a human pace: no bulk messages, no bulk friend requests, at most 30 friend requests a day to people who wrote first (D9: Customer chat runs on one personal Zalo account at a human pace). | Notification | observed · exists in code |
| A failed send waits 1, 2, 4 minutes and so on, up to one hour. | Notification | observed · exists in code |
| Every message text comes from the Vietnamese message catalog. Every percentage carries an example amount in dong. | Notification | observed · exists in code |

## Integration & hotspots

| Direction | Context | Kind | Via | Pattern | Status |
|---|---|---|---|---|---|
| notifies | Order Tracking | event | orders.order.* | published language | observed · exists in code |
| notifies | Link Issuing | event | linking.link-request.* | published language | observed · exists in code |
