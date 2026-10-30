# AGENTS.md — mmo cashback platform

Standing context for AI agents working in this repository. Keep this file to
conventions and commands only; long-form material is imported with `@path`.

## Project overview

Shopee/TikTok/Lazada affiliate cashback platform. Live production system today
is a Python backend (`src/cashback/`) + Node Zalo assistant
(`zalo_assistant/`) + React console (`web/`) + Chrome MV3 bridge
(`extension/`), sharing one SQLite file (`cashback.db`).

The repository is mid-migration to "Architecture v2": one TypeScript/Node
monorepo (NestJS + Fastify + Drizzle), same money rules to the đồng.
Authoritative design: @docs/architecture-v2/README.md
Read the glossary and the five money rules first: @docs/architecture-v2/00-overview/03-glossary.md

## Branch and isolation rules

- All v2 work happens on `main-v2`. Never commit v2 work to `main`.
- Production stays on Python until Phase 6. During the migration the old
  Python code owns the database schema (ADR-17) — the new server makes **no**
  schema changes on the live database.
- Every column has exactly one writer at any moment (see the writers table in
  the migration plan). Never add a second writer for a column.
- Do not commit `docs/architecture-v2/` or `_bmad-output/` while the GitHub
  repository is public.

## Verified commands

Python (existing production code):

```bash
uv run pytest                 # legacy pytest suite, testpaths = tests
uv sync                       # install Python deps
```

Monorepo (created in Phase 1):

```bash
pnpm install                  # install all workspace packages
pnpm build                    # build all packages/apps
pnpm lint                     # ESLint guardrails (naming, size, boundaries)
pnpm test                     # Vitest across packages
```

## v2 coding conventions

Full rules: @docs/architecture-v2/05-migration/03-coding-rules.md

- **Language:** code, comments, names, DB columns, env vars in **English**.
  No Vietnamese text and no emoji in `.ts`/`.tsx`. Customer wording lives only
  in `resources/messages.vi.json`; web labels in `resources/dashboard.vi.json`.
- **File names:** `kebab-case` + role suffix. Allowed roles:
  `.module .controller .use-case .repository .provider .registry .port .job
  .guard .client .source .template .page .schema .types .config .test`
  (`domain/` files have no role suffix, e.g. `customer.ts`). Frontend adds
  `.page.tsx`, `.queries.ts`, `use-*.ts`.
- **Classes/types:** `PascalCase`. **Functions/vars:** `camelCase`.
  **Constants:** `UPPER_SNAKE_CASE`. **DB columns:** `snake_case` (never
  renamed; Drizzle maps them to camelCase).
- **File size:** server `.ts` ≤ 400 lines; frontend `.tsx`/`.ts` ≤ 300 lines;
  one function ≤ 60 lines. A file at the limit is doing two jobs — split by
  job, not by line count.
- **Server layers:** `domain/` → `application/` → `infrastructure/` → `http/`.
  `domain/` is pure TypeScript: no NestJS, no Drizzle, no HTTP, no hidden
  `Date.now()` inside rules. `http/` may not touch repositories directly.
- **Module walls:** a module may import another module only through its
  `index.ts`. No import cycles. Cross-module needs are resolved with a
  `.port.ts` interface, wired in `app.module.ts`.
- **Base classes:** only after the same code appears in **three** places, and
  only one level deep (`Base → Child`). No `base.service.ts` /
  `base.controller.ts`. Helpers are plain functions, not parents.
- **No `fetch()` in React components** — use `*.queries.ts`. Icons from one
  file. Request bodies validated with Zod.

## Money rules — never break these

Checklist for any change touching money (full version in the coding rules):

- Cashback comes from the **approved** commission, never the estimate.
- An order with `paid_at` set is **skipped**, never changed — never pay twice.
- Shopee's part of a commission is capped at **40,000đ**; the shop's XTRA part
  is not. `total = min(price × shopeeRate, 40000) + price × shopRate`.
- All amounts are **whole đồng integers** (`number`). Never store floats.
- Rounding goes through the shared **`roundDong()`** (half-up: 9,262.5 →
  9,263). **One exception:** the service fee and withheld tax inside
  `splitCommission` use `legacyRoundHalfEven()` (Python `round()`, half to
  even) to match today's code exactly. Used nowhere else.
- Cashback split: `fee = C × 0.98%`, `tax = C × 10%` (only in a withheld
  period), `net = C − fee − tax`, `cashback = roundDong(net × CASHBACK_RATE)`,
  `operator = net − cashback`, where `CASHBACK_RATE = 0.80`.
- A link is reused only for **the same customer** (`sub_id1` = customer id).
  Guest (`HOUSE`) gets **0đ**, no payout, no messages.
- Every `sub_id` is validated: **letters and digits only** (`a-zA-Z0-9`).
- Money maths lives **only** in `packages/money`; the frontend never
  calculates money.
- A golden test must cover any money change.

## Known pitfalls

- `round()` in Python and `Math.round()` in JS are **not** the same as money
  rounding; do not use them for money outside `legacyRoundHalfEven()`.
- Every write transaction starts with `BEGIN IMMEDIATE` (WAL mode); waits are
  short (`busy_timeout = 5000`) with one retry — better-sqlite3 blocks the
  whole process.
- Never trust the caller's source address for permissions. Internal routes
  require `X-Assistant-Token`; the browser bridge requires `X-Bridge-Token`;
  `trustProxy` stays off.
- Never wait inside a Shopee page script; Chrome throttles background timers.
  All waiting happens on the server.
