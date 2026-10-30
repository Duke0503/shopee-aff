# D47 (One Shopee link per submission)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the independent architecture review).

## Decision

The bridge submits one link per Shopee custom-link submission, with sub_id1 = customer id and sub_id2 = request id. One bridge job never holds two customers. The server checks the returned link's host against an allow-list and resolves its redirect to check the sub_ids before attaching it.

## Rationale

sub_id cannot vary within a submission and links come back matched by position, so batches lose sub_id2 and can hand a link to the wrong request; the live code chose one link per submission for this reason (review H1, M16).

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/review-independent.md
- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/operations/status-flows.md
- docs/domain-model.json (decision `d47-one-link-per-submission`)
