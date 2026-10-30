# Operations

`operations`

## Purpose & classification

> See what happened and spot abuse

**Subdomain type:** generic · **Status:** observed · exists in code · **Strategic importance:** medium · **Owner:** Operator

The audit trail, the owner alerts, the fraud checks and the business metrics the operator reads.

**Subdomain:** Back office (generic)

Audit, alerts and metrics.

## Ubiquitous language

_No words declared for this domain. A word can mean something else in the next domain without anyone noticing._

## Aggregates

### AuditEntry · `logs/audit`
_observed · exists in code_
One append-only record of a business act: link, order, payout, bank change, sign-in, erasure.
**Identity:** `actor : ActorId`
> Must be correct together: act, actor, subject and time.
**Invariants:**
- An audit entry is never changed.
- A bank account appears only as a fingerprint.
**4 fields:**
| Field | Type / reference | Required | Description |
|---|---|---|---|
| `act` | `AuditAct` | yes |  |
| `actor` | `ActorId` |  |  |
| `subject` | `SubjectId` |  |  |
| `at` | `Instant` | yes |  |

## Identity & building blocks

**Identity**: what names exactly one record. It separates an entity from a value object.

| Aggregate | Field | Type | Rule |
|---|---|---|---|
| AuditEntry | `actor` | `ActorId` |  |

_This domain names no building blocks of its own. A code review has nothing to point at._

## Lifecycle

_Nothing here changes state in a way that changes what is allowed._

## Commands & use cases

_No command or use case recorded that asks this domain to do something._

## Events

_This domain emits no events. Nothing elsewhere can react to what happens here._

## Rules & policies

**invariant** (2)

| Rule | Declared on | Status |
|---|---|---|
| An audit entry is never changed. | AuditEntry |  |
| A bank account appears only as a fingerprint. | AuditEntry |  |


**policy** (2)

| Rule | Declared on | Status |
|---|---|---|
| The fraud checks flag a bank account shared by several customers, frequent bank changes, a high rejection share, and bursts of link requests. | Operations | observed · exists in code |
| Business metrics are marked untrustworthy below 100 approved orders. | Operations | observed · exists in code |

## Integration & hotspots

_No relations declared. Either this domain stands alone, or the map is incomplete._


**Related decisions** (3)

| Decision | Why | Status |
|---|---|---|
| An order cancelled after approval and before payout becomes REVERSED and leaves every payout. An order cancelled after payout stays PAID and gets a clawback entry that is netted against the customer's next payout; an admin may write it off with a reason. | Today a cancel after approval is silently skipped; the customer could be paid for a cancelled order. Asking customers to send money back loses them. Agreed in the status-flows party session; delegated by the project owner (recommended option). | accepted · approved |
| A cancel signal is checked in a fixed order: order-level status, then each item, then a commission of 0. An unknown status, a missing order id or a report page cap freezes the order (FROZEN), excludes it from every total and opens a review case. | The live reader uses only the first item's status, so a cancelled order stayed awaiting and was shown as money owed. Agreed in the status-flows party session; delegated by the project owner (recommended option). | accepted · approved |
| Payout confirmation re-reads every covered order inside the transaction and fails if any is not APPROVED, unpaid and owned by that customer. Awaiting money is never shown as owed, in any total, QR or selection. | The live payments screen showed awaiting money by default and the confirm endpoint did not check status. Agreed in the status-flows party session; delegated by the project owner (recommended option). | accepted · approved |
