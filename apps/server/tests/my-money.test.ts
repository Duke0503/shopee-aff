/**
 * Stories 7.3 and 7.4 (server side): the signed-in customer's money, order lines and payouts on
 * the public listener. The balance equals `getBalances`, the admin's customer page and `/sodu`;
 * the next payout's netting of a clawback is said as /sodu says it; the order lines filtered to
 * the card's states add up to the card, bonuses as their own rows; and the session alone decides
 * whose data comes back. The website side is in apps/web/tests/my-money.test.tsx.
 */
import { MY_MONEY_PATH, MY_ORDERS_PATH, MY_ORDERS_SEARCH_SPEC, MY_PAYOUTS_PATH, MY_PAYOUTS_SEARCH_SPEC, myMoneySchema, myOrdersResponseSchema, myPayoutsResponseSchema, type MyOrderRow } from "@cashback/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { customerPage } from "../src/admin/customer-desk.routes";
import { commandReplyOf } from "../src/links/assistant-command.routes";
import { customerKeys, openSession } from "../src/modules/identity/index";
import { CUSTOMER_ORDERS_LIST } from "../src/modules/orders/index";
import { CUSTOMER_PAYOUTS_LIST, getBalances } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { CUSTOMER_SESSION_COOKIE, STAFF_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import { SITE_CSP } from "../src/platform/http/static-site";
import { myMoneyRoutes } from "../src/web/my-money.routes";
import { closeLedgers } from "./helpers/order-ledger";
import { addBank, addBonus, addClawback, CLOCK, NOW, payoutLedger } from "./helpers/payout-ledger";

const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  closeLedgers();
});

interface OrderRow {
  readonly id: string;
  readonly customer: string;
  readonly status: "AWAITING_APPROVAL" | "APPROVED" | "FROZEN" | "REVERSED" | "PAID" | "REJECTED";
  readonly cashback?: number;
  readonly estimate?: number;
  readonly recordedAt: string;
  readonly requestId?: string;
  readonly reason?: string;
}

function order(ledger: Ledger, o: OrderRow): void {
  const decided = o.status !== "AWAITING_APPROVAL";
  ledger.sqlite
    .prepare("INSERT INTO orders (order_id, network, platform, customer_id, request_id, status, estimated_commission, approved_commission, cashback, rejection_reason, recorded_at, approved_at, paid_at, origin) VALUES (?, 'shopee', 'shopee', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REPORT')")
    .run(o.id, o.customer, o.requestId ?? null, o.status, o.estimate ?? null, decided ? 100000 : null, decided ? (o.cashback ?? null) : null, o.reason ?? null, o.recordedAt, decided ? "2026-10-20T03:00:00.000Z" : null, o.status === "PAID" ? "2026-10-22T03:00:00.000Z" : null);
}

function payout(ledger: Ledger, id: number, customer: string, amount: number, status: "RECORDED" | "VOIDED", proof = false): void {
  ledger.sqlite
    .prepare("INSERT INTO payouts (payout_id, customer_id, status, transfer_amount, receipt_token, recorded_at, voided_at, void_reason, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRM')")
    .run(id, customer, status, amount, `rcpt_my_money_${String(id).padStart(4, "0")}`, `2026-10-0${id}T03:00:00.000Z`, status === "VOIDED" ? "2026-10-09T03:00:00.000Z" : null, status === "VOIDED" ? "wrong customer" : null);
  if (proof) ledger.sqlite.prepare("INSERT INTO payout_proofs (payout_id, file_name, content_type, byte_size, sha256, width, height, uploaded_by, uploaded_at) VALUES (?, ?, 'image/jpeg', 10, ?, 10, 10, 'minh', ?)").run(id, `${"a".repeat(31)}${id}.jpg`, "b".repeat(64), "2026-10-02T03:00:00.000Z");
}

/**
 * A paid order of `customer` the network cancelled afterwards (`cancel_after_payout`) or paid less
 * for (`commission_drop_after_payout`, D55), with its open clawback of `amount`, as
 * payouts/order-clawback.command.ts writes it.
 */
function clawedBack(ledger: Ledger, customer: string, orderId: string, amount: number, reason: "cancel_after_payout" | "commission_drop_after_payout", recordedAt: string): void {
  order(ledger, { id: orderId, customer, status: "PAID", cashback: amount, recordedAt });
  ledger.sqlite
    .prepare("INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, order_id, reason, created_at, created_by) VALUES (?, ?, 'CLAWBACK', ?, ?, ?, ?, 'test')")
    .run(customer, `${orderId}-1`, -amount, orderId, reason, NOW);
}

/**
 * Lan (P1, DP00012): approved 60,000 and 19,216 plus a 20,000 bonus, a 9,263 clawback on a paid
 * order, an order waiting with an estimate (9,263 cashback), a rejected one, a paid one with its
 * own paid bonus, a frozen one with a suspended bonus, a held bonus, a record merged into her
 * (P1OLD) with an approved order, and two payouts (one voided, one with a proof). Khoa (P2) has
 * his own order, clawback and payout.
 */
function ledgerOfLan(): Ledger {
  const ledger = payoutLedger();
  ledger.sqlite.exec(`
    INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('P1OLD', NULL, 'USER', 'MERGED');
    INSERT INTO customer_aliases (alias, customer_id) VALUES ('P1OLD', 'P1');
    INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, product_name, product_image_url, origin) VALUES
      ('RQL1', 'P1', 'shopee', 'shopee', 'CONVERTED', 'https://shopee.vn/p/11', 'Noi com dien Sunhouse 1.8L', 'https://cf.shopee.vn/file/rice', 'REQUEST'),
      ('RQL2', 'P1', 'shopee', 'shopee', 'CONVERTED', 'https://shopee.vn/p/12', 'Tai nghe P20i', 'http://insecure.example/x.jpg', 'REQUEST');`);
  order(ledger, { id: "261012A0001", customer: "P1", status: "APPROVED", cashback: 60000, recordedAt: "2026-10-12T03:00:00.000Z", requestId: "RQL1" });
  order(ledger, { id: "261013A0002", customer: "P1OLD", status: "APPROVED", cashback: 19216, recordedAt: "2026-10-13T03:00:00.000Z", requestId: "RQL2" });
  addBonus(ledger, "P1", "261013A0002", 20000);
  clawedBack(ledger, "P1", "260901C0001", 9263, "cancel_after_payout", "2026-09-01T03:00:00.000Z");
  addBonus(ledger, "P1", "260901C0001", 3000, "PAID");
  order(ledger, { id: "261026W0001", customer: "P1", status: "AWAITING_APPROVAL", estimate: 13007, recordedAt: "2026-10-26T03:00:00.000Z" });
  addBonus(ledger, "P1", "261026W0001", 15000, "HELD");
  order(ledger, { id: "261002R0001", customer: "P1", status: "REJECTED", recordedAt: "2026-10-02T03:00:00.000Z", reason: "order_cancelled" });
  order(ledger, { id: "260915P0001", customer: "P1", status: "PAID", cashback: 147000, recordedAt: "2026-09-15T03:00:00.000Z" });
  addBonus(ledger, "P1", "260915P0001", 5000, "PAID");
  order(ledger, { id: "261020F0001", customer: "P1", status: "FROZEN", cashback: 8000, recordedAt: "2026-10-20T03:00:00.000Z" });
  addBonus(ledger, "P1", "261020F0001", 7000);
  payout(ledger, 1, "P1", 152000, "RECORDED", true);
  payout(ledger, 2, "P1", 30000, "VOIDED");
  // The voided payout had netted 5,000 of an old clawback: that credit is owed to Lan again.
  ledger.sqlite.prepare("INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, payout_id, created_at, created_by) VALUES ('P1', 'old-claw', 'NETTING_REFUND', 5000, 2, ?, 'test')").run(NOW);
  addBank(ledger, "P1");
  order(ledger, { id: "261014A0009", customer: "P2", status: "APPROVED", cashback: 10000, recordedAt: "2026-10-14T03:00:00.000Z" });
  addClawback(ledger, "P2", "260902C0009", 30000);
  payout(ledger, 3, "P2", 44000, "RECORDED");
  return ledger;
}

function site(ledger: Ledger) {
  const servers = buildServers({ clock: CLOCK, internalToken: "i".repeat(40), public: [myMoneyRoutes({ ledger, clock: CLOCK })] });
  opened.push(servers);
  const cookieOf = (customerId: string): string => `${CUSTOMER_SESSION_COOKIE}=${ledger.tx((db) => openSession(db, { kind: "CUSTOMER", customerId }, CLOCK, null)).token}`;
  const get = async (url: string, cookie: string | undefined) => {
    const res = await servers.publicApp.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
    return { status: res.statusCode, body: res.json() as Record<string, unknown>, cacheControl: res.headers["cache-control"] };
  };
  return { cookieOf, get };
}

const money = async (s: ReturnType<typeof site>, cookie: string) => myMoneySchema.parse((await s.get(MY_MONEY_PATH, cookie)).body);
const lines = async (s: ReturnType<typeof site>, cookie: string, query = "") => myOrdersResponseSchema.parse((await s.get(`${MY_ORDERS_PATH}?pageSize=100${query}`, cookie)).body);
const sumOf = (rows: readonly MyOrderRow[]): number => rows.reduce((total, r) => total + (r.amount ?? 0), 0);

describe("Story 7.3: My money shows payable, waiting and paid amounts", () => {
  it("AC1: My money equals getBalances, the admin's customer page and /sodu for the same customer", async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    const mine = await money(s, s.cookieOf("P1"));
    const [balance] = getBalances(ledger.db, ["P1"]);
    expect(balance).toMatchObject({ gross: 104216, payable: 94953, waiting: 9263, paid: 152000, deductedNext: 9263 });
    expect(mine.balance).toEqual({ payable: 94953, approved: 99216, refunded: 5000, waiting: 9263, paid: 152000, deducted: 9263, owedAfter: 0 });
    const admin = customerPage(ledger.db, { customerId: "P1", keys: customerKeys(ledger.db, "P1")?.keys ?? [] }, CLOCK);
    expect(admin.balance).toMatchObject({ payable: mine.balance.payable, waiting: mine.balance.waiting, paid: mine.balance.paid, deductedNext: mine.balance.deducted + mine.balance.owedAfter });
    const { approved: _approved, refunded: _refunded, ...said } = mine.balance;
    expect(commandReplyOf(ledger.db, "balance", "P1")).toEqual({ kind: "balance", ...said });
    expect(mine.customerCode).toBe("DP00012");
  });

  it("AC2: an open clawback of 9,263 is the deduction line and lists the clawed-back order with its product", async () => {
    const s = site(ledgerOfLan());
    const mine = await money(s, s.cookieOf("P1"));
    expect(mine.balance.deducted).toBe(9263);
    expect(mine.deductions).toEqual([{ deductionId: "260901C0001-1", orderId: "260901C0001", productName: null, productImageUrl: null, amount: 9263 }]);
  });

  it("an order cancelled after it was paid reads as cancelled after approval (never as paid), with its paid bonus, and carries its deduction", async () => {
    const s = site(ledgerOfLan());
    const all = await lines(s, s.cookieOf("P1"));
    const cancelled = all.rows.filter((r) => r.orderId === "260901C0001");
    expect(cancelled.map((r) => [r.kind, r.status, r.amount, r.deducted])).toEqual([
      ["order", "REVERSED", null, 9263],
      ["bonus", "REVERSED", null, null],
    ]);
    expect((await lines(s, s.cookieOf("P1"), "&filter[status]=PAID")).rows.map((r) => r.orderId)).not.toContain("260901C0001");
    expect(all.facets["status"]?.find((f) => f.value === "REVERSED")?.count).toBe(2);
  });

  it("an order the network paid less for after payout stays paid and carries its deduction; a deduction shows on any order with an open clawback", async () => {
    const ledger = ledgerOfLan();
    clawedBack(ledger, "P5", "260903D0001", 4000, "commission_drop_after_payout", "2026-09-03T03:00:00.000Z");
    order(ledger, { id: "260904V0001", customer: "P5", status: "REVERSED", recordedAt: "2026-09-04T03:00:00.000Z" });
    ledger.sqlite.prepare("INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, order_id, reason, created_at, created_by) VALUES ('P5', 'v-1', 'CLAWBACK', -2500, '260904V0001', 'cancel_after_payout', ?, 'test')").run(NOW);
    const s = site(ledger);
    const rows = (await lines(s, s.cookieOf("P5"))).rows;
    expect(rows.map((r) => [r.orderId, r.status, r.deducted])).toEqual([
      ["260904V0001", "REVERSED", 2500],
      ["260903D0001", "PAID", 4000],
    ]);
  });

  it("a clawback without an order is its own deduction with a stable key and no order id", async () => {
    const ledger = ledgerOfLan();
    ledger.sqlite.prepare("INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, created_at, created_by) VALUES ('P6', 'imported-7', 'CLAWBACK', -1500, ?, 'cutover')").run(NOW);
    const s = site(ledger);
    expect((await money(s, s.cookieOf("P6"))).deductions).toEqual([{ deductionId: "imported-7", orderId: null, productName: null, productImageUrl: null, amount: 1500 }]);
  });

  it("AC2: an order cancelled after it was paid, above what is approved, is deducted up to the gross and the rest stays owed, as /sodu says", async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    const mine = await money(s, s.cookieOf("P2"));
    expect(mine.balance).toMatchObject({ payable: 0, waiting: 0, paid: 44000, deducted: 10000, owedAfter: 20000 });
    expect(mine.deductions.map((d) => d.amount)).toEqual([30000]);
    const { approved, refunded, ...said } = mine.balance;
    expect([approved, refunded]).toEqual([10000, 0]);
    expect(commandReplyOf(ledger.db, "balance", "P2")).toEqual({ kind: "balance", ...said });
  });

  it("AC3: another customer's data is never reachable: the session alone names the customer", async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    const khoa = s.cookieOf("P2");
    const khoaMoney = await money(s, khoa);
    expect(khoaMoney.customerCode).toBe("DP00031");
    for (const url of [`${MY_MONEY_PATH}?customerId=P1`, `${MY_MONEY_PATH}?customerKey=DP00012`]) expect(myMoneySchema.parse((await s.get(url, khoa)).body).balance).toEqual(khoaMoney.balance);
    const khoaLines = await lines(s, khoa);
    expect(khoaLines.rows.map((r) => r.orderId).sort()).toEqual(["260902C0009", "261014A0009"]);
    expect(khoaLines.overall).toBe(2);
    expect((await s.get(`${MY_ORDERS_PATH}?filter[customerId]=P1`, khoa)).status).toBe(400);
    expect((await s.get(`${MY_ORDERS_PATH}?q=261012A0001`, khoa)).body["total"]).toBe(0);
    const khoaPayouts = myPayoutsResponseSchema.parse((await s.get(MY_PAYOUTS_PATH, khoa)).body);
    expect(khoaPayouts.rows.map((p) => p.payoutId)).toEqual([3]);
    expect((await s.get(`${MY_PAYOUTS_PATH}?filter[customerId]=P1`, khoa)).status).toBe(400);
  });

  it("AC3: without a customer session (none, a staff session, an ended one) every route answers 401 and nothing is cached", async () => {
    const ledger = ledgerOfLan();
    const s = site(ledger);
    const staff = ledger.tx((db) => openSession(db, { kind: "STAFF", staffId: "minh" }, CLOCK, 60_000)).token;
    const ended = s.cookieOf("P1");
    ledger.sqlite.prepare("UPDATE sessions SET ended_at = ?, end_reason = 'NEW_PASSWORD' WHERE kind = 'CUSTOMER'").run(CLOCK.now());
    for (const path of [MY_MONEY_PATH, MY_ORDERS_PATH, MY_PAYOUTS_PATH]) {
      for (const cookie of [undefined, `${CUSTOMER_SESSION_COOKIE}=${staff}`, `${STAFF_SESSION_COOKIE}=${staff}`, ended]) {
        const res = await s.get(path, cookie);
        expect(res.status).toBe(401);
        expect(res.cacheControl).toBe("no-store");
      }
    }
  });

  it("AC4 (server half): the bank card says none, held or saved, with only the last four digits", async () => {
    const ledger = ledgerOfLan();
    addBank(ledger, "P2", { held: true, number: "0071000123456789" });
    const s = site(ledger);
    expect((await money(s, s.cookieOf("P1"))).bank).toEqual({ bankName: "Vietcombank", holderName: "NGUYEN THI LAN", lastFour: "0001", held: false });
    expect((await money(s, s.cookieOf("P2"))).bank).toMatchObject({ lastFour: "6789", held: true });
    expect(JSON.stringify(await money(s, s.cookieOf("P2")))).not.toContain("0071000123456789");
    expect((await money(s, s.cookieOf("P3"))).bank).toBeNull();
  });
});

describe("Story 7.4: My orders list with states in words", () => {
  it("AC1: each line carries the recorded date; a bonus line carries its order's recorded date", async () => {
    const s = site(ledgerOfLan());
    const all = await lines(s, s.cookieOf("P1"));
    const bonus = all.rows.find((r) => r.kind === "bonus" && r.orderId === "261013A0002");
    expect(bonus).toMatchObject({ status: "APPROVED", amount: 20000, estimate: false, campaignName: "October", recordedAt: "2026-10-13T03:00:00.000Z", productName: "Tai nghe P20i", productImageUrl: null });
    expect(all.rows.find((r) => r.orderId === "261012A0001" && r.kind === "order")).toMatchObject({ productName: "Noi com dien Sunhouse 1.8L", productImageUrl: "https://cf.shopee.vn/file/rice", recordedAt: "2026-10-12T03:00:00.000Z" });
  });

  it("AC2: the one sort (recorded date) changes the order on the server; nothing else sorts", async () => {
    const s = site(ledgerOfLan());
    const cookie = s.cookieOf("P1");
    const newest = (await lines(s, cookie)).rows.map((r) => r.recordedAt);
    const oldest = (await lines(s, cookie, "&sort=recordedAt:asc")).rows.map((r) => r.recordedAt);
    expect(newest[0]).toBe("2026-10-26T03:00:00.000Z");
    expect(oldest[0]).toBe("2026-09-01T03:00:00.000Z");
    for (const field of ["amount", "cashback", "status", "orderId"]) expect((await s.get(`${MY_ORDERS_PATH}?sort=${field}:desc`, cookie)).status).toBe(400);
    const sortable = (spec: { readonly fields: Readonly<Record<string, object>> }) => Object.entries(spec.fields).flatMap(([key, f]) => ("sortable" in f && f.sortable === true ? [key] : []));
    expect(sortable(CUSTOMER_ORDERS_LIST)).toEqual([...MY_ORDERS_SEARCH_SPEC.sortable]);
    expect(sortable(CUSTOMER_PAYOUTS_LIST)).toEqual([...MY_PAYOUTS_SEARCH_SPEC.sortable]);
  });

  it("AC3: a rejected order carries its reason code and no amount; a waiting one its estimate", async () => {
    const s = site(ledgerOfLan());
    const all = await lines(s, s.cookieOf("P1"));
    expect(all.rows.find((r) => r.orderId === "261002R0001")).toMatchObject({ status: "REJECTED", rejectionReason: "order_cancelled", amount: null });
    expect(all.rows.find((r) => r.orderId === "261026W0001" && r.kind === "order")).toMatchObject({ status: "AWAITING_APPROVAL", amount: 9263, estimate: true });
  });

  it("AC4: the lines filtered to the card's states add up to the card, bonuses as their own rows", async () => {
    const s = site(ledgerOfLan());
    const cookie = s.cookieOf("P1");
    const card = (await money(s, cookie)).balance;
    const approved = await lines(s, cookie, "&filter[status]=APPROVED");
    expect(approved.rows.map((r) => `${r.kind}:${r.orderId}`).sort()).toEqual(["bonus:261013A0002", "order:261012A0001", "order:261013A0002"]);
    expect(sumOf(approved.rows)).toBe(card.approved);
    // The payable view: the approved lines, the deduction and the refunded credit add up to the card.
    expect(card.approved - card.deducted + card.refunded).toBe(card.payable);
    expect([card.approved, card.deducted, card.refunded, card.payable]).toEqual([99216, 9263, 5000, 94953]);
    expect(sumOf((await lines(s, cookie, "&filter[status]=AWAITING_APPROVAL")).rows)).toBe(card.waiting);
    const payouts = myPayoutsResponseSchema.parse((await s.get(MY_PAYOUTS_PATH, cookie)).body);
    expect(payouts.summary["paidAmount"]).toBe(card.paid);
    expect(payouts.rows).toEqual([
      expect.objectContaining({ payoutId: 2, status: "VOIDED", amount: 30000, paidAmount: 0, hasProof: false }),
      expect.objectContaining({ payoutId: 1, status: "RECORDED", amount: 152000, paidAmount: 152000, hasProof: true, receiptToken: "rcpt_my_money_0001" }),
    ]);
    const all = await lines(s, cookie);
    expect(all.rows.filter((r) => r.kind === "bonus").map((r) => `${r.orderId}:${r.status}`).sort()).toEqual(["260901C0001:REVERSED", "260915P0001:PAID", "261013A0002:APPROVED", "261020F0001:FROZEN"]);
    expect(all.rows.find((r) => r.status === "FROZEN" && r.kind === "bonus")?.amount).toBeNull();
    expect(all.facets["status"]?.find((f) => f.value === "APPROVED")?.count).toBe(3);
  });

  it("AC5 (server half): a customer with no orders gets an empty page, overall 0", async () => {
    const s = site(ledgerOfLan());
    const empty = await lines(s, s.cookieOf("P4"));
    expect(empty).toMatchObject({ rows: [], total: 0, overall: 0 });
    expect(myPayoutsResponseSchema.parse((await s.get(MY_PAYOUTS_PATH, s.cookieOf("P4"))).body)).toMatchObject({ rows: [], total: 0, overall: 0 });
    expect(myPayoutsResponseSchema.parse((await s.get(MY_PAYOUTS_PATH, s.cookieOf("P1"))).body).overall).toBe(2);
  });

  it("product images of the network's image host load on the website (CSP img-src), and only https ones are sent", () => {
    const img = SITE_CSP.split("; ").find((d) => d.startsWith("img-src")) ?? "";
    expect(img.split(" ")).toEqual(expect.arrayContaining(["'self'", "https:"]));
    expect(img).not.toContain("http:");
  });
});
