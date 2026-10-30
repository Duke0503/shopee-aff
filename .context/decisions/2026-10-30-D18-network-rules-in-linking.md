# D18 (The Link Issuing context owns the affiliate network catalog: caps, sub_id format, link creation and report shape per network)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Found while extracting the domain from the live code (src/cashback, apps/server).

## Decision

The Link Issuing context owns the affiliate network catalog: caps, sub_id format, link creation and report shape per network. Other contexts read it as published language.

## Rationale

Network rules change together with link creation; one owner avoids two copies drifting, as the Shopee domain list once did.

## Links

- docs/domain-model.json (decision `d18-network-rules-in-linking`)
