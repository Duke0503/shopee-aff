# Q&A: open questions and decision log

Open questions are grouped by who must answer. Decisions are newest first. `proposed` means not yet signed off by the project owner.
Decide in the meeting, then record the result in `.context/decisions/` and `docs/domain-model.json`. This file is generated only.

## Open questions (6)

### Project owner (3)

| Code | Question | Impact | Context | Who answers | Status |
|---|---|---|---|---|---|
| `OQ6` | Does the owner confirm D1 (Every amount is a whole number of dong. Money rounds half-up through one shared helper) to D13 (A customer who is still owed money is never deleted, except by an explicit forced action of the operator), the rules carried over from the live system, as accepted for the new platform? | Until confirmed they stay proposed and the model treats them as candidates. |  | Project owner | `open` |
| `OQ5` | Does a copy of the earlier docs/architecture-v2 folder exist on another machine? | It would be useful reference input for the re-plan. |  | Project owner | `open` |
| `OQ3` | Which affiliate networks are in the first release: Shopee only, or also TikTok Shop through AccessTrade and Lazada? | Decides whether the Affiliate Network port needs more than one adapter at launch. |  | Project owner | `open` |

### Architect, confirmed by the project owner (2)

| Code | Question | Impact | Context | Who answers | Status |
|---|---|---|---|---|---|
| `OQ2` | Does the re-plan keep the TypeScript monorepo stack of the earlier v2 work (NestJS, Fastify, Drizzle, React)? | Decides how much of the main-v2 code can be reused. |  | Architect, confirmed by the project owner | `open` |
| `OQ1` | Does the re-planned platform keep SQLite, or move to PostgreSQL? | Decides the migration path, backups and how many writers can run at once. |  | Architect, confirmed by the project owner | `open` |

### Architect (1)

| Code | Question | Impact | Context | Who answers | Status |
|---|---|---|---|---|---|
| `OQ4` | Who owns the network list when a new affiliate network is added? | Decides which context holds network rules such as caps, sub_id format and report shape. |  | Architect | `open` |

## Decisions (16)

### Proposed, awaiting sign-off (13)

| Code | Date | Decision | Why | Context | Status |
|---|---|---|---|---|---|
| `D13` |  | A customer who is still owed money is never deleted, except by an explicit forced action of the operator. | Deleting such a customer loses a debt the operator must still pay. |  | `proposed` |
| `D12` |  | The approved commission is split as service fee 0.98%, withheld tax 10% in a withheld period, then net. Cashback is 80% of net; the operator keeps the rest. | These are the rates the live system pays today. |  | `proposed` |
| `D11` |  | Every approved, unpaid order is payable, grouped by customer. The operator decides when to pay, so no message promises a date. | The old 50,000 dong threshold was a rule customers could not see or act on. |  | `proposed` |
| `D10` |  | Only the Zalo assistant creates customers. The public web signs in or accepts an existing code; an unknown code is not found. | The assistant has just seen the person in Zalo; the web cannot prove who someone is. |  | `proposed` |
| `D9` |  | Customer chat runs on one personal Zalo account at a human pace. No bulk messages and no bulk friend requests. | The Zalo Bot API is gone since 2026-09-25. A locked account cuts contact with every customer at once. |  | `proposed` |
| `D8` |  | Every call to Shopee goes through the operator's real signed-in browser. No code rebuilds Shopee's signature headers or calls its internal APIs directly. | The Open API was refused on 2026-09-10; direct calls put the whole session into captcha; forged signatures risk the affiliate account. |  | `proposed` |
| `D7` |  | Every sub_id holds letters and digits only, and one link batch never mixes customers. | A dash silently breaks attribution; the network applies one sub_id to every link in a batch. |  | `proposed` |
| `D6` |  | A link belongs to exactly one customer through sub_id1. A link is reused only for the same customer; product facts (price, rates) may be shared. | Reusing a link by product sent customer B's money to customer A in production (fixed on 2026-09-25). |  | `proposed` |
| `D5` |  | A link made without a customer code belongs to the guest account HOUSE. A guest link never earns cashback, and its orders are never moved to a customer who registers later. | All guests are the same payee, so one link per product is enough and the operator keeps the commission. |  | `proposed` |
| `D4` |  | An order with a payout time (paid_at) is never changed or paid again. | Reconciliation runs over overlapping periods; without this lock one order is paid two or three times. |  | `proposed` |
| `D3` |  | Cashback is calculated from the approved commission only, never from the estimate shown to the customer. | The estimate changes or disappears after returns; paying from it loses money. |  | `proposed` |
| `D2` |  | Shopee's part of a commission is capped at 40,000 dong per order. The shop's XTRA part is not capped. | Checked on 18 of 18 products. Forgetting the cap promised almost three times the real amount. |  | `proposed` |
| `D1` |  | Every amount is a whole number of dong. Money rounds half-up through one shared helper. | Python round() and JS Math.round() round half to even or toward infinity; every tool in the market shows 9,263 for 9,262.5. |  | `proposed` |

### Accepted (3)

| Code | Date | Decision | Why | Context | Status |
|---|---|---|---|---|---|
| `D16` | 2026-10-30 | Planning documents (docs/, .context/, _bmad-output/) are committed. The GitHub repository is made private first. | The earlier v2 design documents were lost because they were never committed. |  | `accepted` |
| `D15` | 2026-10-30 | Code, docs, the domain model, decisions and logs are written in English. Chat follows the person's language. Customer-facing text is Vietnamese and lives only in the message and label files. | One ubiquitous language in documents and code; customers read Vietnamese. |  | `accepted` |
| `D14` | 2026-10-30 | The platform is re-planned from scratch: domain model, UX, architecture and PRD come before any code. The current Python system and the earlier v2 TypeScript code are reference only. | The owner wants the web and the architecture redesigned and optimized; the earlier v2 design documents are not in the repository. |  | `accepted` |

