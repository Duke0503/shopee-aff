# D8 (Every call to Shopee goes through the operator's real signed-in browser)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner, who asked for the recommended option at every question. The owner may overturn it.

## Context

Carried over from the live system (docs/reference/v1-handover.vi.md).

## Decision

Every call to Shopee goes through the operator's real signed-in browser. No code rebuilds Shopee's signature headers or calls its internal APIs directly.

## Rationale

The Open API was refused on 2026-09-10; direct calls put the whole session into captcha; forged signatures risk the affiliate account.

## Links

- docs/domain-model.json (decision `d8-real-browser-only`)
