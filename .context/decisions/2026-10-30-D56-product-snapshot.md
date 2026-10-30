# D56 (product snapshot at link creation)

- Status: accepted
- Date: 2026-10-30
- Approved by: the project owner asked for product images on order and dashboard screens; the snapshot design was chosen as the recommended option.

## Decision

A link request stores a product snapshot (name, image URL, price, rates) taken once at link creation. An order shows the snapshot of its link request; an order attributed without a request uses the name and image from the network report. No screen resolves product details at read time.

## Rationale

The live system resolves name and image through four fallback lookups on every read, so lists show images inconsistently. The owner asked for product images on the order and dashboard screens.

## Consequences

- Every admin list with a product shows a 32 px thumbnail and the name on one line; a missing or broken image shows a grey placeholder.
- Images are referenced by URL; the server may later cache them locally without changing the model.

## Links

- docs/domain-model.json (decision `d56-product-snapshot`)
