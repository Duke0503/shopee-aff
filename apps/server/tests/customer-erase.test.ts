/**
 * Story 4.16: erasing a customer's personal data (FR-35, NFR-6, D13, D26, SECURITY_MODEL.md
 * INV-11). The record keeps its permanent id and its money facts; every read (lists, receipt,
 * review candidates, search_text) sees the erasure; later orders on its old links land on it with
 * cashback 0 and no message.
 */
import { adminCustomersResponseSchema, adminOrdersResponseSchema, customerErasedResponseSchema, customerPageSchema } from "@cashback/contracts";
import { fixedClock, parseInstant } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { getBalances, findReceipt, payoutQueueRows } from "../src/modules/payouts/index";
import { overviewOf } from "../src/admin/overview.query";
import type { Ledger } from "../src/platform/db/ledger";
import { close, type Servers } from "../src/platform/http/servers";
import { deskGet, deskPost, errorOf, staffCookie } from "./helpers/desk-http";
import { approved, cancelled, closeLedgers } from "./helpers/order-ledger";
import { apply } from "./helpers/order-ledger";
import { addBank, addOrder, CLOCK, payoutLedger } from "./helpers/payout-ledger";
import { deskServers } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

const LATER = fixedClock("2026-11-02T03:00:00.000Z");
const all = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).all() as Record<string, unknown>[];
const one = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).get() as Record<string, unknown>;

/** Lan (P1) with payable 79,216 (an approved order of 82,216 less an open clawback of 3,000), a paid order, a payout, a clawback, a bank account, a session and a pending message. */
function owedLedger(): Ledger {
  const ledger = payoutLedger();
  addOrder(ledger, { id: "260901AAA", customer: "P1", cashback: 82216 });
  addOrder(ledger, { id: "260801PPP", customer: "P1", status: "PAID", cashback: 12000 });
  addBank(ledger, "P1", { number: "0071000123456" });
  ledger.sqlite.exec(`
    UPDATE customers SET zalo_user_id = '8812447100912', private_chat_id = 'chat-p1', password_hash = '$argon2id$v=19$m=19456,t=2,p=1$x$y' WHERE customer_id = 'P1';
    INSERT INTO payouts (payout_id, customer_id, status, transfer_amount, receipt_token, bank_last_four, recorded_at, origin) VALUES (7, 'P1', 'RECORDED', 12000, 'rcpt_erase_test_0001', '3456', '2026-10-02T03:00:00.000Z', 'CONFIRM');
    INSERT INTO payout_items (payout_id, line_no, kind, order_id, amount) VALUES (7, 1, 'ORDER', '260801PPP', 12000);
    INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, order_id, created_at, created_by) VALUES ('P1', 'CBX', 'CLAWBACK', -3000, '260801PPP', '2026-10-03T03:00:00.000Z', 'test');
    INSERT INTO sessions (token_hash, kind, customer_id, created_at) VALUES ('${"b".repeat(64)}', 'CUSTOMER', 'P1', '2026-10-01T00:00:00.000Z');
    INSERT INTO outbox (dedup_key, customer_id, message_key, created_at, due_at, origin) VALUES ('order:260901AAA:approved', 'P1', 'order_approved', '2026-10-20T03:00:00.000Z', '2026-10-20T03:00:00.000Z', 'EVENT');
    INSERT INTO customer_aliases (alias, customer_id, note) VALUES ('8812440000001', 'P1', 'old zalo');`);
  return ledger;
}

async function post(ledger: Ledger, staff: "minh" | "tuan", url: string, body: unknown = {}) {
  servers ??= deskServers(ledger, CLOCK);
  return deskPost(servers, url, staffCookie(ledger, staff, CLOCK), body, CLOCK);
}

const moneyFacts = (ledger: Ledger) => ({
  orders: all(ledger, "SELECT order_id, customer_id, status, approved_commission, cashback, paid_at FROM orders ORDER BY order_id"),
  payouts: all(ledger, "SELECT payout_id, customer_id, status, transfer_amount, receipt_token FROM payouts ORDER BY payout_id"),
  items: all(ledger, "SELECT * FROM payout_items ORDER BY payout_id, line_no"),
  ledger: all(ledger, "SELECT entry_id, customer_id, clawback_id, kind, amount FROM ledger_entries ORDER BY entry_id"),
});

describe("Story 4.16: erase a customer's personal data", () => {
  it("AC1: an employee's erase of a customer with payable 79,216 is refused with the owed amount; an admin with a reason forces it", async () => {
    const ledger = owedLedger();
    const refused = await post(ledger, "tuan", "/api/admin/customers/DP00012/erase");
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused.body)).toMatchObject({ code: "conflict", messageKey: "error.customer.owed_money", fields: { payable: "79216", waiting: "0" } });
    expect((await post(ledger, "tuan", "/api/admin/customers/DP00012/force-erase", { reason: "customer asked" })).statusCode).toBe(403);
    expect(errorOf((await post(ledger, "minh", "/api/admin/customers/DP00012/force-erase")).body).messageKey).toBe("error.customer.reason_required");
    expect(one(ledger, "SELECT status FROM customers WHERE customer_id = 'P1'")).toEqual({ status: "ACTIVE" });
    const forced = await post(ledger, "minh", "/api/admin/customers/DP00012/force-erase", { reason: "customer asked by phone" });
    expect(forced.statusCode, forced.body).toBe(200);
    expect(customerErasedResponseSchema.parse(forced.json())).toMatchObject({ customerId: "P1", forced: true, erasedAt: CLOCK.now() });
    const audit = one(ledger, "SELECT actor_id, reason, payload FROM audit_entries WHERE event = 'identity.customer.erased'");
    expect(audit).toMatchObject({ actor_id: "minh", reason: "customer asked by phone" });
    expect(JSON.parse(String(audit["payload"]))).toMatchObject({ customerId: "P1", forced: true, owedPayable: 79216, owedWaiting: 0 });
    expect(String(audit["payload"])).not.toMatch(/0071000123456|8812447100912|Lan/);
  });

  it("AC1: a customer owed nothing is erased by an employee without a reason; a second erase is refused", async () => {
    const ledger = payoutLedger();
    expect((await post(ledger, "tuan", "/api/admin/customers/P2/erase")).statusCode).toBe(200);
    expect(errorOf((await post(ledger, "tuan", "/api/admin/customers/P2/erase")).body).messageKey).toBe("error.customer.already_erased");
  });

  it("AC2: personal columns, search_text and sort_key are empty; orders, payouts and ledger entries are unchanged under the same id", async () => {
    const ledger = owedLedger();
    const before = moneyFacts(ledger);
    expect((await post(ledger, "minh", "/api/admin/customers/P1/force-erase", { reason: "privacy request" })).statusCode).toBe(200);
    expect(one(ledger, "SELECT customer_id, customer_code, status, display_name, zalo_user_id, private_chat_id, password_hash, password_set_at, search_text, sort_key, erased_at FROM customers WHERE customer_id = 'P1'")).toEqual({
      customer_id: "P1", customer_code: "DP00012", status: "ERASED", display_name: null, zalo_user_id: null, private_chat_id: null, password_hash: null, password_set_at: null, search_text: "", sort_key: "", erased_at: CLOCK.now(),
    });
    expect(all(ledger, "SELECT * FROM bank_accounts WHERE customer_id = 'P1'")).toEqual([]);
    // Alias keys are ids old links carry and retired codes; they stay so attribution and code issuance still see them.
    expect(all(ledger, "SELECT alias, note FROM customer_aliases WHERE customer_id = 'P1'")).toEqual([{ alias: "8812440000001", note: null }]);
    expect(moneyFacts(ledger)).toEqual(before);
    expect(one(ledger, "SELECT end_reason FROM sessions WHERE customer_id = 'P1'")).toEqual({ end_reason: "SIGNED_OUT" });
    expect(one(ledger, "SELECT due_at, sent_at FROM outbox WHERE customer_id = 'P1'")).toEqual({ due_at: null, sent_at: null });
  });

  it("AC2: every read respects it: the list search, the list name, the receipt and the customer page", async () => {
    const ledger = owedLedger();
    servers = deskServers(ledger, CLOCK);
    const cookie = staffCookie(ledger, "tuan", CLOCK);
    await post(ledger, "minh", "/api/admin/customers/P1/force-erase", { reason: "privacy request" });
    const byName = adminCustomersResponseSchema.parse((await deskGet(servers, "/api/admin/customers?q=nguyen%20thi%20lan", cookie, CLOCK)).json());
    expect(byName.rows.map((r) => r.customerId)).not.toContain("P1");
    const listed = adminCustomersResponseSchema.parse((await deskGet(servers, "/api/admin/customers?pageSize=100", cookie, CLOCK)).json()).rows.find((r) => r.customerId === "P1");
    expect(listed).toMatchObject({ customerCode: "DP00012", customerName: null, bankName: null, accountLastFour: null });
    const orders = adminOrdersResponseSchema.parse((await deskGet(servers, "/api/admin/orders?pageSize=100", cookie, CLOCK)).json()).rows.filter((r) => r.customerCode === "DP00012");
    expect(orders.map((r) => [r.orderId, r.customerName])).toEqual(expect.arrayContaining([["260901AAA", null], ["260801PPP", null]]));
    expect(findReceipt(ledger.db, "rcpt_erase_test_0001")).toMatchObject({ customerCode: "DP00012", bankLastFour: "3456", amount: 12000 });
    const page = customerPageSchema.parse((await deskGet(servers, "/api/admin/customers/DP00012", cookie, CLOCK)).json());
    expect(page).toMatchObject({ status: "ERASED", customerName: null, zaloUserId: null, bank: null, erasedAt: CLOCK.now() });
  });

  it("AC2: an erased record is no review candidate and its old Zalo id finds nobody", async () => {
    const ledger = owedLedger();
    await post(ledger, "minh", "/api/admin/customers/P1/force-erase", { reason: "privacy request" });
    servers ??= deskServers(ledger, CLOCK);
    const res = await deskGet(servers, "/api/admin/customers/8812447100912", staffCookie(ledger, "tuan", CLOCK), CLOCK);
    expect(res.statusCode).toBe(404);
  });

  it("AC2: the merged records of the same person lose their personal data too", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec(`UPDATE customers SET status = 'MERGED', zalo_user_id = '8812447777777' WHERE customer_id = 'P3';
      INSERT INTO customer_aliases (alias, customer_id, note) VALUES ('P3', 'P2', 'merge')`);
    expect((await post(ledger, "tuan", "/api/admin/customers/P2/erase")).statusCode).toBe(200);
    expect(one(ledger, "SELECT status, display_name, zalo_user_id, search_text FROM customers WHERE customer_id = 'P3'")).toEqual({ status: "MERGED", display_name: null, zalo_user_id: null, search_text: "" });
    expect(all(ledger, "SELECT alias FROM customer_aliases WHERE customer_id = 'P2'")).toEqual([{ alias: "P3" }]);
  });

  it("AC3: an order later reported on an erased customer's old link attributes to the erased record with cashback 0 and no outbox row", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, origin) VALUES ('REQP2', 'P2', 'shopee', 'shopee', 'DELIVERED', 'https://shopee.vn/p/22', 'REQUEST')");
    expect((await post(ledger, "tuan", "/api/admin/customers/P2/erase")).statusCode).toBe(200);
    // Bought after the erasure (1 November), reported later.
    apply(ledger, { ...approved("261101LATE", [20000], { subIds: ["P2", "REQP2", "", "", ""] }), purchasedAt: parseInstant("2026-11-01T03:00:00.000Z") }, LATER);
    expect(one(ledger, "SELECT customer_id, status, approved_commission, cashback FROM orders WHERE order_id = '261101LATE'")).toEqual({ customer_id: "P2", status: "APPROVED", approved_commission: 20000, cashback: 0 });
    expect(all(ledger, "SELECT dedup_key FROM outbox WHERE customer_id = 'P2'")).toEqual([]);
    expect(all(ledger, "SELECT case_id FROM review_cases")).toEqual([]);
  });

  it("an open payout claim blocks the erase: a transfer may be under way", async () => {
    const ledger = owedLedger();
    ledger.sqlite.exec(`INSERT INTO payout_claims (claim_id, customer_id, staff_id, status, order_ids, award_ids, clawback_ids, amount, bank_fingerprint, bank_held, snapshot_hash, transfer_reference, opened_at, last_active_at)
      VALUES ('K7Q2M9XA', 'P1', 'minh', 'OPEN', '[]', '[]', '[]', 79216, '${"c".repeat(64)}', 0, '${"d".repeat(64)}', 'DP00012 K7Q2M9XA', '${CLOCK.now()}', '${CLOCK.now()}')`);
    expect(errorOf((await post(ledger, "minh", "/api/admin/customers/P1/force-erase", { reason: "privacy request" })).body).messageKey).toBe("error.customer.claim_open");
  });

  it("review fix 1: an order paid before the erasure still claws back on a later cancel; one bought before it still earns on approval", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001PAIDB4", customer: "P2", status: "PAID", cashback: 9263 });
    addOrder(ledger, { id: "261020WAITB4", customer: "P2", status: "AWAITING_APPROVAL", estimate: 20000 });
    ledger.sqlite.exec("UPDATE orders SET recorded_at = '2026-10-20T03:00:00.000Z' WHERE order_id IN ('261001PAIDB4', '261020WAITB4')");
    expect((await post(ledger, "minh", "/api/admin/customers/P2/force-erase", { reason: "privacy request" })).statusCode).toBe(200);
    apply(ledger, cancelled("261001PAIDB4", { subIds: ["P2", "", "", "", ""] }), LATER);
    expect(all(ledger, "SELECT customer_id, kind, amount FROM ledger_entries WHERE order_id = '261001PAIDB4'")).toEqual([{ customer_id: "P2", kind: "CLAWBACK", amount: -9263 }]);
    apply(ledger, approved("261020WAITB4", [20000], { subIds: ["P2", "", "", "", ""] }), LATER);
    expect(Number(one(ledger, "SELECT cashback FROM orders WHERE order_id = '261020WAITB4'")["cashback"])).toBeGreaterThan(0);
  });

  it("review fix 2: alias keys survive the erasure, still attribute to the erased record, and a retired code is never issued again", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("INSERT INTO customer_aliases (alias, customer_id, note) VALUES ('8812440000002', 'P2', 'old zalo'), ('DP00777', 'P2', 'retired code')");
    expect((await post(ledger, "tuan", "/api/admin/customers/P2/erase")).statusCode).toBe(200);
    expect(all(ledger, "SELECT alias, note FROM customer_aliases WHERE customer_id = 'P2' ORDER BY alias")).toEqual([{ alias: "8812440000002", note: null }, { alias: "DP00777", note: null }]);
    apply(ledger, { ...approved("261101OLDZ", [20000], { subIds: ["8812440000002", "", "", "", ""] }), purchasedAt: parseInstant("2026-11-01T03:00:00.000Z") }, LATER);
    expect(one(ledger, "SELECT customer_id, cashback FROM orders WHERE order_id = '261101OLDZ'")).toEqual({ customer_id: "P2", cashback: 0 });
    expect(() => ledger.sqlite.exec("INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('PX', 'DP00777', 'USER', 'ACTIVE')")).toThrow(/retired alias/);
  });

  it("review fix 3: money still owed after a forced erase (payable 300,000) stays on the customer page, the Payouts needs-action row and the Overview", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001OWED", customer: "P2", cashback: 300000 });
    addBank(ledger, "P2", { number: "0071000300000" });
    expect((await post(ledger, "minh", "/api/admin/customers/P2/force-erase", { reason: "privacy request" })).statusCode).toBe(200);
    expect(getBalances(ledger.db, ["P2"])[0]).toMatchObject({ customerId: "P2", payable: 300000 });
    const page = customerPageSchema.parse((await deskGet(servers as Servers, "/api/admin/customers/P2", staffCookie(ledger, "tuan", CLOCK), CLOCK)).json());
    expect(page).toMatchObject({ status: "ERASED", balance: { payable: 300000 }, bank: null });
    expect(page.flags).toEqual(expect.arrayContaining(["NO_BANK", "ERASED"]));
    const row = payoutQueueRows(ledger.db, CLOCK).find((r) => r.customerId === "P2");
    expect(row).toMatchObject({ queue: "ACTION", payable: 300000 });
    expect(row?.flags.split(",")).toEqual(expect.arrayContaining(["NO_BANK", "ERASED"]));
    const overview = overviewOf(ledger.db, { period: "thisMonth" }, CLOCK);
    expect(overview.money.weOweCustomers).toBe(300000);
    expect(overview.todo.owedWithoutBank).toEqual({ customers: 1, amount: 300000 });
    expect(overview.todo.payable.customers).toBe(0);
  });
});
