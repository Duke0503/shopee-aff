# DDD Pattern Guide

Use this guide when deciding what belongs in `domain-model.json`. It is a decision aid, not a
catalog of every DDD term.

## Strategic patterns

### Subdomain classification

| Type | Test | Modeling posture |
|---|---|---|
| Core domain | If this disappeared, would the product lose its differentiation or reason to exist? | Invest in domain experts, explicit language, rich aggregates, rules, events, and tests. |
| Supporting subdomain | Does the business need it, but would competitors also need roughly the same capability? | Keep the model clear and intentionally modest. |
| Generic subdomain | Is this commodity capability with established solutions? | Buy, reuse, or simplify. Do not make it a bespoke core. |

Classification is a hypothesis backed by evidence, not a permanent label. Record rationale and
review date in `strategicModel` or `decisions`.

### Bounded contexts

A bounded context is a boundary around a model and its language. A context should have a clear
purpose, owner, vocabulary, and set of invariants. Similar words in two contexts may legitimately
mean different things.

Use context-map patterns when they clarify the relationship:

- `upstream-downstream`: downstream protects itself from upstream changes;
- `customer-supplier`: both teams negotiate an explicit contract;
- `partnership`: both sides evolve together;
- `conformist`: downstream accepts upstream language because translation is not worth it;
- `anti-corruption-layer`: downstream translates upstream concepts into its own model;
- `open-host-service` / `published-language`: stable public contract for many consumers;
- `shared-kernel`: a deliberately small, jointly owned model;
- `separate-ways`: independent solutions with no integration.

## Tactical building blocks

| Building block | Use it for | Avoid |
|---|---|---|
| Aggregate root | Entry point and invariant owner for an aggregate boundary | Treating every table or CRUD resource as a root |
| Entity | Identity and behavior over time | An anemic record with all behavior elsewhere |
| Value object | Immutable concept defined by values | Primitive obsession and repeated validation |
| Domain primitive | Constrained single concept such as `Sku`, `Email`, or `OrderId` | Passing raw strings/UUIDs across the domain |
| Domain service | Stateless domain operation spanning concepts with no natural owner | Application orchestration or a miscellaneous utility class |
| Repository | Collection-like persistence boundary for an aggregate root | Querying child tables directly from every caller |
| Factory | Rule-heavy or multi-step creation | Hiding simple constructors behind ceremony |
| Specification | Reusable, composable predicate or invariant | Scattering the same rule across controllers and services |
| Policy | Named decision that varies by context, actor, or time | Hard-coded branching with no business name |
| Domain event | Past-tense fact that other parts may react to | Command, RPC, or a promise that something should happen |
| Port | Owned interface for a dependency crossing a boundary | Importing another context's implementation |
| Adapter / ACL | Translation between models or protocols | Leaking upstream vocabulary into the downstream domain |
| Read model | Query-optimized projection that is not an invariant owner | Treating a denormalized view as the write model |

## Aggregate boundary heuristics

Keep concepts in one aggregate when they must change atomically to preserve an invariant. Split
them when they have independent transactions, lifecycles, ownership, scaling needs, or language.
Across aggregate boundaries prefer IDs, commands, domain events, or translated snapshots.

An aggregate review should answer:

1. What is the root?
2. Which invariants must hold synchronously?
3. Which child entities cannot exist outside the root?
4. What may be eventually consistent?
5. What event is emitted after a meaningful state change?

## State machine and lifecycle

Model state as a domain fact when it changes what actions are legal, what data is valid, who may
act, or what event is emitted. For each transition capture:

- guard: invariant, specification, or policy;
- actor/authorization when relevant;
- emitted event;
- side effect or follow-up command;
- whether the transition is reversible, terminal, or compensating.

Do not use a state machine to hide a workflow that spans multiple aggregates. That workflow belongs
in an application service/process manager/saga, with each aggregate changing through its own
invariants.
