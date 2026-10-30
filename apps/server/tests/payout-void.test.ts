/**
 * Story 4.10: an admin voids a payout recorded by mistake, with a reason (FR-34, AD-9, AD-7,
 * AD-17, D24, D41, INV-2, INV-11). One transaction undoes exactly what the payout wrote: each
 * covered order returns to the state its latest report row gives with paid_at cleared, a clawback
 * opened on a reversed order is closed by an offsetting entry, netting is reversed, bonuses return
 * to CONFIRMED or VOID, the payout is VOIDED and its receipt says so, and a customer who was told
 * gets one correction message. The four combinations are golden (packages/golden/fixtures/payouts).
 */
import { errorEnvelopeSchema, payoutVoidPreviewSchema, payoutVoidResponseSchema } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { loadVoidFixtures, type VoidCase } from "@cashback/golden/void";
import { afterEach, describe, expect, it } from "vitest";

import { openSession, STAFF_SESSION_MS } from "../src/modules/identity/index";
import { outboxFor } from "../src/modules/messaging/index";
import { commandAudit } from "../src/modules/operations/index";
import { clawbackOpen, getBalances, PayoutVoidError, voidPayout, voidPreview, type ClaimedPayout, type RecordedPayout, type VoidedPayout } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { ACCESS_JWT_HEADER } from "../src/platform/http/access-jwt.guard";
import { close, type Servers } from "../src/platform/http/servers";
import { STAFF_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import type { Actor } from "../src/platform/ports/audit.port";
import { apply, approved, cancelled, closeLedgers } from "./helpers/order-ledger";
import { addBank, addBonus, addClawback, addOrder, CLOCK, confirmClaim, MINH, openClaim, payoutLedger, TU, writeCounts } from "./helpers/payout-ledger";
import { accessJwt, ADMIN_HOST, deskServers, ORIGIN, PUBLIC_HOST } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

const LATER = fixedClock("2026-10-31T02:30:00.000Z");
const all = (ledger: Ledger, sql: string, ...args: unknown[]) => ledger.sqlite.prepare(sql).all(...args) as Record<string, unknown>[];
const FIXTURES = loadVoidFixtures().cases;
const fixture = (combination: number): VoidCase => FIXTURES.find((c) => c.combination === combination) ?? (() => { throw new Error(`no combination ${combination}`); })();

/** Builds the case's payout for customer C1 (the report rows' sub_id1) and returns it. */
function build(c: VoidCase): { ledger: Ledger; payout: RecordedPayout } {
  const ledger = payoutLedger();
  addBank(ledger, "C1");
  let claim: ClaimedPayout | null = null;
  const recorded: RecordedPayout[] = [];
  for (const s of c.steps) {
    if (s.step === "approve") apply(ledger, approved(s.orderId, [...s.parts]));
    else if (s.step === "bonus") addBonus(ledger, "C1", s.orderId, s.amount);
    else if (s.step === "clawback") addClawback(ledger, "C1", s.orderId, s.amount);
    else if (s.step === "cancel") apply(ledger, cancelled(s.orderId));
    else if (s.step === "claim") {
      const opened = openClaim(ledger, "C1");
      if (opened.kind !== "claimed") throw new Error(`claim refused: ${opened.kind}`);
      claim = opened;
    } else {
      if (claim === null) throw new Error("confirm before claim");
      const outcome = confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash);
      if (outcome.kind !== "recorded") throw new Error("confirm refused");
      recorded.push(outcome.payout);
    }
  }
  const payout = recorded[(c.voidPayout ?? recorded.length) - 1];
  if (payout === undefined) throw new Error("no payout");
  return { ledger, payout };
}

function voidIt(ledger: Ledger, payoutId: number, reason = "Ghi nham khach", actor: Actor = MINH): VoidedPayout {
  return ledger.tx((db) => {
    const by = commandAudit(db, LATER, actor);
    return voidPayout(db, { payoutId, reason }, { clock: LATER, by, outbox: outboxFor(db, LATER, by) });
  });
}

function outcomeOf(ledger: Ledger, c: VoidCase) {
  const orderIds = c.expected.orders.map((o) => o.orderId);
  const marks = orderIds.map(() => "?").join(",");
  return {
    orders: all(ledger, `SELECT order_id AS orderId, status, paid_at AS paidAt FROM orders WHERE order_id IN (${marks}) ORDER BY order_id`, ...orderIds),
    awards: all(ledger, "SELECT order_id AS orderId, status FROM campaign_awards ORDER BY award_id"),
    offsets: all(ledger, "SELECT clawback_id AS clawbackId, amount FROM ledger_entries WHERE kind = 'OFFSET' ORDER BY entry_id"),
    refunds: all(ledger, "SELECT clawback_id AS clawbackId, amount FROM ledger_entries WHERE kind = 'NETTING_REFUND' ORDER BY entry_id"),
    clawbackOpen: Object.fromEntries(Object.keys(c.expected.clawbackOpen).map((id) => [id, clawbackOpen(ledger.db, id)])),
    payable: getBalances(ledger.db, ["C1"])[0]?.payable,
  };
}

function runGolden(combination: number): { ledger: Ledger; payout: RecordedPayout; voided: VoidedPayout } {
  const c = fixture(combination);
  const { ledger, payout } = build(c);
  expect({ amount: payout.amount, netted: payout.netted }, c.name).toEqual(c.expected.payout);
  const voided = voidIt(ledger, payout.payoutId);
  const { payout: _payout, ...expected } = c.expected;
  expect(outcomeOf(ledger, c), c.name).toEqual(expected);
  return { ledger, payout, voided };
}

describe("Story 4.10 acceptance criteria", () => {
  it("AC1 (golden combination 1): orders that saw no cancel return to APPROVED with paid_at cleared, bonuses to CONFIRMED, and the payout shows VOIDED", () => {
    const { ledger, payout, voided } = runGolden(1);
    expect(voided).toMatchObject({ payoutId: payout.payoutId, customerId: "C1", amount: 55608, voidedAt: LATER.now(), offsets: 0, replay: false });
    expect(voided.orders.map((o) => o.to)).toEqual(["APPROVED", "APPROVED"]);
    expect(all(ledger, "SELECT status, voided_at, void_reason, voided_by FROM payouts")).toEqual([{ status: "VOIDED", voided_at: LATER.now(), void_reason: "Ghi nham khach", voided_by: "minh" }]);
    expect(all(ledger, "SELECT order_id, from_status, to_status, actor FROM order_status_history WHERE from_status = 'PAID' ORDER BY order_id")).toEqual([
      { order_id: "261001V1001", from_status: "PAID", to_status: "APPROVED", actor: "minh" },
      { order_id: "261001V1002", from_status: "PAID", to_status: "APPROVED", actor: "minh" },
    ]);
    const audit = all(ledger, "SELECT actor_id, reason, payload FROM audit_entries WHERE event = 'payouts.payout.voided'");
    expect(audit).toEqual([{ actor_id: "minh", reason: "Ghi nham khach", payload: JSON.stringify({ payoutId: payout.payoutId, customerId: "C1", amount: 55608, orders: 2, reversed: 0, offsets: 0, refunds: 0, told: true }) }]);
    // The orders are payable again, through a new claim (the old claim stays CONFIRMED).
    const again = openClaim(ledger, "C1", MINH, LATER);
    expect(again.kind === "claimed" && again.claim.amount).toBe(55608);
    expect(all(ledger, "SELECT status FROM payout_claims ORDER BY opened_at")).toEqual([{ status: "CONFIRMED" }, { status: "OPEN" }]);
  });

  it("AC2 (golden combination 2): a covered order whose latest observation is a cancel held back by the claim becomes REVERSED and its bonus VOID", () => {
    const { ledger, voided } = runGolden(2);
    expect(voided.orders).toEqual([
      { orderId: "261001V2001", to: "REVERSED" },
      { orderId: "261001V2002", to: "APPROVED" },
    ]);
    // The reversal is the void's, so the customer hears one correction, not an order message.
    expect(all(ledger, "SELECT dedup_key FROM outbox WHERE dedup_key LIKE 'order:%:reversed' OR dedup_key LIKE 'order:%:payout_voided'")).toEqual([]);
  });

  it("AC2 (golden combination 3): a clawback opened by a cancel after the payout is closed by an offsetting entry, its bonus VOID", () => {
    const { ledger, payout } = runGolden(3);
    expect(all(ledger, "SELECT kind, amount, payout_id, reason, created_by FROM ledger_entries WHERE clawback_id = '261001V3001-1' ORDER BY entry_id")).toEqual([
      { kind: "CLAWBACK", amount: -41365, payout_id: null, reason: "cancel_after_payout", created_by: "reconcile" },
      { kind: "OFFSET", amount: 41365, payout_id: payout.payoutId, reason: "payout_voided", created_by: "minh" },
    ]);
  });

  it("AC3 (golden combination 4): netting written by the payout is reversed by an offsetting entry and the open clawback returns to its prior amount", () => {
    const { ledger, payout } = runGolden(4);
    expect(all(ledger, "SELECT kind, amount, payout_id FROM ledger_entries WHERE clawback_id = '261001K4001-1' ORDER BY entry_id")).toEqual([
      { kind: "CLAWBACK", amount: -10000, payout_id: null },
      { kind: "NETTING", amount: 10000, payout_id: payout.payoutId },
      { kind: "OFFSET", amount: -10000, payout_id: payout.payoutId },
    ]);
    expect(getBalances(ledger.db, ["C1"])[0]).toMatchObject({ gross: 21365, deductedNext: 10000, payable: 11365 });
  });

  it("AC4: an employee or an admin without a reason is refused, by the command and over HTTP (403 or reason_required), and nothing is written", async () => {
    const { ledger, payout } = build(fixture(1));
    const before = writeCounts(ledger);
    expect(() => voidIt(ledger, payout.payoutId, "Ghi nham", TU)).toThrow(new PayoutVoidError("admin_only"));
    for (const blank of ["", "   "]) expect(() => voidIt(ledger, payout.payoutId, blank)).toThrow(new PayoutVoidError("reason_required"));
    servers = deskServers(ledger, CLOCK);
    const url = `/api/admin/payouts/${payout.payoutId}/void`;
    const employee = await post(servers, url, staffCookie(ledger, "tuan"), { reason: "Ghi nham" });
    expect([employee.statusCode, envelope(employee.body).code]).toEqual([403, "forbidden"]);
    for (const body of [{}, { reason: "" }, { reason: "  " }]) {
      const res = await post(servers, url, staffCookie(ledger, "minh"), body);
      expect([res.statusCode, envelope(res.body).messageKey]).toEqual([400, "error.payout.reason_required"]);
    }
    expect((await post(servers, url, staffCookie(ledger, "minh"), { reason: "x", orderIds: ["261001V1001"] })).statusCode).toBe(400);
    expect(writeCounts(ledger)).toEqual(before);
    expect(all(ledger, "SELECT status FROM payouts")).toEqual([{ status: "RECORDED" }]);
  });

  it("AC5: the void preview lists each order with the state it will return to, from the server, and void over HTTP answers what it did", async () => {
    const { ledger, payout } = build(fixture(3));
    servers = deskServers(ledger, CLOCK);
    const cookie = staffCookie(ledger, "minh");
    const url = `/api/admin/payouts/${payout.payoutId}/void`;
    const preview = payoutVoidPreviewSchema.parse((await get(servers, url, cookie)).json());
    expect(preview).toMatchObject({ payoutId: payout.payoutId, customerCode: "DP00001", amount: 55608, status: "RECORDED", nettingReversed: 0, clawbacksClosed: 41365, told: true });
    expect(preview.orders).toEqual([
      { orderId: "261001V3001", cashback: 21365, to: "REVERSED" },
      { orderId: "261001V3002", cashback: 14243, to: "APPROVED" },
    ]);
    expect(preview.awards).toEqual([{ awardId: 1, orderId: "261001V3001", amount: 20000, to: "VOID" }]);
    const res = await post(servers, url, cookie, { reason: "Chuyen nham" });
    expect(res.statusCode).toBe(200);
    expect(payoutVoidResponseSchema.parse(res.json())).toMatchObject({ payoutId: payout.payoutId, orders: [{ orderId: "261001V3001", to: "REVERSED" }, { orderId: "261001V3002", to: "APPROVED" }], offsets: 1, corrected: true, replay: false });
    const after = payoutVoidPreviewSchema.parse((await get(servers, url, cookie)).json());
    expect(after).toMatchObject({ status: "VOIDED", voidedAt: CLOCK.now() });
    // The receipt the customer already has now says the payout was voided.
    const receipt = await servers.publicApp.inject({ method: "GET", url: "/b/rcpt_test_token_0001", headers: { host: PUBLIC_HOST } });
    expect(receipt.body).toContain('data-receipt="voided"');
  });

  it("AC6: a customer already told about the payout gets one correction message keyed payout:<id>:voided; a repeated void writes nothing", () => {
    const { ledger, payout } = build(fixture(1));
    voidIt(ledger, payout.payoutId);
    const key = `payout:${payout.payoutId}:voided`;
    expect(all(ledger, "SELECT dedup_key, customer_id, message_key, params FROM outbox WHERE dedup_key LIKE 'payout:%' ORDER BY dedup_key")).toEqual([
      { dedup_key: `payout:${payout.payoutId}:recorded`, customer_id: "C1", message_key: "payout_recorded", params: expect.any(String) },
      { dedup_key: key, customer_id: "C1", message_key: "payout_voided", params: JSON.stringify({ payoutId: payout.payoutId, amount: 55608 }) },
    ]);
    const before = writeCounts(ledger);
    const again = voidIt(ledger, payout.payoutId, "lan hai", MINH);
    expect(again).toMatchObject({ payoutId: payout.payoutId, replay: true, corrected: true, voidedAt: LATER.now() });
    expect(writeCounts(ledger)).toEqual(before);
    expect(all(ledger, "SELECT void_reason FROM payouts")).toEqual([{ void_reason: "Ghi nham khach" }]);
  });

  it("AC6: a customer never told (a netting-only payout, an imported payout the live system never announced) gets no correction message", () => {
    const ledger = payoutLedger();
    addBank(ledger, "C1");
    addClawback(ledger, "C1", "261001K6001", 50000);
    apply(ledger, approved("261001V6001", [30000]));
    const claim = openClaim(ledger, "C1");
    if (claim.kind !== "claimed") throw new Error("expected a claim");
    const netting = confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash);
    if (netting.kind !== "recorded") throw new Error("expected a payout");
    expect(netting.payout.nettingOnly).toBe(true);
    expect(voidIt(ledger, netting.payout.payoutId).corrected).toBe(false);
    expect(clawbackOpen(ledger.db, "261001K6001-1")).toBe(-50000);
    addOrder(ledger, { id: "260901L0001", customer: "C2", status: "PAID", cashback: 42000 });
    // An imported payout, as the cutover writes it (origin CUTOVER, no claim), that was never announced.
    ledger.sqlite.prepare("INSERT INTO payouts (payout_id, customer_id, status, transfer_amount, receipt_token, bank_last_four, recorded_at, origin) VALUES (900, 'C2', 'RECORDED', 42000, 'q3Xv9TzM0bW1sKp7Yc2RfH8nLd4GjA6e', '7788', '2026-09-12T03:00:00.000Z', 'CUTOVER')").run();
    ledger.sqlite.prepare("INSERT INTO payout_items (payout_id, line_no, kind, order_id, amount) VALUES (900, 1, 'ORDER', '260901L0001', 42000)").run();
    expect(voidIt(ledger, 900)).toMatchObject({ corrected: false, orders: [{ orderId: "260901L0001", to: "APPROVED" }] });
    expect(all(ledger, "SELECT dedup_key FROM outbox WHERE dedup_key LIKE '%:voided'")).toEqual([]);
  });
});

describe("Sprint 16 code review", () => {
  it("review 1 (golden combination 5): a clawback a later payout already netted is closed and the netted part credited back, shown in the preview and paid by the next payout", () => {
    const c = fixture(5);
    const { ledger, payout } = build(c);
    const preview = ledger.tx((db) => voidPreview(db, payout.payoutId, { told: () => true }));
    expect(preview).toMatchObject({ clawbacksClosed: 7122, refunded: 14243, nettingReversed: 0 });
    const voided = voidIt(ledger, payout.payoutId);
    expect(voided.offsets).toBe(2);
    const { payout: _p, ...expected } = c.expected;
    expect(outcomeOf(ledger, c)).toEqual(expected);
    expect(all(ledger, "SELECT kind, amount, payout_id, reason FROM ledger_entries WHERE kind = 'NETTING_REFUND'")).toEqual([{ kind: "NETTING_REFUND", amount: 14243, payout_id: payout.payoutId, reason: "payout_voided" }]);
    // The credit is paid with the next payout, as a REFUND_PAID entry of that payout.
    const next = openClaim(ledger, "C1", MINH, LATER);
    if (next.kind !== "claimed") throw new Error("expected a claim");
    expect(next.snapshot.refunds).toEqual([{ clawbackId: "261001V5001-1", customerId: "C1", orderId: "261001V5001", amount: 14243 }]);
    expect(next.claim.amount).toBe(14243);
    const paid = confirmClaim(ledger, next.claim.claimId, next.snapshot.hash, MINH, LATER, { newReceiptToken: () => "rcpt_test_token_0002" });
    if (paid.kind !== "recorded") throw new Error("expected a payout");
    expect(paid.payout.amount).toBe(14243);
    expect(all(ledger, "SELECT kind, amount, payout_id FROM ledger_entries WHERE kind = 'REFUND_PAID'")).toEqual([{ kind: "REFUND_PAID", amount: -14243, payout_id: paid.payout.payoutId }]);
    expect(getBalances(ledger.db, ["C1"])[0]).toMatchObject({ gross: 0, payable: 0, deductedNext: 0 });
    // Voiding that payout gives the credit back again, and nothing else moves.
    expect(voidIt(ledger, paid.payout.payoutId).offsets).toBe(1);
    expect(getBalances(ledger.db, ["C1"])[0]).toMatchObject({ gross: 14243, payable: 14243, deductedNext: 0 });
    expect(clawbackOpen(ledger.db, "261001V5001-1")).toBe(0);
  });

  it("review 2: an imported payout whose order has no network (imported, never in a report) is voided back to APPROVED", () => {
    const ledger = payoutLedger();
    ledger.sqlite.prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, approved_at, paid_at, origin) VALUES ('260901N0001', NULL, 'lazada', 'C2', 'PAID', 50000, 35000, '2026-09-01T03:00:00.000Z', '2026-09-12T03:00:00.000Z', 'CUTOVER')").run();
    ledger.sqlite.prepare("INSERT INTO payouts (payout_id, customer_id, status, transfer_amount, receipt_token, bank_last_four, recorded_at, origin) VALUES (77, 'C2', 'RECORDED', 35000, 'imported_token_000000000000001', '7788', '2026-09-12T03:00:00.000Z', 'CUTOVER')").run();
    ledger.sqlite.prepare("INSERT INTO payout_items (payout_id, line_no, kind, order_id, amount) VALUES (77, 1, 'ORDER', '260901N0001', 35000)").run();
    expect(voidIt(ledger, 77)).toMatchObject({ orders: [{ orderId: "260901N0001", to: "APPROVED" }], replay: false });
    expect(all(ledger, "SELECT status, paid_at FROM orders WHERE order_id = '260901N0001'")).toEqual([{ status: "APPROVED", paid_at: null }]);
  });

  it("review 9: the preview is the plan the void applies, so its order states, awards and amounts equal what the void writes", () => {
    for (const combination of [1, 2, 3, 4, 5]) {
      const { ledger, payout } = build(fixture(combination));
      const preview = ledger.tx((db) => voidPreview(db, payout.payoutId, outboxFor(db, LATER, commandAudit(db, LATER, MINH))));
      const voided = voidIt(ledger, payout.payoutId);
      expect(voided.orders, `combination ${combination}`).toEqual(preview?.orders.map((o) => ({ orderId: o.orderId, to: o.to })));
      expect(all(ledger, "SELECT status FROM campaign_awards ORDER BY award_id").map((a) => a["status"]), `combination ${combination}`).toEqual(preview?.awards.map((a) => a.to));
      const written = all(ledger, "SELECT kind, amount FROM ledger_entries WHERE payout_id = ? AND kind IN ('OFFSET', 'NETTING_REFUND')", payout.payoutId) as { kind: string; amount: number }[];
      const sum = (kind: string, sign: number) => written.filter((e) => e.kind === kind && Math.sign(e.amount) === sign).reduce((t, e) => t + Math.abs(e.amount), 0);
      expect({ nettingReversed: sum("OFFSET", -1), clawbacksClosed: sum("OFFSET", 1), refunded: sum("NETTING_REFUND", 1) }, `combination ${combination}`).toEqual({ nettingReversed: preview?.nettingReversed, clawbacksClosed: preview?.clawbacksClosed, refunded: preview?.refunded });
      closeLedgers();
    }
  });
});

describe("payout void rules (D4, D41, AD-17)", () => {
  it("the void is one transaction: a covered order that is no longer PAID rolls back every write", () => {
    const { ledger, payout } = build(fixture(1));
    ledger.sqlite.prepare("UPDATE orders SET status = 'APPROVED', paid_at = NULL WHERE order_id = '261001V1002'").run();
    const before = { ...writeCounts(ledger), awards: all(ledger, "SELECT status FROM campaign_awards"), orders: all(ledger, "SELECT order_id, status FROM orders ORDER BY order_id") };
    expect(() => voidIt(ledger, payout.payoutId)).toThrow();
    expect({ ...writeCounts(ledger), awards: all(ledger, "SELECT status FROM campaign_awards"), orders: all(ledger, "SELECT order_id, status FROM orders ORDER BY order_id") }).toEqual(before);
    expect(all(ledger, "SELECT status FROM payouts")).toEqual([{ status: "RECORDED" }]);
  });

  it("a voided payout never changes back, and its amount, customer and receipt token never change", () => {
    const { ledger, payout } = build(fixture(1));
    voidIt(ledger, payout.payoutId);
    for (const sql of ["UPDATE payouts SET status = 'RECORDED'", "UPDATE payouts SET transfer_amount = 1", "UPDATE payouts SET receipt_token = 'other_token_0000000000'", "UPDATE payouts SET void_reason = 'changed'"]) {
      expect(() => ledger.sqlite.prepare(sql).run(), sql).toThrow(/payouts:/);
    }
  });

  it("a payout that does not exist is not found", () => {
    const ledger = payoutLedger();
    expect(() => voidIt(ledger, 4242)).toThrow(new PayoutVoidError("payout_not_found"));
  });
});

function staffCookie(ledger: Ledger, staffId: string): string {
  return `${STAFF_SESSION_COOKIE}=${ledger.tx((db) => openSession(db, { kind: "STAFF", staffId }, CLOCK, STAFF_SESSION_MS)).token}`;
}

function post(s: Servers, url: string, cookie: string, body: unknown) {
  return s.publicApp.inject({ method: "POST", url, headers: { host: ADMIN_HOST, origin: ORIGIN, cookie, [ACCESS_JWT_HEADER]: accessJwt(CLOCK) }, payload: body as object });
}

function get(s: Servers, url: string, cookie: string) {
  return s.publicApp.inject({ method: "GET", url, headers: { host: ADMIN_HOST, cookie, [ACCESS_JWT_HEADER]: accessJwt(CLOCK) } });
}

const envelope = (body: string) => errorEnvelopeSchema.parse(JSON.parse(body)).error;
