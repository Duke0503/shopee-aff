# Writing standard

Applies to every document, story, decision record, commit message, identifier and log event the
team writes. The goal is text that a newcomer understands on first reading and that a specialist
accepts as correct.

## The rule in one line

Use the correct, standard term of the field, and explain it in plain words the first time it
appears.

## How to write

1. **Choose the standard term.**

   | Instead of | Write |
   |---|---|
   | the money Shopee says we might get | the estimated commission |
   | the money Shopee confirmed | the approved commission |
   | checking the report against our links | reconciliation |
   | running it twice changes nothing | the run is idempotent |
   | the tag on the link | sub_id (sub_id1 is the customer id) |
   | sending the money | the payout |
   | people without a code | guests (the HOUSE account) |

2. **Define on first use.** "Reconciliation, matching the network's conversion report to our link
   requests, …". After that, use the term alone.
3. **Keep sentences short and direct.** One idea per sentence, active voice, concrete subjects:
   "The reconciliation approves the order", not "The order is approved".
4. **Be precise with numbers and units.** "40,000 dong", "80% of net", "60 links per hour". Every
   percentage shown to a customer comes with an example amount in dong.
5. **Use one term for one thing.** The business glossary in
   `.claude/skills/bmad-domain-driven/references/glossary.md` is the reference vocabulary.
6. **Avoid filler and hype.** No "basically", "super", no exclamation marks in documentation.
7. **Write for a reader whose first language is not English.** No idioms or slang.

## Ubiquitous language

The same domain terms are used in documents, code, API routes, database tables, logs, tests and
commits. A missing term is added to the glossary first, then used.

| Where | Example |
|---|---|
| Code identifiers | `LinkRequest`, `approvedCommission`, `markPaid()`; not `Item`, `data`, `handle()`, `Manager` |
| API routes and error codes | `POST /api/links`, `web_busy`, `customer_not_found`; not `/api/doAction`, `error_1` |
| Tables and columns | `link_requests`, `approved_commission_vnd`, `paid_at`; not `tbl_data`, `value2` |
| Logs | `order.approved order_id=… customer_id=…`; not `processing done` |
| Tests | `never_pays_an_order_twice`; not `test1` |

Words that carry no meaning are not used: "data", "info", "item", "thing", "handle", "process",
"manage", "misc", "temp", "OK", "Something went wrong".

## Customer-facing text

Customers read Vietnamese. That text lives only in `resources/messages.vi.json` (chat messages)
and `resources/dashboard.vi.json` (web labels), never in code. It follows the same rules: the
exact amount, what happened, what to do next, and no promised payout date.
