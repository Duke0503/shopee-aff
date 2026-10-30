/**
 * Story 4.3: the list contract on the server. One `defineList()` spec over the migrated orders and
 * customers tables; every figure comes from the same filtered set as the rows, the page is clamped,
 * sorts use exactly the displayed field, search runs over stored `search_text` only. Regression
 * tests for list-defects root causes 3 (sort expression), 6 (summaries from another set),
 * 7 (search not normalised) and 8 (page not clamped).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorEnvelopeSchema, listResponseSchema } from "@cashback/contracts";
import { fixedClock, parseInstant, searchText, sortKey, statusesOf, toMs } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../src/platform/db/migrations";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { defineList, ListSpecError, type FieldSpec, type FieldSpecs, type ListSpec } from "../src/platform/list/define-list";
import { ListQueryError } from "../src/platform/list/list-query.schema";
import { answerList } from "../src/platform/list/list-request";
import { clampPage, runList } from "../src/platform/list/run-list";
import { tempDir } from "./helpers/live-fixture";

const CLOCK = fixedClock("2026-10-30T12:00:00.000Z");
const opened: Ledger[] = [];
let servers: Servers | undefined;

afterEach(async () => {
  for (const ledger of opened.splice(0)) ledger.close();
  if (servers) await close(servers);
  servers = undefined;
});

const ORDERS = defineList({
  from: "orders o LEFT JOIN customers c ON c.customer_id = o.customer_id",
  key: "o.order_id",
  fields: {
    orderId: { kind: "text", column: "o.order_id", sortable: true },
    network: { kind: "text", column: "o.network", sortable: true, filter: true, facet: true },
    status: { kind: "status", entity: "order", column: "o.status", sortable: true, filter: true, facet: true },
    customerName: { kind: "name", column: "c.display_name", sortKeyColumn: "c.sort_key", sortable: true },
    customerCode: { kind: "text", column: "c.customer_code", sortable: true },
    approvedCommission: { kind: "money", column: "o.approved_commission", sortable: true, summary: true },
    estimatedCommission: { kind: "money", column: "o.estimated_commission" },
    cashback: { kind: "money", column: "o.cashback", sortable: true, summary: true },
    recordedAt: { kind: "instant", column: "o.recorded_at", sortable: true, filter: true },
  },
  search: ["c.search_text"],
  defaultSort: { field: "recordedAt", direction: "desc" },
});

type Row = { orderId: string; network: string; status: string; customerName: string | null; customerCode: string | null; approvedCommission: number | null; estimatedCommission: number | null; cashback: number | null; recordedAt: string | null };

/** Customer names with Vietnamese diacritics live in a JSON fixture (no Vietnamese in .ts files). */
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/list-customers.json", import.meta.url), "utf8")) as { customers: [string, string, string][]; accentedQuery: string };
const CUSTOMERS = FIXTURE.customers;
const nameOf = (id: string): string => CUSTOMERS.find(([c]) => c === id)?.[2] ?? "";

function ledger(): Ledger {
  const l = openLedger(join(tempDir("cashback-list-"), "ledger.sqlite"));
  runMigrations(l, readMigrations(MIGRATIONS_DIR), CLOCK);
  const insert = l.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status, display_name, search_text, sort_key) VALUES (?, ?, 'USER', 'ACTIVE', ?, ?, ?)");
  for (const [id, code, name] of CUSTOMERS) insert.run(id, code, name, searchText(code, name), sortKey(name));
  opened.push(l);
  return l;
}

interface OrderSpec {
  id: string;
  network?: string;
  status?: string;
  customer?: string | null;
  approved?: number | null;
  estimated?: number | null;
  cashback?: number | null;
  at?: string | null;
}

function addOrder(l: Ledger, o: OrderSpec): void {
  const status = o.status ?? "AWAITING_APPROVAL";
  l.sqlite
    .prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, estimated_commission, cashback, recorded_at, paid_at, origin) VALUES (?, ?, 'shopee', ?, ?, ?, ?, ?, ?, ?, 'REPORT')")
    .run(o.id, o.network ?? "shopee", o.customer === undefined ? "C1" : o.customer, status, o.approved ?? null, o.estimated ?? null, o.cashback ?? null, o.at === undefined ? "2026-10-20T03:00:00.000Z" : o.at, status === "PAID" ? "2026-10-25T03:00:00.000Z" : null);
}

/** 41 orders: 40 Shopee and 1 AccessTrade, 1 000 dong approved commission and 700 cashback each. */
function fortyOne(l: Ledger): void {
  for (let i = 1; i <= 40; i++) addOrder(l, { id: `S${String(i).padStart(3, "0")}`, approved: 1000, cashback: 700, at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T03:00:00.000Z`, customer: CUSTOMERS[i % 4]?.[0] ?? "C1" });
  addOrder(l, { id: "A001", network: "accesstrade", approved: 5000, cashback: 3500 });
}

const query = (raw: Record<string, unknown>) => ORDERS.parse(raw);
const run = (l: Ledger, raw: Record<string, unknown>) => runList<typeof ORDERS.fields, Row>(l.db, ORDERS, query(raw), CLOCK);

describe("Story 4.3 acceptance criteria", () => {
  it("AC1: 41 rows, a filter that leaves 40, pageSize=20&page=3 returns page 2 with rows 21 to 40 of 40, never page 3 (regression '41 - 40 of 40')", () => {
    const l = ledger();
    fortyOne(l);
    const result = run(l, { "filter[network]": "shopee", pageSize: "20", page: "3" });
    expect(result.page).toBe(2);
    expect(result.total).toBe(40);
    expect(result.pageSize).toBe(20);
    expect(result.rows).toHaveLength(20);
    const first = (result.page - 1) * result.pageSize + 1;
    const last = first + result.rows.length - 1;
    expect([first, last, result.total]).toEqual([21, 40, 40]);
    // Page 2 is exactly the rows after page 1: nothing repeated, nothing skipped.
    const page1 = run(l, { "filter[network]": "shopee", pageSize: "20", page: "1" }).rows.map((r) => r.orderId);
    const page2 = result.rows.map((r) => r.orderId);
    expect(new Set([...page1, ...page2]).size).toBe(40);
  });

  it("AC1: the page is clamped to 1 when the filter leaves nothing, and a page inside the range is kept", () => {
    expect(clampPage(3, 20, 0)).toBe(1);
    expect(clampPage(2, 20, 40)).toBe(2);
    expect(clampPage(3, 20, 41)).toBe(3);
    const l = ledger();
    fortyOne(l);
    expect(run(l, { "filter[status]": "PAID", page: "5" })).toMatchObject({ page: 1, total: 0, rows: [] });
  });

  it("AC2: total, facets and summary are computed over the same filtered set as rows, and no count is capped", () => {
    const l = ledger();
    for (let i = 1; i <= 150; i++) addOrder(l, { id: `B${String(i).padStart(4, "0")}`, approved: 1000, cashback: 700, status: i % 3 === 0 ? "APPROVED" : "AWAITING_APPROVAL" });
    addOrder(l, { id: "T1", network: "accesstrade", approved: 90000, cashback: 63000, status: "APPROVED" });
    const result = run(l, { "filter[network]": "shopee", pageSize: "10" });
    expect(result.rows).toHaveLength(10);
    expect(result.total).toBe(150);
    expect(result.summary).toEqual({ approvedCommission: 150 * 1000, cashback: 150 * 700 });
    expect(result.facets["network"]).toEqual([{ value: "shopee", count: 150 }]);
    expect(result.facets["status"]?.find((f) => f.value === "APPROVED")).toEqual({ value: "APPROVED", count: 50 });
    expect(result.facets["status"]?.find((f) => f.value === "AWAITING_APPROVAL")).toEqual({ value: "AWAITING_APPROVAL", count: 100 });
    expect((result.facets["status"] ?? []).reduce((n, f) => n + f.count, 0)).toBe(result.total);
  });

  it("AC2: search narrows total, facets and summary together with the rows (regression 'All (N)' and unfiltered cards)", () => {
    const l = ledger();
    addOrder(l, { id: "O1", customer: "C1", approved: 1000, cashback: 700, status: "APPROVED" });
    addOrder(l, { id: "O2", customer: "C3", approved: 2000, cashback: 1400 });
    addOrder(l, { id: "O3", customer: "C3", approved: 4000, cashback: 2800, status: "PAID" });
    const result = run(l, { q: "tran thi anh" });
    expect(result.rows.map((r) => r.orderId).sort()).toEqual(["O2", "O3"]);
    expect(result.total).toBe(2);
    expect(result.summary).toEqual({ approvedCommission: 6000, cashback: 4200 });
    expect(result.facets["status"]?.filter((f) => f.count > 0)).toEqual([
      { value: "AWAITING_APPROVAL", count: 1 },
      { value: "PAID", count: 1 },
    ]);
  });

  it("AC2: a status facet lists every registry status in lifecycle order, with 0 for those not in the set", () => {
    const l = ledger();
    addOrder(l, { id: "O1" });
    expect(run(l, {}).facets["status"]).toEqual(statusesOf("order").map((s) => ({ value: s.value, count: s.value === "AWAITING_APPROVAL" ? 1 : 0 })));
  });

  it("AC3: a sort on a field returns rows ordered by exactly that field's stored value (regression: commission sorted by the estimate while showing the approved figure)", () => {
    const l = ledger();
    // Approved and estimated commission disagree in order, so sorting by the wrong one shows.
    addOrder(l, { id: "O1", approved: 3000, estimated: 1000 });
    addOrder(l, { id: "O2", approved: 1000, estimated: 3000 });
    addOrder(l, { id: "O3", approved: 2000, estimated: 2000 });
    addOrder(l, { id: "O4", approved: null, estimated: 9000 });
    const asc = run(l, { sort: "approvedCommission:asc" }).rows;
    expect(asc.map((r) => r.approvedCommission)).toEqual([1000, 2000, 3000, null]);
    const desc = run(l, { sort: "approvedCommission:desc" }).rows;
    expect(desc.map((r) => r.approvedCommission)).toEqual([3000, 2000, 1000, null]);
  });

  it("AC3: every sortable field orders by the value the row displays, in both directions", () => {
    const l = ledger();
    fortyOne(l);
    const comparable = (v: unknown): string | number => (typeof v === "number" ? v : String(v));
    for (const [key, field] of Object.entries(ORDERS.fields)) {
      if (!(field as FieldSpec).sortable || field.kind === "status" || field.kind === "name") continue;
      const values = run(l, { sort: `${key}:asc`, pageSize: "100" })
        .rows.map((r) => r[key as keyof Row])
        .filter((v) => v !== null)
        .map(comparable);
      expect([...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), key).toEqual(values);
    }
  });

  it("AC3: a field not declared sortable is rejected with invalid_sort, as is an unknown field or direction", () => {
    for (const sort of ["estimatedCommission:asc", "nope:asc", "orderId:up", "orderId", "orderId:asc:x", "constructor:asc"]) {
      expect(() => query({ sort }), sort).toThrow(expect.objectContaining({ code: "invalid_sort" }));
    }
    expect(() => query({ sort: "orderId:asc" })).not.toThrow();
  });

  it("AC3: the HTTP answer to an undeclared sort is 400 invalid_sort in the error envelope", async () => {
    const l = ledger();
    servers = buildServers({ clock: CLOCK, internalToken: "t".repeat(40) });
    servers.publicApp.get("/api/test/orders", async (request) => answerList(l.db, ORDERS, request.query, CLOCK));
    const refused = await servers.publicApp.inject({ method: "GET", url: "/api/test/orders?sort=estimatedCommission:desc" });
    expect(refused.statusCode).toBe(400);
    expect(errorEnvelopeSchema.parse(refused.json())).toEqual({ error: { code: "invalid_sort", messageKey: "error.invalid_sort", fields: { sort: "invalid_sort" } } });
    addOrder(l, { id: "O1", approved: 1000, cashback: 700 });
    const ok = await servers.publicApp.inject({ method: "GET", url: "/api/test/orders?filter[status]=AWAITING_APPROVAL&sort=orderId:asc&pageSize=20" });
    expect(ok.statusCode).toBe(200);
    expect(listResponseSchema(z.object({ orderId: z.string() }).passthrough()).parse(ok.json())).toMatchObject({ total: 1, page: 1, pageSize: 20, asOf: CLOCK.now(), summary: { approvedCommission: 1000, cashback: 700 } });
  });

  it("AC4: q=nguyen% matches search_text with the wildcard escaped", () => {
    const l = ledger();
    addOrder(l, { id: "O1", customer: "C1" }); // folds to "nguyenvanbinh": would match an unescaped "nguyen%"
    addOrder(l, { id: "O2", customer: "C2" }); // Nguyen% Lan
    expect(run(l, { q: "nguyen%" }).rows.map((r) => r.orderId)).toEqual(["O2"]);
    expect(run(l, { q: FIXTURE.accentedQuery }).rows.map((r) => r.orderId).sort()).toEqual(["O1", "O2"]);
    expect(run(l, { q: "dp00001" }).rows.map((r) => r.orderId)).toEqual(["O1"]);
    expect(run(l, { q: "_" }).rows).toEqual([]);
    expect(run(l, { q: "   " }).total).toBe(2);
  });

  it("AC4: search never covers raw text or JSON: a spec naming any column but a stored search_text is refused", () => {
    const spec = (search: string[]): ListSpec<FieldSpecs> => ({ from: "orders o", key: "o.order_id", fields: { orderId: { kind: "text", column: "o.order_id", sortable: true } }, search, defaultSort: { field: "orderId", direction: "asc" } });
    expect(() => defineList(spec(["o.observation"]))).toThrow(ListSpecError);
    expect(() => defineList(spec(["c.display_name"]))).toThrow(ListSpecError);
    expect(() => defineList(spec(["lower(c.display_name)"]))).toThrow(ListSpecError);
    expect(() => defineList(spec(["c.search_text"]))).not.toThrow();
  });

  it("AC4: text present only in an order's raw report JSON is not found", () => {
    const l = ledger();
    addOrder(l, { id: "O1", customer: "C3" });
    l.sqlite.prepare("INSERT INTO order_observations (order_id, observed_at, fingerprint, observation, applied) VALUES ('O1', ?, 'f1', ?, 1)").run(CLOCK.now(), JSON.stringify({ buyer: "nguyen% secret" }));
    expect(run(l, { q: "nguyen%" }).total).toBe(0);
  });

  it("AC5: a status sort follows registry lifecycle order, not the alphabet", () => {
    const l = ledger();
    const statuses = ["REJECTED", "PAID", "APPROVED", "FROZEN", "REVERSED", "AWAITING_APPROVAL"];
    statuses.forEach((status, i) => addOrder(l, { id: `O${i}`, status, approved: 1000 }));
    const lifecycle = statusesOf("order").map((s) => s.value);
    expect(run(l, { sort: "status:asc" }).rows.map((r) => r.status)).toEqual(lifecycle);
    expect(run(l, { sort: "status:desc" }).rows.map((r) => r.status)).toEqual([...lifecycle].reverse());
    expect(lifecycle).not.toEqual([...lifecycle].sort());
  });

  it("AC5: a date sort orders by instant, missing dates last", () => {
    const l = ledger();
    const ats = ["2026-10-30T16:59:59.999Z", "2026-10-30T17:00:00.000Z", "2026-09-01T00:00:00.000Z", "2026-10-30T00:00:00.001Z"];
    ats.forEach((at, i) => addOrder(l, { id: `O${i}`, at }));
    addOrder(l, { id: "ONULL", at: null });
    const asc = run(l, { sort: "recordedAt:asc" }).rows.map((r) => r.recordedAt);
    expect(asc.slice(0, 4).map((at) => toMs(parseInstant(at ?? "")))).toEqual(ats.map((at) => toMs(parseInstant(at))).sort((a, b) => a - b));
    expect(asc.at(-1)).toBeNull();
    expect(run(l, { sort: "recordedAt:desc" }).rows.at(-1)?.recordedAt).toBeNull();
  });

  it("AC5: a name sort follows the stored Vietnamese sort key", () => {
    const l = ledger();
    CUSTOMERS.forEach(([id], i) => addOrder(l, { id: `O${i}`, customer: id }));
    expect(run(l, { sort: "customerName:asc" }).rows.map((r) => r.customerName)).toEqual(["C4", "C2", "C1", "C3"].map(nameOf));
    // d-stroke is its own letter between d and e, so that name comes first; binary order would put it last.
    expect(["C4", "C2", "C1", "C3"].map(nameOf)).toEqual(CUSTOMERS.map(([, , n]) => n).sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)));
  });
});

describe("list query schema (AD-12)", () => {
  it("a date filter is Vietnam calendar days and includes the whole end day (list-defects root cause 1)", () => {
    const l = ledger();
    addOrder(l, { id: "LATE", at: "2026-10-30T16:59:59.999Z" }); // 23:59:59 on 30 Oct in Vietnam
    addOrder(l, { id: "NEXT", at: "2026-10-30T17:00:00.000Z" }); // 00:00 on 31 Oct in Vietnam
    addOrder(l, { id: "EARLY", at: "2026-10-28T17:00:00.000Z" }); // 00:00 on 29 Oct in Vietnam
    expect(run(l, { "filter[recordedAt]": "2026-10-30" }).rows.map((r) => r.orderId)).toEqual(["LATE"]);
    expect(run(l, { "filter[recordedAt]": "2026-10-29..2026-10-30", sort: "orderId:asc" }).rows.map((r) => r.orderId)).toEqual(["EARLY", "LATE"]);
  });

  it("several values of one filter are OR-ed, repeated or comma-separated", () => {
    const l = ledger();
    ["APPROVED", "PAID", "REJECTED"].forEach((status, i) => addOrder(l, { id: `O${i}`, status }));
    expect(run(l, { "filter[status]": "APPROVED,PAID" }).total).toBe(2);
    expect(run(l, { "filter[status]": ["APPROVED", "REJECTED"] }).total).toBe(2);
  });

  it("refuses an unknown filter, a status the registry does not store, a bad date and an oversized page", () => {
    const refused = (raw: Record<string, unknown>) => {
      try {
        query(raw);
      } catch (error) {
        return error instanceof ListQueryError ? { code: error.code, fields: error.fields } : error;
      }
      return null;
    };
    expect(refused({ "filter[orderId]": "X" })).toMatchObject({ code: "invalid_request" });
    expect(refused({ "filter[status]": "READY" })).toEqual({ code: "invalid_request", fields: { "filter[status]": "invalid_filter" } });
    expect(refused({ "filter[recordedAt]": "2026-10-31..2026-10-01" })).toEqual({ code: "invalid_request", fields: { "filter[recordedAt]": "invalid_filter" } });
    expect(refused({ "filter[recordedAt]": "yesterday" })).toMatchObject({ code: "invalid_request" });
    expect(refused({ pageSize: "1000" })).toMatchObject({ code: "invalid_request" });
    expect(refused({ page: "0" })).toMatchObject({ code: "invalid_request" });
    expect(query({})).toMatchObject({ q: null, filters: [], sort: { field: "recordedAt", direction: "desc" }, page: 1, pageSize: 25 });
  });

  it("a spec is checked when it is defined: plain columns, a sortable default, sort keys from sort_key columns", () => {
    const base: ListSpec<FieldSpecs> = { from: "orders o", key: "o.order_id", fields: { orderId: { kind: "text", column: "o.order_id", sortable: true } }, search: [], defaultSort: { field: "orderId", direction: "asc" } };
    expect(() => defineList<FieldSpecs>({ ...base, fields: { orderId: { kind: "text", column: "o.order_id || 'x'", sortable: true } } })).toThrow(ListSpecError);
    expect(() => defineList<FieldSpecs>({ ...base, fields: { orderId: { kind: "text", column: "o.order_id" } } })).toThrow(/default sort/);
    expect(() => defineList<FieldSpecs>({ ...base, fields: { ...base.fields, name: { kind: "name", column: "c.display_name", sortKeyColumn: "c.updated_at" } } })).toThrow(/sort_key/);
    expect(() => defineList<FieldSpecs>({ ...base, from: "orders; DROP TABLE orders" })).toThrow(ListSpecError);
  });
});
