# Code rules

Applies to all new TypeScript code in `apps/` and `packages/`. Derived from the architecture spine
(`_bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md`);
the `AD-n` ids point at the decision behind each rule. Where this file and the spine disagree, the
spine wins and this file is fixed. Production code on `main` (Python) is not covered.

## 1. Layering and boundaries (AD-1, AD-4)

- The server has seven modules, one per bounded context: `identity`, `linking`, `orders`,
  `payouts`, `campaigns`, `messaging`, `operations`.
- Inside a module: `domain/` ← `application/` ← `infrastructure/`, `http/`. Arrows point to what
  may be imported.
- `domain/` is pure TypeScript. It imports only `packages/money`, `packages/domain`,
  `packages/time`, `packages/text`. No Fastify, no Drizzle, no I/O, no `Date.now()`.
- `http/` calls `application/` only. It never touches a repository or the database.
- A module imports another module only through its `index.ts`, and only along the edges of the
  spine's dependency diagram. `messaging` and `operations` are reached through the `outbox` and
  `audit` / `alert` ports in `platform/`.
- A table is written only by the module that declares it. Other modules read it through the
  owner's query functions; list read models (`*.list.ts`) may join read-only.
- No import cycles. dependency-cruiser checks the edges in CI.
- Base classes only after the same code appears three times, one level deep. Helpers are plain
  functions.

## 2. Naming

- English everywhere (D15). No Vietnamese and no emoji in code; customer text is a key into
  `resources/messages.vi.json` or `resources/dashboard.vi.json`.
- Use the glossary terms (`docs/rules/writing.md`): `approvedCommission`, `cashback`, `payout`,
  `reviewCase`, `linkRequest`, `shareCode`.
- Files: `kebab-case` with a role suffix. Server roles: `.routes`, `.command`, `.query`,
  `.repository`, `.list`, `.adapter`, `.port`, `.job`, `.guard`, `.schema`, `.types`, `.config`,
  `.test`. `domain/` files have no suffix (`transition.ts`). Frontend: `.page.tsx`, `.queries.ts`,
  `use-*.ts`, components in `kebab-case.tsx`.
- Types and components `PascalCase`; functions and variables `camelCase`; constants
  `UPPER_SNAKE_CASE`; tables and columns `snake_case`, tables plural; status values
  `UPPER_SNAKE_CASE`.
- Domain events and log events: `context.aggregate.verb` (`orders.order.approved`).

## 3. Size limits (NFR-9)

- Server `.ts` file: at most 400 lines. Frontend `.ts` / `.tsx` file: at most 300 lines. One
  function: at most 60 lines.
- A file at the limit is doing two jobs: split by job, not by line count. ESLint enforces the
  limits.

## 4. Money checklist (AD-5, AD-6, AD-9; CLAUDE.md money rules)

Every change that touches money passes all of these:

- [ ] Money is computed only in `packages/money`. The frontend, SQL and exports never compute it.
- [ ] Every amount is a whole-dong integer. No floats in columns, fields or intermediate stored
      values.
- [ ] Rounding uses `roundHalfUp` from `packages/money`; never `Math.round`, `toFixed` or a
      local helper.
- [ ] Cashback comes from the approved commission, never the estimate (D3), and is stored on the
      order at approval.
- [ ] Shopee's part is capped at 40,000 dong; the XTRA part is not (D2).
- [ ] Split: fee per network, tax 10% in a withheld period, net, cashback = 80% of net (D12, D20).
- [ ] An order with `paid_at` set is never changed by reconciliation (D4); only payout confirm and
      void set or clear it.
- [ ] The payable balance comes only from the payouts module's `getBalances` (D27).
- [ ] FROZEN and REVERSED orders are in no total; HOUSE gets 0 and is in no list of payables (D5).
- [ ] No route accepts an amount or an order list from the browser for a payout.
- [ ] A golden test in `packages/golden` covers the change (NFR-1).

## 5. State changes and transactions (AD-2, AD-7, AD-16, AD-17)

- Every write goes through the `platform/db` transaction helper (`BEGIN IMMEDIATE`).
- One command is one transaction, and it includes the history row, the audit entry and the outbox
  row. Nothing that must happen together is split across transactions.
- No network call, `await` on I/O, or timer inside a transaction.
- An order status changes only through `orders/domain/transition.ts`.
- `audit_entries`, `order_status_history` and `ledger_entries` are insert-only.
- Every command that moves money or personal data takes an `Actor`.

## 6. List contract (AD-12, FR-37)

- Every list is built with `defineList()` on the server and rendered with `DataList` from
  `packages/ui`. No screen writes its own filter, sort or pagination logic.
- One field per column: the column key is the sort key and the displayed value.
- Search uses the stored `search_text` column from `packages/text`; never `LIKE` on raw text or
  JSON, and never a client-side filter.
- Counts, facets and summaries come from the same filtered query as the rows, or are labelled as
  the overall total.
- List state lives in the URL through the route's search schema. Changing a filter resets to page 1.
- Every mutation invalidates every query that shows the changed records (LC-10).
- Each defect in `list-defects.md` has a regression test.

## 7. Time (AD-11, FR-38, D28)

- Only `packages/time` creates, parses or formats instants.
- Store instants as `YYYY-MM-DDTHH:mm:ss.sssZ` text in columns ending in `_at`.
- Business days, weeks and months are Asia/Ho_Chi_Minh. A date range includes its whole end day
  (half-open instant range to the next day's start).
- Staff-typed times are Vietnam time. Campaign window ends are exclusive.
- Domain code takes a `Clock`; tests use a fixed clock.

## 8. Statuses and shared definitions (AD-10)

- Statuses, their order, tone and label key come from `packages/domain`. A screen, message or
  export never defines its own status text or meaning of "payable", "has a bank account" or
  "settled".
- Adding a status means changing `docs/operations/status-flows.md` first; the registry test fails
  until both agree.

## 9. Security (AD-18, AD-19, SECURITY_MODEL.md)

- A route belongs to exactly one group: public, staff, or internal. Internal routes live only on the
  internal listener and require their token.
- Never authorize by source address; `trustProxy` stays off.
- Customer reads are scoped to the session's customer id in the application layer.
- Secrets come only from `platform/config`; no `process.env` elsewhere; no secret in a bundle, a log
  or an error body.
- Logs go through the shared pino logger with its redaction list. Bank numbers appear as the last
  four digits on screens and as a fingerprint in audit.
- No code calls Shopee directly or rebuilds its signature headers (D8).

## 10. Frontend (AD-21, UX spines)

- Server reads and writes only in `*.queries.ts` with TanStack Query; no `fetch` in components.
- Components come from `packages/ui` (shadcn/ui). Icons from one file.
- Money and dates are formatted by the shared formatters only; the UI never computes them.
- Every screen covers phone, tablet and desktop; customer screens work from 360 px and inside the
  Zalo in-app browser.

## 11. Required checks before merge

`pnpm typecheck`, `pnpm lint` (naming, size, boundaries), `pnpm depcruise`, `pnpm test` (including
golden and registry tests), and the secret scan. A failing golden test blocks the merge.
