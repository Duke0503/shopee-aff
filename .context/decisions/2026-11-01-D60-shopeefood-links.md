# D60 (ShopeeFood links are supported)

- Status: accepted
- Date: 2026-11-01
- Approved by: the project owner ("sẽ có shopeefood nhé", 2026-11-01).

## Context

The re-plan listed Shopee and TikTok Shop (through AccessTrade) as the supported networks and refused
everything else (D17). The production backup (2026-10-30) shows the live system also makes ShopeeFood
links: 5 requests for `shopeefood.vn` links (`/u/<code>` short links and `/now-food/shop/<id>`),
answered with `spf.shopee.vn` affiliate links. No ShopeeFood order has been recorded yet.

The live provider (`src/cashback/providers/shopeefood_provider.py` on `main`):

- accepts `shopeefood.vn`, `food.shopee.vn` and `shopee.vn/now-food` links;
- resolves `/u/` and `/share/` short links and reads the shop id from a group-order invite token
  (`/group-order/invite?token=<base64 JSON with shopId>`), giving `https://shopeefood.vn/now-food/shop/<shopId>`;
- makes the link with the same Shopee Affiliate custom-link generator as Shopee products, with
  sub_id1 = customer and sub_id2 = request id;
- shows no amount estimate ("Tích lũy theo quán"): commission depends on the shop.

## Decision

ShopeeFood is a supported link source on the Shopee network. A ShopeeFood link goes through the same
browser bridge job as a Shopee product link (D8: never a server-side call to Shopee, so short links
and invite pages are resolved in the real browser), carries the same sub_ids and the same link checks
(Story 5.4), and its orders arrive in the Shopee conversion report and are reconciled and paid under
the Shopee money rules. The reuse key is the shop (`shopeefood:<shopId>`). There is no amount
estimate; the reply says cashback is counted per shop once the order is approved. D17's refusal text
names Shopee, ShopeeFood and TikTok Shop.

## Consequences

- New Story 5.11 in Epic 5, scheduled in Sprint 24.
- `packages/core` host lists gain the ShopeeFood domains; refusal labels change.
- Reconciliation must accept report rows whose item or channel marks ShopeeFood without treating them
  as unknown; this is checked against a real report row once one exists (open question).
