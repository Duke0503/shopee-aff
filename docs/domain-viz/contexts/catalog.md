# Deals

`catalog`

## Purpose & classification

> Show curated deals

**Subdomain type:** generic · **Status:** observed · exists in code · **Strategic importance:** low · **Owner:** Operator

Featured products and food-and-drink vouchers the operator shows to bring customers back.

**Subdomain:** Back office (generic)

Deals, audit, alerts and metrics.

## Ubiquitous language

_No words declared for this domain. A word can mean something else in the next domain without anyone noticing._

## Aggregates

### Deal · `featured_deals`
_observed · exists in code_
One featured product in a category, shown on the website and with /topdeal.
**Identity:** `dealId : DealId`
> Must be correct together: product, category and active flag.
**Invariants:**
- Only active deals are shown.
**3 fields:**
| Field | Type / reference | Required | Description |
|---|---|---|---|
| `dealId` | `DealId` | yes |  |
| `category` | `DealCategory` |  |  |
| `active` | `Boolean` |  |  |


### Voucher · `fnb_vouchers`
_observed · exists in code_
A counter code for a food-and-drink brand.
**Identity:** `voucherId : VoucherId`
> Must be correct together: brand, code and active flag.
**Invariants:**
- Only active vouchers are shown.
**3 fields:**
| Field | Type / reference | Required | Description |
|---|---|---|---|
| `voucherId` | `VoucherId` | yes |  |
| `brand` | `Brand` |  |  |
| `active` | `Boolean` |  |  |

## Identity & building blocks

**Identity**: what names exactly one record. It separates an entity from a value object.

| Aggregate | Field | Type | Rule |
|---|---|---|---|
| Deal | `dealId` | `DealId` |  |
| Voucher | `voucherId` | `VoucherId` |  |

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
| Only active deals are shown. | Deal |  |
| Only active vouchers are shown. | Voucher |  |

## Integration & hotspots

_No relations declared. Either this domain stands alone, or the map is incomplete._
