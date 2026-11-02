/**
 * Story 7.4 (server side, pen.dev opJFP, Gc1Zb and ktmGZ): one of the signed-in customer's orders
 * in full, the report of a purchase that did not show, and the greeting on My money. The order's
 * money is packages/money's split of the stored approved commission (the estimate while the network
 * decides) and its cashback is always the stored one; only the session's customer and the records
 * merged into them are reachable. A report opens one review case per order id for staff, with the
 * customer as its candidate, never more than five a day per customer, and changes no order.
 */
import { MY_MISSING_ORDERS_PATH, MY_MONEY_PATH, myMoneySchema, myOrderDetailSchema, myOrderPath, type MissingOrderRequest } from "@cashback/contracts";
import { fixedClock, type Clock } from "@cashback/core";
import { estimatedCashback, splitCommission } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { openSession } from "../src/modules/identity/index";
import { MISSING_ORDER_DAILY_LIMIT, reviewCaseDetail } from "../src/modules/orders/index";
import type { Ledger } from "../src/platform/db/ledger";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { CUSTOMER_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import { missingOrderRoutes } from "../src/web/missing-order.routes";
import { myMoneyRoutes } from "../src/web/my-money.routes";
import { closeLedgers } from "./helpers/order-ledger";
import { CLOCK, NOW, payoutLedger } from "./helpers/payout-ledger";

const ORIGIN = "https://hoantiendp.com";
const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  closeLedgers();
});

interface Spec {
  readonly id: string;
  readonly customer: string;
  readonly status: "AWAITING_APPROVAL" | "APPROVED" | "PAID" | "REJECTED" | "FROZEN";
  readonly commission?: number | null;
  readonly cashback?: number | null;
  readonly withheld?: boolean | null;
  readonly estimate?: number | null;
  readonly requestId?: string | null;
  readonly value?: number | null;
  readonly reason?: string | null;
}

function order(ledger: Ledger, o: Spec): void {
  const paid = o.status === "PAID";
  ledger.sqlite
    .prepare(
      "INSERT INTO orders (order_id, network, platform, customer_id, request_id, status, order_value, estimated_commission, approved_commission, cashback, cashback_withheld, rejection_reason, recorded_at, approved_at, paid_at, origin) VALUES (?, 'shopee', 'shopee', ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-10-18T14:04:00.000Z', ?, ?, 'REPORT')",
    )
    .run(o.id, o.customer, o.requestId ?? null, o.status, o.value ?? null, o.estimate ?? null, o.commission ?? null, o.cashback ?? null, o.withheld === undefined || o.withheld === null ? null : Number(o.withheld), o.reason ?? null, o.status === "AWAITING_APPROVAL" || o.status === "REJECTED" ? null : "2026-10-24T02:12:00.000Z", paid ? "2026-10-28T03:00:00.000Z" : null);
}

function payout(ledger: Ledger, id: number, customer: string, orderId: string, amount: number, status: "RECORDED" | "VOIDED", recordedAt: string): void {
  ledger.sqlite
    .prepare("INSERT INTO payouts (payout_id, customer_id, status, transfer_amount, receipt_token, recorded_at, voided_at, void_reason, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRM')")
    .run(id, customer, status, amount, `rcpt_order_detail_${id}`, recordedAt, status === "VOIDED" ? recordedAt : null, status === "VOIDED" ? "wrong" : null);
  ledger.sqlite.prepare("INSERT INTO payout_items (payout_id, line_no, kind, order_id, amount) VALUES (?, 1, 'ORDER', ?, ?)").run(id, orderId, amount);
}

/** Lan (P1) with a record merged into her (P1OLD); Khoa (P2) with his own order. */
function ledgerOfLan(): Ledger {
  const ledger = payoutLedger();
  ledger.sqlite.exec(`
    UPDATE customers SET created_at = '2026-09-03T02:00:00.000Z' WHERE customer_id = 'P1';
    INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('P1OLD', NULL, 'USER', 'MERGED');
    INSERT INTO customer_aliases (alias, customer_id) VALUES ('P1OLD', 'P1');
    INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, product_name, product_image_url, origin) VALUES
      ('RQD1', 'P1', 'shopee', 'shopee', 'CONVERTED', 'https://shopee.vn/p/1', 'Noi com dien tu 1.8L', 'https://cf.shopee.vn/file/rice', 'REQUEST');`);
  order(ledger, { id: "241018A7KQ2M", customer: "P1", status: "APPROVED", commission: 11693, cashback: 9263, withheld: false, requestId: "RQD1", value: 450000 });
  order(ledger, { id: "241019B0000W", customer: "P1OLD", status: "APPROVED", commission: 11693, cashback: 8327, withheld: null });
  order(ledger, { id: "241026W00001", customer: "P1", status: "AWAITING_APPROVAL", estimate: 13007 });
  order(ledger, { id: "241001P00001", customer: "P1", status: "PAID", commission: 15000, cashback: 11882, withheld: false });
  payout(ledger, 1, "P1", "241001P00001", 11882, "VOIDED", "2026-10-27T03:00:00.000Z");
  payout(ledger, 2, "P1", "241001P00001", 11882, "RECORDED", "2026-10-28T03:00:00.000Z");
  order(ledger, { id: "241002R00001", customer: "P1", status: "REJECTED", reason: "order_cancelled", value: 99000 });
  order(ledger, { id: "241003L00001", customer: "P1", status: "APPROVED", commission: 100000, cashback: 60000, withheld: true });
  order(ledger, { id: "241014K00009", customer: "P2", status: "APPROVED", commission: 20000, cashback: 15000, withheld: false });
  return ledger;
}

function site(ledger: Ledger, clock: Clock = CLOCK) {
  const servers = buildServers({ clock, internalToken: "i".repeat(40), public: [myMoneyRoutes({ ledger, clock }), missingOrderRoutes({ ledger, clock, origins: [ORIGIN] })] });
  opened.push(servers);
  const cookieOf = (customerId: string): string => `${CUSTOMER_SESSION_COOKIE}=${ledger.tx((db) => openSession(db, { kind: "CUSTOMER", customerId }, clock, null)).token}`;
  const get = async (url: string, cookie: string | undefined) => {
    const res = await servers.publicApp.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
    return { status: res.statusCode, body: res.json() as Record<string, unknown>, cacheControl: res.headers["cache-control"] };
  };
  const post = async (cookie: string | undefined, payload: unknown, origin: string | null = ORIGIN) => {
    const headers: Record<string, string> = { ...(cookie === undefined ? {} : { cookie }), ...(origin === null ? {} : { origin }) };
    const res = await servers.publicApp.inject({ method: "POST", url: MY_MISSING_ORDERS_PATH, headers, payload: payload as Record<string, unknown> });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };
  return { cookieOf, get, post };
}

const detail = async (s: ReturnType<typeof site>, cookie: string, orderId: string) => myOrderDetailSchema.parse((await s.get(myOrderPath(orderId), cookie)).body);

describe("Story 7.4: one order in full (pen.dev opJFP)", () => {
  it("an approved order: product snapshot, order value, and the split of the stored approved commission giving the stored cashback", async () => {
    const s = site(ledgerOfLan());
    const lan = s.cookieOf("P1");
    const res = await s.get(myOrderPath("241018A7KQ2M"), lan);
    expect(res.status).toBe(200);
    expect(res.cacheControl).toBe("no-store");
    const order = myOrderDetailSchema.parse(res.body);
    expect(order).toMatchObject({ orderId: "241018A7KQ2M", platform: "shopee", status: "APPROVED", productName: "Noi com dien tu 1.8L", productImageUrl: "https://cf.shopee.vn/file/rice", orderValue: 450000, recordedAt: "2026-10-18T14:04:00.000Z", approvedAt: "2026-10-24T02:12:00.000Z", paidAt: null, payout: null, deducted: null });
    expect(order.money).toEqual({ estimate: false, commission: 11693, feeBps: 98, fee: 115, taxBps: 0, tax: 0, shareBps: 8000, cashback: 9263, explained: true });
    expect(splitCommission({ approvedCommission: 11693, network: "shopee", withheld: false }).cashback).toBe(order.money?.cashback);
  });

  it("an imported approval with no stored setting splits withheld (10% tax), as the live system paid it", async () => {
    const s = site(ledgerOfLan());
    const order = await detail(s, s.cookieOf("P1"), "241019B0000W");
    expect(order.money).toEqual({ estimate: false, commission: 11693, feeBps: 98, fee: 115, taxBps: 1000, tax: 1169, shareBps: 8000, cashback: 8327, explained: true });
  });

  it("an awaiting order shows the estimate through the same split, labelled as an estimate, equal to the list's figure", async () => {
    const s = site(ledgerOfLan());
    const order = await detail(s, s.cookieOf("P1"), "241026W00001");
    expect(order.status).toBe("AWAITING_APPROVAL");
    expect(order.money).toEqual({ estimate: true, commission: 13007, feeBps: 98, fee: 127, taxBps: 1000, tax: 1301, shareBps: 8000, cashback: 9263, explained: true });
    expect(order.money?.cashback).toBe(estimatedCashback(13007, "shopee"));
  });

  it("a paid order names the recorded payout that paid it with its receipt; a voided one is never named", async () => {
    const s = site(ledgerOfLan());
    const order = await detail(s, s.cookieOf("P1"), "241001P00001");
    expect(order.status).toBe("PAID");
    expect(order.paidAt).toBe("2026-10-28T03:00:00.000Z");
    expect(order.payout).toEqual({ recordedAt: "2026-10-28T03:00:00.000Z", receiptToken: "rcpt_order_detail_2" });
  });

  it("a cashback the split does not explain (the old system's own figure) is still the stored one, with no fee or tax lines claimed", async () => {
    const s = site(ledgerOfLan());
    const order = await detail(s, s.cookieOf("P1"), "241003L00001");
    expect(order.money).toMatchObject({ commission: 100000, cashback: 60000, explained: false });
  });

  it("a rejected order has no money to split and carries its reason code; a paid order cancelled afterwards reads REVERSED with its deduction", async () => {
    const ledger = ledgerOfLan();
    order(ledger, { id: "240901C00001", customer: "P1", status: "PAID", commission: 12000, cashback: 9263, withheld: false });
    ledger.sqlite.prepare("INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, order_id, reason, created_at, created_by) VALUES ('P1', 'c-1', 'CLAWBACK', -9263, '240901C00001', 'cancel_after_payout', ?, 'test')").run(NOW);
    const s = site(ledger);
    const lan = s.cookieOf("P1");
    expect(await detail(s, lan, "241002R00001")).toMatchObject({ status: "REJECTED", money: null, rejectionReason: "order_cancelled", orderValue: 99000 });
    expect(await detail(s, lan, "240901C00001")).toMatchObject({ status: "REVERSED", money: null, deducted: 9263 });
  });

  it("an order without a link request shows the report's first item (D56), https images only", async () => {
    const ledger = ledgerOfLan();
    ledger.sqlite.prepare("INSERT INTO order_items (order_id, line_no, name, image_url, origin) VALUES ('241019B0000W', 1, 'Kem chong nang', 'https://cf.shopee.vn/file/kem', 'REPORT'), ('241019B0000W', 2, 'Other', NULL, 'REPORT')").run();
    ledger.sqlite.prepare("INSERT INTO order_items (order_id, line_no, name, image_url, origin) VALUES ('241001P00001', 1, 'Tai nghe', 'http://insecure.example/x.jpg', 'REPORT')").run();
    const s = site(ledger);
    const lan = s.cookieOf("P1");
    expect(await detail(s, lan, "241019B0000W")).toMatchObject({ productName: "Kem chong nang", productImageUrl: "https://cf.shopee.vn/file/kem" });
    expect(await detail(s, lan, "241001P00001")).toMatchObject({ productName: "Tai nghe", productImageUrl: null });
  });

  it("scoping: another customer's order is 404 like an unknown one, a merged record's order is the survivor's, no session is 401", async () => {
    const s = site(ledgerOfLan());
    const lan = s.cookieOf("P1");
    const khoa = s.cookieOf("P2");
    expect((await s.get(myOrderPath("241014K00009"), lan)).status).toBe(404);
    expect((await s.get(myOrderPath("NOSUCHORDER1"), lan)).status).toBe(404);
    expect((await s.get(myOrderPath("241018A7KQ2M"), khoa)).status).toBe(404);
    expect((await s.get(`${myOrderPath("241018A7KQ2M")}?customerId=P1`, khoa)).status).toBe(404);
    expect((await s.get(myOrderPath("241019B0000W"), lan)).status).toBe(200);
    expect((await s.get(myOrderPath("241014K00009"), khoa)).status).toBe(200);
    expect((await s.get(myOrderPath("241018A7KQ2M"), undefined)).status).toBe(401);
  });
});

describe("Story 7.4: My money greets the customer (pen.dev ktmGZ)", () => {
  it("the display name and the join time, nothing else about the customer", async () => {
    const s = site(ledgerOfLan());
    const body = (await s.get(MY_MONEY_PATH, s.cookieOf("P1"))).body;
    expect(body["customer"]).toEqual({ displayName: "Nguyễn Thị Lan", joinedAt: "2026-09-03T02:00:00.000Z" });
    expect(myMoneySchema.parse(body).customer.displayName).toBe("Nguyễn Thị Lan");
    const khoa = myMoneySchema.parse((await s.get(MY_MONEY_PATH, s.cookieOf("P2"))).body);
    expect(khoa.customer).toEqual({ displayName: "Trần Minh Khoa", joinedAt: null });
  });

  it("a blank name or an imported time the contract cannot read is left out", async () => {
    const ledger = ledgerOfLan();
    ledger.sqlite.exec("UPDATE customers SET display_name = '  ', created_at = '2026-09-03 09:00:00' WHERE customer_id = 'P1'");
    const s = site(ledger);
    expect(myMoneySchema.parse((await s.get(MY_MONEY_PATH, s.cookieOf("P1"))).body).customer).toEqual({ displayName: null, joinedAt: null });
  });
});

const REPORT: MissingOrderRequest = { orderId: "241028d9trx", purchasedOn: "2026-10-28", productUrl: "https://shopee.vn/Kem-i.1.2", note: "Mua luc 9 gio toi", checks: { openedInZalo: false, otherCashbackLink: true, guestLink: false } };

const cases = (ledger: Ledger) =>
  ledger.sqlite.prepare("SELECT case_id AS caseId, network, subject, order_id AS orderId, reason, status, candidates, observation, opened_by AS openedBy FROM review_cases WHERE reason = 'missing_order_report' ORDER BY case_id").all() as {
    caseId: number;
    network: string;
    subject: string;
    orderId: string | null;
    reason: string;
    status: string;
    candidates: string;
    observation: string;
    openedBy: string;
  }[];

describe("Story 7.4: a purchase that did not show (pen.dev Gc1Zb)", () => {
  it("opens one review case for staff with the customer as its candidate and what was typed as its facts; no order changes", async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    const before = ledger.sqlite.prepare("SELECT count(*) AS n FROM orders").get() as { n: number };
    const res = await s.post(s.cookieOf("P1"), REPORT);
    expect(res).toEqual({ status: 200, body: { result: "received", orderId: "241028D9TRX" } });
    const [opened, ...rest] = cases(ledger);
    expect(rest).toHaveLength(0);
    expect(opened).toMatchObject({ network: "shopee", subject: "241028D9TRX", orderId: null, status: "OPEN", candidates: '["P1"]', openedBy: "P1" });
    expect(JSON.parse(opened?.observation ?? "{}")).toEqual({ orderId: "241028D9TRX", purchasedOn: "2026-10-28", productUrl: "https://shopee.vn/Kem-i.1.2", note: "Mua luc 9 gio toi", openedInZalo: false, otherCashbackLink: true, guestLink: false });
    expect((ledger.sqlite.prepare("SELECT count(*) AS n FROM orders").get() as { n: number }).n).toBe(before.n);
    const panel = reviewCaseDetail(ledger.db, opened?.caseId ?? 0);
    expect(panel).toMatchObject({ reason: "missing_order_report", applicable: false });
    expect(panel?.candidates.map((c) => c.customerCode)).toEqual(["DP00012"]);
    expect(panel?.facts.map((f) => f.key)).toEqual(["orderId", "purchasedOn", "productUrl", "note", "openedInZalo", "otherCashbackLink", "guestLink"]);
  });

  it("dedup per order id: the same customer again changes nothing; another customer joins the one open case as a second candidate", async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    await s.post(s.cookieOf("P1"), REPORT);
    expect((await s.post(s.cookieOf("P1"), { ...REPORT, orderId: "241028D9TRX", note: "lan nua" })).body).toEqual({ result: "already_reported", orderId: "241028D9TRX" });
    expect((await s.post(s.cookieOf("P2"), { ...REPORT, note: "" })).body).toEqual({ result: "received", orderId: "241028D9TRX" });
    const all = cases(ledger);
    expect(all).toHaveLength(1);
    expect(JSON.parse(all[0]?.candidates ?? "[]")).toEqual(["P1", "P2"]);
    expect(JSON.parse(all[0]?.observation ?? "{}")).toMatchObject({ note: "Mua luc 9 gio toi" });
  });

  it("an order already the customer's own (a merged record's too) is answered as recorded and opens no case", async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    for (const orderId of ["241018A7KQ2M", "241019B0000W"]) expect((await s.post(s.cookieOf("P1"), { ...REPORT, orderId })).body).toEqual({ result: "already_recorded", orderId });
    expect(cases(ledger)).toHaveLength(0);
  });

  it("another customer's recorded order is answered like any report (nothing about its owner leaks) and the case names the order", async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    const res = await s.post(s.cookieOf("P1"), { ...REPORT, orderId: "241014K00009" });
    expect(res.body).toEqual({ result: "received", orderId: "241014K00009" });
    expect(cases(ledger)[0]).toMatchObject({ orderId: "241014K00009", candidates: '["P1"]' });
  });

  it("a TikTok Shop order id (digits only) opens the case under AccessTrade", async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    expect((await s.post(s.cookieOf("P1"), { ...REPORT, orderId: "5781 2345 6789 01234" })).body).toEqual({ result: "received", orderId: "57812345678901234" });
    expect(cases(ledger)[0]).toMatchObject({ network: "accesstrade", subject: "57812345678901234" });
  });

  it(`rate limit: ${MISSING_ORDER_DAILY_LIMIT} new reports per customer in 24 hours, then 429 with nothing stored; others are unaffected; a day later it opens again`, async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    const lan = s.cookieOf("P1");
    for (let i = 0; i < MISSING_ORDER_DAILY_LIMIT; i++) expect((await s.post(lan, { ...REPORT, orderId: `24102${i}AAAA01` })).status).toBe(200);
    const refused = await s.post(lan, { ...REPORT, orderId: "241027ZZZZ01" });
    expect(refused).toMatchObject({ status: 429, body: { error: { code: "rate_limited", messageKey: "error.missing_order.too_many" } } });
    expect(cases(ledger)).toHaveLength(MISSING_ORDER_DAILY_LIMIT);
    expect((await s.post(lan, { ...REPORT, orderId: "241020AAAA01" })).body).toMatchObject({ result: "already_reported" });
    expect((await s.post(s.cookieOf("P2"), { ...REPORT, orderId: "241027ZZZZ01" })).status).toBe(200);
    const later = site(ledger, fixedClock("2026-10-31T12:00:01.000Z"));
    expect((await later.post(later.cookieOf("P1"), { ...REPORT, orderId: "241029ZZZZ01", purchasedOn: "2026-10-29" })).status).toBe(200);
  });

  it("each broken rule is said under its field: order id form, the purchase day (not future, not over 120 days), the link", async () => {
    const s = site(ledgerOfLan());
    const lan = s.cookieOf("P1");
    const fields = async (patch: Partial<MissingOrderRequest>) => ((await s.post(lan, { ...REPORT, ...patch })).body["error"] as { fields?: Record<string, string> }).fields;
    expect(await fields({ orderId: "abc" })).toEqual({ orderId: "error.missing_order.order_id_rule" });
    expect(await fields({ purchasedOn: "2026-10-31" })).toEqual({ purchasedOn: "error.missing_order.date_rule" });
    expect(await fields({ purchasedOn: "2026-06-01" })).toEqual({ purchasedOn: "error.missing_order.date_rule" });
    expect(await fields({ purchasedOn: "28/10/2026" })).toEqual({ purchasedOn: "error.missing_order.date_rule" });
    expect(await fields({ productUrl: "javascript:alert(1)" })).toEqual({ productUrl: "error.missing_order.link_rule" });
    expect((await s.post(lan, { ...REPORT, productUrl: "" })).status).toBe(200);
  });

  it("refused without the website's Origin, without a session, or with a field the form does not have (no customer id can be named)", async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    expect((await s.post(s.cookieOf("P1"), REPORT, null)).status).toBe(403);
    expect((await s.post(s.cookieOf("P1"), REPORT, "https://evil.example")).status).toBe(403);
    expect((await s.post(undefined, REPORT)).status).toBe(401);
    expect((await s.post(s.cookieOf("P1"), { ...REPORT, customerId: "P2" })).status).toBe(400);
    expect(cases(ledger)).toHaveLength(0);
  });
});
