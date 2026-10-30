# Cashback Platform

An affiliate cashback platform (hoantiendp.com) for Shopee, TikTok Shop and Lazada. Customers get
a link through Zalo or the website, buy, and receive a share of the approved commission. Start
with `docs/index.md`.

**The platform is being re-planned from scratch (D14).** Planning comes first: domain model, PRD,
UX, architecture. Do not start implementation without the project owner's go-ahead. Production
still runs the Python system from `main`, often in this same folder on the operator's machine.

## Layout

One monorepo. Start Claude Code at the repository root so every skill and rule loads.

| Path | What it holds |
|---|---|
| `docs/` | Source of truth for the re-plan (`index.md`, `rules/`, `domain-model.json`) and the Vietnamese notes on the current system (`01-business/` to `04-reference/`, `reference/`) |
| `.context/` | Discussion logs and approved decisions |
| `_bmad/`, `_bmad-output/` | BMAD Method config, and the PRD, UX, architecture, epics and stories it produces |
| `.claude/skills/` | BMAD Method skills, `bmad-domain-driven`, and the project skills `cashback-shadcn`, `cashback-ui-review` (design), `cashback-security-model`, `cashback-infra` (architecture), adapted from MIT and Apache-2.0 sources listed in each `UPSTREAM.md`. The C4 guide for `bmad-architecture` and the story guide are in `_bmad/custom/` |
| `src/cashback/`, `zalo_assistant/`, `web/`, `extension/` | The live system: Python backend, Zalo assistant, React web, Chrome browser bridge |
| `apps/`, `packages/` | The new platform (pnpm workspace): `apps/server`, `packages/money`, `packages/core`, `packages/contracts`, `packages/golden` |
| `reference/v2/` | The earlier v2 TypeScript attempt. Read-only reference, outside the workspace (D14) |
| `resources/` | Customer messages and web labels (Vietnamese) |

Git rules are in `docs/rules/git.md`.

## Commands (new platform, main-v2)

pnpm 12 through corepack (`corepack enable pnpm`). Node 24.

```bash
pnpm install          # workspace install (esbuild build allowed in pnpm-workspace.yaml)
pnpm test             # Vitest in every package, golden money fixtures included
pnpm typecheck        # tsc per package
pnpm lint             # code.md guardrails: names, sizes, money rounding, clock, process.env
pnpm depcruise        # module boundaries
pnpm guard:paths      # fails if production paths owned by main changed
cd apps/server && INTERNAL_TOKEN=<32+ chars> pnpm dev   # public :9080, internal :9081 (dev ports)
```

`reference/v2/` holds the earlier v2 attempt, read-only and outside the workspace.

## Planning work

- The workflow and the location of every current artifact are in `docs/index.md`. Keep its
  "Current planning artifacts" table up to date.
- The domain model lives in `docs/domain-model.json` and is managed with the `bmad-domain-driven`
  skill. Generated views in `docs/domain-viz/` are never edited by hand (`make domain-render`).
- Every status, its trigger and its customer sentence are defined once in
  `docs/operations/status-flows.md` (Operations Lead, party member `ops-lead`).
- Approved decisions live in `.context/decisions/` and in the model. A suggestion is not a
  decision until the project owner confirms it.

## Design work

Applies whenever the conversation is about screens, layout, colours or UX, even without a command.

- The UX source of truth is the `bmad-ux` workspace listed in `docs/index.md`: `DESIGN.md` (look),
  `EXPERIENCE.md` (behaviour) and `.memlog.md` (decisions). Read the memlog first. Record every
  design decision there with `bmad-ux`; never decide silently.
- Two surfaces: the customer website (phone-first, most customers come from a Zalo chat) and the
  admin desk (dense work tool). Every screen covers phone, tablet and desktop.
- Wireframes are in `docs/design/wireframe/cashback.pen`, opened in pen.dev and edited only through
  the `pencil` MCP tools; sections are listed in `docs/design/wireframe/README.md`.
- Use `cashback-design-craft` (brand, anti-"AI look", copy, responsive), `ui-ux-pro-max` (style
  data), `cashback-shadcn` (build rules) and `cashback-ui-review` (review).
- The customer website must be very easy to use: one main task per screen, the fewest choices,
  plain words. Every code is a copyable code chip; one value per table column.

## Rules

- **Everything is written in English** (D15): code, comments, docs, commit messages, the domain
  model, decisions and logs. **Chat in the person's language**; record a decision given in
  Vietnamese in English.
- **Customer-facing text is Vietnamese** and lives only in `resources/messages.vi.json` and
  `resources/dashboard.vi.json`. No Vietnamese and no emoji in code.
- **Professional and plain.** Standard terms, defined on first use, short sentences, the same
  domain terms everywhere (ubiquitous language). Rules in `docs/rules/writing.md`.
- Planning documents are committed; the GitHub repository must be private first (D16).

## Money rules (D1 to D13, carried over from production)

These held the live system together. Every design, story and line of code respects them.

1. Cashback comes from the **approved** commission, never the estimate (D3).
2. An order with `paid_at` set is never changed or paid again (D4). Reconciliation runs over
   overlapping periods, so it must be idempotent.
3. Shopee's part of a commission is capped at **40,000 dong** per order; the shop's XTRA part is
   not: `total = min(price x shopeeRate, 40000) + price x shopRate` (D2).
4. Amounts are whole dong integers. Rounding is half-up through one shared helper (D1).
5. Split: fee 0.98%, withheld tax 10% in a withheld period, net, cashback = 80% of net (D12).
6. A link belongs to one customer through sub_id1 and is reused only for that customer (D6).
   sub_id is `a-zA-Z0-9` only; one link batch never mixes customers (D7).
7. A guest link (HOUSE) earns 0 cashback, gets no payout and no messages (D5).
8. Only the Zalo assistant creates customers; the web never does (D10).
9. No payout threshold, and no message promises a payout date (D11).
10. A customer still owed money is never deleted (D13).
11. Every percentage shown to a customer comes with an example amount in dong.

## Dead ends and pitfalls (from the live system)

Full detail, in Vietnamese: `docs/reference/v1-handover.vi.md` and
`docs/04-reference/shopee-api-findings.md`.

- Shopee Open API was refused; direct calls to its internal API put the whole session into
  captcha. Never rebuild signature headers. Every Shopee call goes through the real browser (D8).
- Read only page 1 of a commission lookup; paging triggers `verify/traffic/error`.
- Chrome throttles background tabs: never wait inside a page script; wait on the server.
- One personal Zalo account, one session, a human pace. No bulk messages or friend requests (D9).
  Zalo UIDs differ per viewing account; changing the bot account needs a customer merge.
- Purchases made inside Zalo's in-app browser are not attributed; chat sends the share link
  (`hoantiendp.com/s/<code>`), which opens a real browser.
- Affiliate links never expire; the attribution window only decides when to make a fresh request.
