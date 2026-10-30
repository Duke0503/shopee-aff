/**
 * Story 4.14: the Customers list and one customer's page on the admin desk (FR-26, FR-15, FR-37,
 * AD-6, AD-12). Every "Customers (admin)" and "Customer detail dialog" line of list-defects.md has
 * a regression test here (server side) or in apps/admin/tests/customers.test.tsx (screen side:
 * the previous customer's amount, refresh after a transfer).
 */
import {
  adminCustomersResponseSchema,
  adminLinkRequestsResponseSchema,
  adminOrdersResponseSchema,
  customerPageSchema,
  payoutHistoryResponseSchema,
  payoutListResponseSchema,
  type AdminCustomerRow,
} from "@cashback/contracts";
import { searchText } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { CUSTOMERS_LIST, getBalances } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { close, type Servers } from "../src/platform/http/servers";
import { deskGet, deskPost, errorOf, staffCookie } from "./helpers/desk-http";
import { closeLedgers } from "./helpers/order-ledger";
import {
  addBank,
  addBonus,
  addClawback,
  addOrder,
  CLOCK,
  codeOf,
  FIXTURE,
  nameOf,
  payoutLedger,
} from "./helpers/payout-ledger";
import { deskServers } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

async function get(ledger: Ledger, url: string) {
  servers ??= deskServers(ledger, CLOCK);
  return deskGet(servers, url, staffCookie(ledger, "tuan", CLOCK), CLOCK);
}

async function ok(ledger: Ledger, url: string): Promise<unknown> {
  const res = await get(ledger, url);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const customers = async (ledger: Ledger, query = "") =>
  adminCustomersResponseSchema.parse(await ok(ledger, `/api/admin/customers?pageSize=100${query}`));
const page = async (ledger: Ledger, key: string) =>
  customerPageSchema.parse(await ok(ledger, `/api/admin/customers/${key}`));
/** The fixture's customers plus the ledger's own C1, C2 and the erased CE; HOUSE is never listed. */
const LISTED = FIXTURE.customers.length + 3;

const row = (rows: readonly AdminCustomerRow[], id: string) =>
  rows.find((r) => r.customerId === id);

/** Zalo ids in the reverse order of the customer codes, so a sort by one is not a sort by the other. */
function withZaloIds(ledger: Ledger): void {
  const set = ledger.sqlite.prepare(
    "UPDATE customers SET zalo_user_id = ?, search_text = ? WHERE customer_id = ?",
  );
  FIXTURE.customers.forEach(([id, code, name], i) => {
    const zalo = `88124471${String(900 - i).padStart(4, "0")}`;
    set.run(zalo, searchText(name, code, zalo), id);
  });
}

function addLinkRequest(
  ledger: Ledger,
  requestId: string,
  customer: string,
  at = "2026-10-20T03:00:00.000Z",
): void {
  ledger.sqlite
    .prepare(
      "INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, product_name, product_image_url, created_at, origin, search_text) VALUES (?, ?, 'shopee', 'shopee', 'DELIVERED', 'https://shopee.vn/p', 'Product', 'https://cf.example.test/p.jpg', ?, 'REQUEST', 'product')",
    )
    .run(requestId, customer, at);
}

function addPayout(ledger: Ledger, customer: string, amount: number): void {
  ledger.sqlite
    .prepare(
      "INSERT INTO payouts (customer_id, status, transfer_amount, receipt_token, recorded_by, recorded_at, origin) VALUES (?, 'RECORDED', ?, ?, 'minh', '2026-10-25T03:00:00.000Z', 'CUTOVER')",
    )
    .run(customer, amount, `rcpt_cust_${customer}_${amount}`);
}

describe("Story 4.14 acceptance criteria", () => {
  it("AC1: a search by Zalo id, by code or by a name typed without diacritics finds the customer (regression 'search does not cover the Zalo id')", async () => {
    const ledger = payoutLedger();
    withZaloIds(ledger);
    const zalo = (
      ledger.sqlite
        .prepare("SELECT zalo_user_id AS z FROM customers WHERE customer_id = 'P3'")
        .get() as { z: string }
    ).z;
    expect((await customers(ledger, `&q=${zalo}`)).rows.map((r) => r.customerId)).toEqual(["P3"]);
    expect(
      (await customers(ledger, `&q=${codeOf("P2").toLowerCase()}`)).rows.map((r) => r.customerId),
    ).toEqual(["P2"]);
    expect(
      (await customers(ledger, `&q=${encodeURIComponent(FIXTURE.foldedQuery)}`)).rows.map(
        (r) => r.customerName,
      ),
    ).toEqual([nameOf("P1")]);
    expect(CUSTOMERS_LIST.search).toEqual(["c.search_text"]);
  });

  it("AC2: the list row, the customer page and the Payouts row show the identical payable (regressions 'list and detail dialog use different formulas', 'ready counts unsettled orders')", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216, settled: true });
    addOrder(ledger, { id: "261001A0002", customer: "P1", cashback: 36000, settled: false });
    addOrder(ledger, {
      id: "261001W0001",
      customer: "P1",
      status: "AWAITING_APPROVAL",
      estimate: 45000,
    });
    addOrder(ledger, { id: "261001F0001", customer: "P1", status: "FROZEN", cashback: 5000 });
    addBonus(ledger, "P1", "261001A0001", 20000);
    addClawback(ledger, "P1", "260901PAID01", 4860);
    addBank(ledger, "P1");
    const expected = getBalances(ledger.db, ["P1"])[0];
    expect(expected?.payable).toBe(79216 + 36000 + 20000 - 4860);
    const listed = row((await customers(ledger)).rows, "P1");
    const shown = await page(ledger, codeOf("P1"));
    const payouts = payoutListResponseSchema.parse(
      await ok(ledger, "/api/admin/payouts?pageSize=100"),
    );
    expect(listed?.payable).toBe(expected?.payable);
    expect(shown.balance.payable).toBe(expected?.payable);
    expect(payouts.rows.find((r) => r.customerId === "P1")?.payable).toBe(expected?.payable);
    expect(shown.balance).toMatchObject({
      gross: expected?.gross,
      waiting: expected?.waiting,
      paid: expected?.paid,
      deductedNext: 4860,
    });
    expect(shown.clawbacks).toEqual([
      { clawbackId: "260901PAID01-1", orderId: "260901PAID01", open: 4860 },
    ]);
  });

  it("AC3: the code column sorts by the customer code, not the Zalo id, and 'has bank' uses the shared payout flag rules", async () => {
    const ledger = payoutLedger();
    withZaloIds(ledger);
    addBank(ledger, "P1");
    addBank(ledger, "P2", { held: true });
    addOrder(ledger, { id: "261001A0003", customer: "P3", cashback: 9263 });
    const byCode = await customers(ledger, "&sort=customerCode:asc");
    expect(byCode.rows.map((r) => r.customerCode)).toEqual([
      ...["DP00001", "DP00002", ...FIXTURE.customers.map(([, code]) => code)].sort(),
      null,
    ]);
    const all = await customers(ledger);
    expect(row(all.rows, "P1")).toMatchObject({ bank: "SAVED", flagged: "NO", flags: "" });
    expect(row(all.rows, "P2")).toMatchObject({ bank: "HELD", flagged: "YES", flags: "BANK_HELD" });
    expect(row(all.rows, "P3")).toMatchObject({
      bank: "NONE",
      flagged: "YES",
      flags: "NO_BANK",
      owed: "YES",
    });
    // No money waits for P4: no bank account is a fact for the filter, not a warning.
    expect(row(all.rows, "P4")).toMatchObject({ bank: "NONE", flagged: "NO", flags: "" });
    expect((await customers(ledger, "&filter[bank]=NONE")).total).toBe(LISTED - 2);
    expect(all.facets["bank"]).toEqual([
      { value: "HELD", count: 1 },
      { value: "NONE", count: LISTED - 2 },
      { value: "SAVED", count: 1 },
    ]);
  });

  it("AC4: two customers' pages and lists never mix: each scoped list holds only its own customer's records", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    addOrder(ledger, { id: "261001B0001", customer: "P2", cashback: 24860 });
    addLinkRequest(ledger, "R1", "P1");
    addPayout(ledger, "P2", 50000);
    const a = await page(ledger, codeOf("P1"));
    const b = await page(ledger, codeOf("P2"));
    expect([a.balance.payable, b.balance.payable]).toEqual([79216, 24860]);
    const ordersOf = async (key: string) =>
      adminOrdersResponseSchema
        .parse(await ok(ledger, `/api/admin/customers/${key}/orders`))
        .rows.map((r) => r.orderId);
    expect(await ordersOf("P1")).toEqual(["261001A0001"]);
    expect(await ordersOf("P2")).toEqual(["261001B0001"]);
    expect(
      adminLinkRequestsResponseSchema.parse(
        await ok(ledger, "/api/admin/customers/P2/link-requests"),
      ).total,
    ).toBe(0);
    expect(
      payoutHistoryResponseSchema.parse(await ok(ledger, "/api/admin/customers/P1/payouts")).total,
    ).toBe(0);
    expect(
      payoutHistoryResponseSchema
        .parse(await ok(ledger, "/api/admin/customers/P2/payouts"))
        .rows.map((r) => r.amount),
    ).toEqual([50000]);
    const widened = await get(ledger, "/api/admin/customers/P1/orders?filter[customerId]=P2");
    expect([widened.statusCode, errorOf(widened.body).code]).toEqual([400, "invalid_request"]);
  });

  it("AC5: a bank change within 72 hours is flagged with its change time, and the account shows only its last four digits", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    addBank(ledger, "P1", { number: "0071000123456781234", changedAt: "2026-10-29T05:10:00.000Z" });
    const res = await get(ledger, `/api/admin/customers/${codeOf("P1")}`);
    expect(res.body).not.toContain("0071000123456781234");
    const shown = customerPageSchema.parse(res.json());
    expect(shown.bank).toMatchObject({
      lastFour: "1234",
      changedAt: "2026-10-29T05:10:00.000Z",
      changedRecently: true,
      held: false,
    });
    expect(shown.flags).toEqual(["BANK_CHANGED"]);
    const listed = await get(ledger, "/api/admin/customers?pageSize=100");
    expect(listed.body).not.toContain("0071000123456781234");
    expect(row(adminCustomersResponseSchema.parse(listed.json()).rows, "P1")).toMatchObject({
      accountLastFour: "1234",
      bankChangedAt: "2026-10-29T05:10:00.000Z",
      flags: "BANK_CHANGED",
    });
    addBank(ledger, "P2", { changedAt: "2026-10-27T11:59:59.999Z" });
    expect((await page(ledger, "P2")).bank?.changedRecently).toBe(false);
  });
});

describe("Story 4.14 list-defects regressions", () => {
  it("'link counts capped at 100 read as totals', 'a badge capped at 3 reads as a total': every tab count is the exact total", async () => {
    const ledger = payoutLedger();
    for (let i = 0; i < 120; i++) addLinkRequest(ledger, `R${String(i).padStart(4, "0")}`, "P1");
    for (let i = 0; i < 4; i++) addPayout(ledger, "P1", 1000 + i);
    const shown = await page(ledger, "P1");
    expect(shown.counts).toEqual({ orders: 0, linkRequests: 120, payouts: 4 });
    expect(
      adminLinkRequestsResponseSchema.parse(
        await ok(ledger, "/api/admin/customers/P1/link-requests"),
      ).total,
    ).toBe(120);
  });

  it("'recording a transfer with no order ids pays every approved order': the customer page has no write route at all", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    servers ??= deskServers(ledger, CLOCK);
    const cookie = staffCookie(ledger, "minh", CLOCK);
    for (const url of [
      "/api/admin/customers/P1",
      "/api/admin/customers/P1/payouts",
      "/api/admin/customers/P1/orders",
    ]) {
      expect((await deskPost(servers, url, cookie, { amount: 79216 }, CLOCK)).statusCode).toBe(404);
    }
    expect(
      ledger.sqlite.prepare("SELECT status FROM orders WHERE order_id = '261001A0001'").get(),
    ).toEqual({ status: "APPROVED" });
  });

  it("a merged customer's records are on the survivor's page, the guest account has no page, and an unknown key is not found", async () => {
    const ledger = payoutLedger();
    ledger.sqlite
      .prepare(
        "INSERT INTO customers (customer_id, customer_code, role, status, display_name, search_text, sort_key) VALUES ('OLD1', NULL, 'USER', 'MERGED', NULL, '', '')",
      )
      .run();
    ledger.sqlite
      .prepare("INSERT INTO customer_aliases (alias, customer_id) VALUES ('OLD1', 'P1')")
      .run();
    addOrder(ledger, { id: "261001M0001", customer: "OLD1", cashback: 12000 });
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 1000 });
    const shown = await page(ledger, "OLD1");
    expect([shown.customerId, shown.balance.payable, shown.counts.orders]).toEqual([
      "P1",
      13000,
      2,
    ]);
    const listed = await customers(ledger);
    expect(row(listed.rows, "P1")).toMatchObject({ payable: 13000, orderCount: 2 });
    expect(listed.rows.map((r) => r.customerId)).not.toContain("OLD1");
    expect(listed.rows.map((r) => r.customerId)).not.toContain("HOUSE");
    for (const key of ["HOUSE", "NOBODY1"]) {
      const res = await get(ledger, `/api/admin/customers/${key}`);
      expect([res.statusCode, errorOf(res.body).messageKey]).toEqual([
        404,
        "error.customer.not_found",
      ]);
    }
  });

  it("the chips count the filtered set, the overall total comes apart, and the summary sums the same rows", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    addOrder(ledger, { id: "261001A0002", customer: "P2", cashback: 24860 });
    addBank(ledger, "P1");
    addPayout(ledger, "P1", 50000);
    const owed = await customers(ledger, "&filter[owed]=YES");
    expect(owed.total).toBe(2);
    expect(owed.overall).toBe(LISTED);
    expect(owed.summary).toEqual({ payable: 79216 + 24860, paid: 50000 });
    expect(owed.facets["flagged"]).toEqual([
      { value: "NO", count: 1 },
      { value: "YES", count: 1 },
    ]);
  });
});

describe("Story 4.14 review fixes", () => {
  it("a customer's Orders tab counts its overall total inside that customer, never the whole platform", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 1000 });
    addOrder(ledger, {
      id: "261001A0002",
      customer: "P1",
      status: "AWAITING_APPROVAL",
      estimate: 5000,
    });
    for (let i = 0; i < 3; i++)
      addOrder(ledger, { id: `261001B000${i}`, customer: "P2", cashback: 2000 });
    const tab = adminOrdersResponseSchema.parse(
      await ok(ledger, "/api/admin/customers/P1/orders?filter[status]=APPROVED"),
    );
    expect([tab.total, tab.overall]).toEqual([1, 2]);
    const all = adminOrdersResponseSchema.parse(
      await ok(ledger, "/api/admin/orders?filter[status]=APPROVED"),
    );
    expect(all.overall).toBe(5);
  });

  it("staff accounts are not customers: they are not listed and have no customer page", async () => {
    const ledger = payoutLedger();
    for (const [id, code, role] of [
      ["S1", "DP00901", "EMPLOYEE"],
      ["S2", "DP00902", "ADMIN"],
    ] as const) {
      ledger.sqlite
        .prepare(
          "INSERT INTO customers (customer_id, customer_code, role, status, display_name, search_text, sort_key) VALUES (?, ?, ?, 'ACTIVE', 'Staff', 'staff', 'staff')",
        )
        .run(id, code, role);
    }
    const ids = (await customers(ledger)).rows.map((r) => r.customerId);
    expect(ids).not.toContain("S1");
    expect(ids).not.toContain("S2");
    for (const key of ["S1", "DP00902"])
      expect((await get(ledger, `/api/admin/customers/${key}`)).statusCode).toBe(404);
  });

  it("an erased customer opens by its id, code, alias or Zalo id, and its row counts the same orders as its page", async () => {
    const ledger = payoutLedger();
    ledger.sqlite
      .prepare(
        "INSERT INTO customers (customer_id, customer_code, role, status, zalo_user_id, display_name, search_text, sort_key) VALUES ('E1', 'DP00500', 'USER', 'ERASED', '99887766', NULL, '', '')",
      )
      .run();
    ledger.sqlite
      .prepare("INSERT INTO customer_aliases (alias, customer_id) VALUES ('OLDE1', 'E1')")
      .run();
    for (let i = 0; i < 7; i++)
      addOrder(ledger, { id: `261001E000${i}`, customer: "E1", status: "PAID", cashback: 1000 });
    for (const key of ["E1", "DP00500", "OLDE1", "99887766"]) {
      const shown = await page(ledger, key);
      expect([key, shown.customerId, shown.status, shown.counts.orders]).toEqual([
        key,
        "E1",
        "ERASED",
        7,
      ]);
    }
    expect(row((await customers(ledger)).rows, "E1")?.orderCount).toBe(7);
  });
});
