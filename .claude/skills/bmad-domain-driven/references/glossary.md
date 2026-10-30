# Glossary: cashback business language and the DDD terms used in the model, the shared page and the Mary/Winston discussions

> Single source for names. The renderer (`scripts/render_domain_model.py` reads the business
> table below; its `GLOSSARY` list holds the DDD terms) and everything an agent says follow these two tables. The
> project is written entirely in English. Use DDD terms as written here; do not invent synonyms.
> Business names (aggregate, event, what a rule is about) are plain English words of the cashback business.

## Business language (the ubiquitous language of the cashback platform)

> Words every page and every agent sentence uses with exactly one meaning. Write the way the
> team talks: short sentences, a subject, what happens. This table is the single source:
> `scripts/render_domain_model.py` reads it at render time. When the domain changes, edit
> this table only.

| Term | Meaning |
|---|---|
| **Affiliate network** | A program that pays a commission for purchases it can trace to a partner link: Shopee Affiliate, TikTok Shop through AccessTrade, Lazada |
| **Affiliate link** | A product link that carries the operator's affiliate id and a sub_id. A purchase through it earns a commission |
| **Link request** | One customer's request to turn one product URL into an affiliate link. It belongs to exactly one customer |
| **sub_id** | A tag on an affiliate link that the network reports back with each order. sub_id1 is the customer id. Letters and digits only |
| **Share link** | The operator's own short link (hoantiendp.com/s/<code>) that redirects to one affiliate link. One per link request |
| **Link click** | One visit to a share link by a person. Preview bots do not count |
| **Link delivery** | The moment a customer receives a finished link, in chat or on the web. A delivered link is never sent again |
| **Attribution window** | The days after a link request during which a repeat request reuses its link. It is not the link's expiry; a link never expires |
| **Customer** | A person who earns cashback. Identified by a customer id that never changes, and shown a customer code |
| **Customer id** | The permanent identity of a customer, today the Zalo UID. It is written in sub_id1 of every link the customer received |
| **Customer code** | The short code a customer sees and signs in with, for example DP00012. Never reused after deletion |
| **Customer alias** | An old customer id kept after a merge, so orders on old links still reach the right customer |
| **Guest account (HOUSE)** | The account that owns links made without a customer code. The operator keeps the commission; cashback is always 0 |
| **Staff** | A team member account. Staff never hold a campaign slot |
| **Product lookup** | Reading a product's price and commission rates from the network before a link is made. Reads page 1 only |
| **Estimated commission** | The commission the network predicts when an order is placed. Shown for reference only, never paid from |
| **Approved commission** | The commission the network confirms after the return window. The only base for cashback |
| **Commission cap** | Shopee caps its own part of a commission at 40,000 dong per order. The shop's XTRA part has no cap |
| **XTRA commission** | The extra commission a shop adds on top of Shopee's rate. Not covered by the commission cap |
| **Commission split** | How an approved commission is divided: service fee 0.98%, withheld tax 10% in a withheld period, then net |
| **Cashback** | The customer's share of the net commission, 80%, rounded half-up to a whole dong |
| **Operator share** | The net commission minus the cashback. What the operator keeps |
| **Order** | One purchase the network reports, attributed to a customer through sub_id1 of the link it came from |
| **Order approval** | The network confirms an order's commission. The cashback becomes owed to the customer |
| **Order cancellation** | The network rejects an order. No cashback is owed |
| **Reconciliation** | Matching the network's conversion report to link requests and orders. Runs over overlapping periods, so it must be idempotent |
| **Payout** | One bank transfer to one customer that covers all of their approved, unpaid orders. The operator decides when to pay |
| **Paid order** | An order with a payout time (paid_at). It is never changed or paid again |
| **Bank account** | Where a customer receives payouts. A missing bank account is the only thing that blocks a payout |
| **Dong (VND)** | The money unit. Every amount is a whole number of dong; no fractions are stored |
| **Half-up rounding** | Money rounds .5 upwards (9,262.5 becomes 9,263), unlike banker's rounding |
| **Example amount** | A worked amount in dong shown next to every percentage, because a percentage alone is misread as a share of the price |
| **Campaign** | A limited event that gives a bonus to the first N qualifying orders recorded inside its time window |
| **Campaign slot** | One of a campaign's N places. It belongs to an order, not a person, and passes on if that order is cancelled during the event |
| **Held slot / bonus** | A slot whose order is not yet approved is held. The bonus is paid only with the approved order's cashback |
| **Zalo assistant** | The personal Zalo account that answers customers in chat and delivers links. Losing it cuts contact with every customer |
| **Notification** | A message the system starts on its own: late link, order recorded, order approved, payout sent |
| **Browser bridge** | The Chrome extension that runs short scripts in the operator's signed-in affiliate tab to make links and read rates |
| **Link queue** | The ordered list of link requests waiting for the browser bridge. Zalo first, then web customers, then guests |
| **Web quota** | The limit on links made from the website: 60 per hour for the whole site, 20 per day per customer code |
| **Customer message** | Any text a customer reads. Lives only in the message files, never in code |

## Strategic design

| Term | Short meaning | Usage note |
|---|---|---|
| **Domain** | The business area the system serves | "the cashback domain" |
| **Subdomain** | A part of the domain, ranked by how much to invest | core / supporting / generic |
| **Core** | What makes the platform different; invest deeply | keep the word "core" |
| **Supporting** | Needed, but every competitor needs it too; build just enough | keep the word "supporting" |
| **Generic** | Plumbing with no business edge; buy or keep thin | keep the word "generic" |
| **Bounded Context** | The boundary of one model and its language; the same word may mean something else in the next context | short form "context"; here a context is usually a service or package |
| **Ubiquitous Language** | The vocabulary shared by the business and the code inside one context | the "Ubiquitous language" section on the page |
| **Context Map** | The map of which context calls, listens to or references which | |
| **Open-host service** | A context opens a stable API for many callers | relationship pattern |
| **Published language** | A context publishes events or contracts others listen to | relationship pattern |
| **Customer–supplier** | Two sides negotiate the contract; the consumer is the customer | relationship pattern |
| **Conformist** | The consumer accepts the supplier's language and does not translate | relationship pattern |
| **Anti-corruption layer (ACL)** | A layer that translates an outside language into our own | also a building block |
| **Shared kernel** | A small part of the model that two sides own and change together | e.g. the shared money package |
| **Partnership / Upstream–downstream / Separate ways** | Evolve together / one side leads / go separate ways | relationship pattern |

## Tactical design (building blocks)

| Term | Short meaning | Usage note |
|---|---|---|
| **Building block** | A named DDD piece in the model (aggregate, entity, value object, service…) | |
| **Aggregate** | A group of data that must be correct together; every change goes through one door | "the LinkRequest aggregate" |
| **Aggregate root** | The record at the head of an aggregate and its only entry point | |
| **Entity** | Something with its own identity that lives over time | |
| **Value object** | A value with no identity, compared by content (Money, CommissionRate) | |
| **Domain primitive** | A single constrained value type (CustomerCode, SubId) | |
| **Invariant** | A condition that must never be false inside an aggregate | the "Invariants" section |
| **Rule** | A named business rule; classified by `kind` below | |
| **Policy** | A named decision that changes with context or time ("a guest link never earns cashback") | |
| **Specification** | A reusable test ("an order is payable when…") | |
| **Authorization** | A rule about who may do what | rule kind |
| **Uniqueness** | A rule against duplicates | rule kind |
| **Workflow** | A rule about the order of steps | rule kind |
| **Lifecycle** | The states an aggregate passes through and the steps between them | "the Order lifecycle" |
| **State / Transition / Guard** | A state / a step between states / a condition that must hold before the step | |
| **Command** | A request to do something (`confirm`, `approve`); can be refused | the "Commands" section |
| **Use case** | What a user does with the domain, usually several commands | |
| **Event** (domain event) | Something that already happened, in past tense (`orders.order.approved`); other contexts can react | the "Events" section |
| **Domain service** | A business operation that belongs to no single aggregate | |
| **Repository** | The door for reading and writing one aggregate | |
| **Factory** | The place that creates an aggregate when creation has many rules | |
| **Port** | An interface a context declares to call out or to be called | "the Affiliate Network port" |
| **Adapter** | The implementation of a port for one concrete system (Shopee browser bridge, AccessTrade API, Zalo assistant) | |
| **Process manager** | A process that coordinates several aggregates over time (the reconciliation run that approves orders) | |
| **Read model** | Read-only data built from another source for display or reports; holds no rules | |
| **EventStorming** | Reading a domain as sentences: actor → command → aggregate → event ← policy | sticky colours on the page follow this grammar |
| **Hotspot** | A spot that is unclear or disputed, recorded as an open question | |

## Status and reference codes

| Symbol | Meaning |
|---|---|
| `observed` | exists in code today |
| `target` | agreed goal, not yet coded |
| `proposed` | suggested, not agreed |
| `unknown` | not yet known |
| `accepted` / `rejected` / `superseded` | decision approved / rejected / replaced by a later one (keep the original text; `supersededBy` points at the new D) |
| `open` / `resolved` / `deferred` | question open / answered / postponed |
| **D12** | Decision number 12 in `docs/domain-model.json` and `.context/decisions/` |
| **OQ8** | Open question number 8 |

**Rule for mentioning D/OQ:** every time a code appears in speech, a log or the model, add its
short content right after it: "D3 (cashback is calculated from the approved commission only)",
"OQ4 (who owns the network list when a new affiliate network is added)". The reader never has to look it
up. The renderer annotates codes on the page; agents must do it themselves when they speak.

## Writing style for the model and the pages

Standard sentence: **"An order becomes payable only after the network approves its commission."** One
sentence, one idea, a subject, what happens and when. Applies everywhere there is text:
description, invariant, rule, transition, event, use case, building block purpose, relation.

- Subject first: *The reconciliation approves the order*, *The assistant delivers the link*,
  *The operator sends the payout*. Avoid the passive when someone does the act.
- Keep each sentence under about 20 words. A second idea gets a new sentence. No long dashes or
  semicolons as joiners; no parenthesis that holds a whole clause.
- Say the business act, not the code: *"the order moves to approved"* instead of *"UPDATE status
  = ACTIVE"*. Field names and function names appear only when the reader must go find that exact place.
- A D/OQ code always carries its short content; the renderer annotates it on the page, agents do
  it in speech.
- Use the DDD terms from the tables above. Use the business words with the meaning in the
  "Business language" table; do not coin a new word for something that already has a name.
- Transition: who acts and on what condition; a side effect states the business consequence
  (*"the customer balance grows"*), not a technical command.
- Event: write it as something that just happened, with a subject, so another context knows what
  to react to. Name it `<context>.<aggregate>.<past-tense>` (for example `orders.order.approved`).
- Command: imperative (`confirm`, `invalidate`). Do not translate or alias command and event names.
