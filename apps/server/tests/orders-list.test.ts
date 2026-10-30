/**
 * Story 4.13: GET /api/admin/orders on the list contract (FR-26, FR-37, FR-38, AD-12). Every
 * "Orders" line of list-defects.md has a regression test here (server side) or in
 * apps/admin/tests/orders-list.test.tsx (screen side: the year on dates, debounce and kept rows).
 */
import { readFileSync } from "node:fs";

import { adminOrdersResponseSchema, type AdminOrderRow } from "@cashback/contracts";
import { searchText, statusesOf } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { ORDERS_LIST } from "../src/modules/orders/index";
import type { Ledger } from "../src/platform/db/ledger";
import { close, type Servers } from "../src/platform/http/servers";
import { deskGet, deskPost, errorOf, staffCookie } from "./helpers/desk-http";
import { closeLedgers } from "./helpers/order-ledger";
import { CLOCK, codeOf, nameOf, payoutLedger } from "./helpers/payout-ledger";
import { buildLiveCopy, importOnce, rows } from "./helpers/live-fixture";
import { deskServers } from "./helpers/staff-desk";

/** Product names with diacritics live in a JSON fixture (no Vietnamese in .ts files). */
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/order-products.json", import.meta.url), "utf8")) as { products: string[]; foldedProduct: string };

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

interface Spec {
  readonly id: string;
  readonly customer?: string;
  readonly network?: "shopee" | "accesstrade";
  readonly status?: string;
  readonly at?: string;
  readonly approved?: number | null;
  readonly estimate?: number | null;
  readonly cashback?: number | null;
  readonly request?: string | null;
}

function addOrder(ledger: Ledger, o: Spec): void {
  const status = o.status ?? "APPROVED";
  ledger.sqlite
    .prepare("INSERT INTO orders (order_id, network, platform, customer_id, request_id, status, estimated_commission, approved_commission, cashback, recorded_at, approved_at, paid_at, origin) VALUES (?, ?, 'shopee', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REPORT')")
    .run(o.id, o.network ?? "shopee", o.customer ?? "P1", o.request ?? null, status, o.estimate ?? null, o.approved === undefined ? 10000 : o.approved, o.cashback === undefined ? 7000 : o.cashback, o.at ?? "2026-10-20T03:00:00.000Z", status === "AWAITING_APPROVAL" ? null : "2026-10-21T03:00:00.000Z", status === "PAID" ? "2026-10-25T03:00:00.000Z" : null);
}

async function list(ledger: Ledger, query: string) {
  servers ??= deskServers(ledger, CLOCK);
  const res = await deskGet(servers, `/api/admin/orders${query}`, staffCookie(ledger, "tuan", CLOCK), CLOCK);
  expect(res.statusCode, res.body).toBe(200);
  return adminOrdersResponseSchema.parse(res.json());
}

const ids = (rows: readonly AdminOrderRow[]): string[] => rows.map((r) => r.orderId);

describe("Story 4.13 acceptance criteria", () => {
  it("AC1: 'Today' and a range ending today return the orders of the whole Vietnam day (regressions 'end date excludes its day', 'Today returns nothing')", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "T0000", at: "2026-10-29T16:59:59.999Z" });
    addOrder(ledger, { id: "T0001", at: "2026-10-29T17:00:00.000Z" });
    addOrder(ledger, { id: "T0002", at: "2026-10-30T16:59:59.999Z" });
    addOrder(ledger, { id: "T0003", at: "2026-10-30T17:00:00.000Z" });
    addOrder(ledger, { id: "T0004", at: "2026-10-24T00:00:00.000Z" });
    expect(ids((await list(ledger, "?filter[recordedAt]=2026-10-30")).rows).sort()).toEqual(["T0001", "T0002"]);
    expect(ids((await list(ledger, "?filter[recordedAt]=2026-10-24..2026-10-30")).rows).sort()).toEqual(["T0000", "T0001", "T0002", "T0004"]);
  });

  it("AC2: a sort on commission or cashback orders by exactly the approved or stored value shown, never the estimate, missing values last (regressions dashboard.py:2026 and :2028)", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "S1", approved: 3000, estimate: 1000, cashback: 2100 });
    addOrder(ledger, { id: "S2", approved: 1000, estimate: 9000, cashback: 700 });
    addOrder(ledger, { id: "S3", status: "AWAITING_APPROVAL", approved: null, estimate: 50000, cashback: null });
    addOrder(ledger, { id: "S4", approved: 2000, estimate: 100, cashback: 1400 });
    const byCommission = await list(ledger, "?sort=approvedCommission:desc");
    expect(ids(byCommission.rows)).toEqual(["S1", "S4", "S2", "S3"]);
    expect(byCommission.rows.map((r) => r.approvedCommission)).toEqual([3000, 2000, 1000, null]);
    expect(ids((await list(ledger, "?sort=cashback:asc")).rows)).toEqual(["S2", "S4", "S1", "S3"]);
  });

  it("AC3: 'nguyen' finds Vietnamese names without diacritics, '%' is escaped, the order id is searchable and raw estimate or report JSON never is", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "251019ZT45LB", customer: "P1" });
    addOrder(ledger, { id: "251020M8RR0Q", customer: "P2" });
    ledger.sqlite.prepare("INSERT INTO order_observations (order_id, observed_at, fingerprint, observation, applied) VALUES ('251020M8RR0Q', '2026-10-20T03:00:00.000Z', 'f1', ?, 1)").run(JSON.stringify({ items: [{ name: "nguyen markerjson" }] }));
    expect(ids((await list(ledger, "?q=nguyen")).rows)).toEqual(["251019ZT45LB"]);
    expect((await list(ledger, "?q=nguyen")).rows[0]).toMatchObject({ customerCode: codeOf("P1"), customerName: nameOf("P1") });
    expect((await list(ledger, "?q=%25")).total).toBe(0);
    expect((await list(ledger, "?q=_")).total).toBe(0);
    expect((await list(ledger, "?q=markerjson")).total).toBe(0);
    expect(ids((await list(ledger, "?q=m8rr")).rows)).toEqual(["251020M8RR0Q"]);
    expect(ids((await list(ledger, `?q=${codeOf("P2")}`)).rows)).toEqual(["251020M8RR0Q"]);
  });

  it("AC4: status facets count the filtered set, the overall total comes separately, and there is exactly one network filter (regressions 'All (N)' and 'two all-platforms filters')", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "F1", status: "AWAITING_APPROVAL", approved: null, cashback: null });
    addOrder(ledger, { id: "F2", status: "APPROVED" });
    addOrder(ledger, { id: "F3", status: "PAID" });
    addOrder(ledger, { id: "F4", status: "APPROVED", network: "accesstrade" });
    const shopee = await list(ledger, "?filter[network]=shopee");
    expect(shopee.total).toBe(3);
    expect(shopee.overall).toBe(4);
    expect(shopee.facets["status"]?.filter((f) => f.count > 0)).toEqual([
      { value: "AWAITING_APPROVAL", count: 1 },
      { value: "APPROVED", count: 1 },
      { value: "PAID", count: 1 },
    ]);
    expect(shopee.facets["status"]?.map((f) => f.value)).toEqual(statusesOf("order").map((s) => s.value));
    expect(shopee.summary).toEqual({ approvedCommission: 20000, cashback: 14000 });
    const filterable = Object.entries(ORDERS_LIST.fields).filter(([, f]) => "filter" in f && f.filter === true).map(([key]) => key);
    expect(filterable).toEqual(["network", "status", "recordedAt", "approvedAt", "paidAt"]);
    const twice = await deskGet(servers as Servers, "/api/admin/orders?filter[platform]=shopee", staffCookie(ledger, "tuan", CLOCK), CLOCK);
    expect([twice.statusCode, errorOf(twice.body).code]).toEqual([400, "invalid_request"]);
  });

  it("AC5: dates are sent as stored instants, a past year included, and status sorts in lifecycle order, not alphabetically (regression :2033)", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "Y1", status: "REJECTED", approved: null, cashback: null, at: "2025-12-31T03:00:00.000Z" });
    addOrder(ledger, { id: "Y2", status: "PAID" });
    addOrder(ledger, { id: "Y3", status: "AWAITING_APPROVAL", approved: null, cashback: null });
    addOrder(ledger, { id: "Y4", status: "APPROVED" });
    const page = await list(ledger, "?sort=status:asc");
    expect(page.rows.map((r) => r.status)).toEqual(["AWAITING_APPROVAL", "APPROVED", "PAID", "REJECTED"]);
    expect(page.rows.find((r) => r.orderId === "Y1")?.recordedAt).toBe("2025-12-31T03:00:00.000Z");
  });

  it("AC6: no route marks an order paid or refunds it; the list is read only (regression OrdersView.tsx:716)", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "R1" });
    await list(ledger, "");
    const s = servers as Servers;
    const cookie = staffCookie(ledger, "minh", CLOCK);
    for (const url of ["/api/admin/orders", "/api/admin/orders/R1", "/api/admin/orders/R1/paid", "/api/admin/orders/R1/refund", "/api/admin/orders/R1/mark-paid"]) {
      const res = await deskPost(s, url, cookie, {}, CLOCK);
      expect(res.statusCode, url).toBe(404);
    }
    expect(ledger.sqlite.prepare("SELECT status, paid_at FROM orders").get()).toEqual({ status: "APPROVED", paid_at: null });
  });
});

describe("Story 4.13 review: search by product and Zalo id", () => {
  it("search finds an order by the product name of its snapshot, without diacritics, and by the customer's Zalo id", async () => {
    const ledger = payoutLedger();
    const product = FIXTURE.products[0] as string;
    ledger.sqlite.prepare("INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, origin, product_name, search_text) VALUES ('RQ1', 'P1', 'shopee', 'shopee', 'DELIVERED', 'https://shopee.vn/p/1', 'REQUEST', ?, ?)").run(product, searchText(product));
    ledger.sqlite.prepare("UPDATE customers SET zalo_user_id = '4711000099', search_text = ? WHERE customer_id = 'P2'").run(searchText(nameOf("P2"), codeOf("P2"), "4711000099"));
    addOrder(ledger, { id: "S1", request: "RQ1" });
    addOrder(ledger, { id: "S2", customer: "P2" });
    expect(ids((await list(ledger, `?q=${encodeURIComponent(FIXTURE.foldedProduct)}`)).rows)).toEqual(["S1"]);
    expect(ids((await list(ledger, "?q=47110000")).rows)).toEqual(["S2"]);
  });

  it("the cutover writes the folded product name of every link request and the Zalo id into the customer's search text", () => {
    const run = importOnce(buildLiveCopy());
    const links = rows(run.targetPath, "SELECT product_name, search_text FROM link_requests WHERE product_name IS NOT NULL") as { product_name: string; search_text: string }[];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.search_text).toBe(searchText(l.product_name));
    const customers = rows(run.targetPath, "SELECT zalo_user_id, display_name, customer_code, search_text FROM customers WHERE zalo_user_id IS NOT NULL") as { zalo_user_id: string; display_name: string | null; customer_code: string | null; search_text: string }[];
    expect(customers.length).toBeGreaterThan(0);
    for (const c of customers) expect(c.search_text).toBe(searchText(c.display_name, c.customer_code, c.zalo_user_id));
  });
});

describe("list-defects Orders regressions (server)", () => {
  it("the page is clamped after the result shrinks ('41 - 40 of 40')", async () => {
    const ledger = payoutLedger();
    for (let i = 0; i < 41; i++) addOrder(ledger, { id: `P${String(i).padStart(3, "0")}`, network: i === 0 ? "accesstrade" : "shopee" });
    const page = await list(ledger, "?filter[network]=shopee&pageSize=20&page=3");
    expect([page.page, page.total, page.rows.length]).toEqual([2, 40, 20]);
  });

  it("profit is never derived on the list: rows carry the stored amounts only, so no fee is applied to the wrong network (dashboard.py:349)", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "N1", network: "accesstrade", approved: 15000, cashback: 10800 });
    const [row] = (await list(ledger, "")).rows;
    expect(Object.keys(row ?? {}).sort()).toEqual(["approvedAt", "approvedCommission", "cashback", "customerCode", "customerName", "network", "orderId", "orderValue", "paidAt", "productImageUrl", "productName", "recordedAt", "settledBy", "status"]);
    expect(row).toMatchObject({ network: "accesstrade", approvedCommission: 15000, cashback: 10800 });
  });

  it("the product comes from the link's snapshot, and an image that is not https is never sent", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.prepare("INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, origin, product_name, product_image_url) VALUES ('RQ1', 'P1', 'shopee', 'shopee', 'DELIVERED', 'https://shopee.vn/p/1', 'REQUEST', 'Noi com', 'https://cf.example.test/a.jpg'), ('RQ2', 'P1', 'shopee', 'shopee', 'DELIVERED', 'https://shopee.vn/p/2', 'REQUEST', 'Tai nghe', 'http://cf.example.test/b.jpg')").run();
    addOrder(ledger, { id: "I1", request: "RQ1" });
    addOrder(ledger, { id: "I2", request: "RQ2" });
    const rows = (await list(ledger, "?sort=orderId:asc")).rows;
    expect(rows.map((r) => [r.productName, r.productImageUrl])).toEqual([
      ["Noi com", "https://cf.example.test/a.jpg"],
      ["Tai nghe", null],
    ]);
  });
});
