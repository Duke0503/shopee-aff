/**
 * Story 3.9: staff apply or dismiss a review case with a reason, through the rules reconciliation
 * uses (attribution with a rule candidate, `transition` with the review context). Apply never
 * changes a PAID order, never attributes a guest order to a customer, never chooses another
 * customer and never takes an amount; a preview writes nothing.
 */
import type { Clock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { applyReviewCase, dismissReviewCase, previewReviewApply, reportWrongRejection, type ReviewApplyInput } from "../src/modules/orders/index";
import type { Ledger, LedgerDb } from "../src/platform/db/ledger";
import type { Actor } from "../src/platform/ports/audit.port";
import { applyDepsFor, reviewReadDepsFor } from "../src/reconcile/apply-deps";
import { apply, approved, awaiting, cancelled, closeLedgers, freshLedger, HOUR, movingClock, reportRow } from "./helpers/order-ledger";

afterEach(closeLedgers);

const STAFF: Actor = { kind: "staff", id: "staff-anh", role: "EMPLOYEE" };
const TABLES = ["orders", "order_items", "order_status_history", "order_observations", "review_cases", "audit_entries", "outbox", "campaign_awards", "ledger_entries"];

const all = (ledger: Ledger, sql: string, ...args: unknown[]) => ledger.sqlite.prepare(sql).all(...args) as Record<string, unknown>[];
const one = (ledger: Ledger, sql: string, ...args: unknown[]) => ledger.sqlite.prepare(sql).get(...args) as Record<string, unknown>;
const snapshot = (ledger: Ledger) => Object.fromEntries(TABLES.map((t) => [t, all(ledger, `SELECT * FROM ${t}`)]));
const caseId = (ledger: Ledger, reason: string): number => one(ledger, "SELECT case_id FROM review_cases WHERE reason = ? AND status = 'OPEN'", reason).case_id as number;

const staffDeps = (db: LedgerDb, clock: Clock, actor: Actor = STAFF) => applyDepsFor(db, clock, { production: true, actor });

function applyCase(ledger: Ledger, input: ReviewApplyInput, clock: Clock, actor: Actor = STAFF) {
  return ledger.tx((db) => applyReviewCase(db, input, staffDeps(db, clock, actor)));
}

function previewCase(ledger: Ledger, input: ReviewApplyInput, clock: Clock) {
  // A preview only reads: a plain handle and read-only ports, no transaction (Story 4.2 review item 10).
  return previewReviewApply(ledger.db, input, reviewReadDepsFor(ledger.db, clock, STAFF, true));
}

function dismissCase(ledger: Ledger, input: { caseId: number; reason: string }, clock: Clock) {
  return ledger.tx((db) => dismissReviewCase(db, input, applyDepsFor(db, clock, { production: true, actor: STAFF })));
}

function importedOrder(ledger: Ledger, orderId: string, status: string, customer = "C1"): void {
  ledger.sqlite.prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, rejection_reason, origin) VALUES (?, 'shopee', 'shopee', ?, ?, ?, 'CUTOVER')").run(orderId, customer, status, status === "REJECTED" ? "order_cancelled" : null);
}

function paidOrder(ledger: Ledger, id: string): void {
  ledger.sqlite
    .prepare(
      "INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, approved_at, paid_at, origin) VALUES (?, 'shopee', 'shopee', 'C1', 'PAID', 100000, 71216, '2026-09-10T03:00:00.000Z', '2026-10-05T03:00:00.000Z', 'CUTOVER')",
    )
    .run(id);
}

/** A REJECTED order whose latest report row is `row`, with a staff-reported wrong rejection case. */
function wronglyRejected(ledger: Ledger, orderId: string, row: ReturnType<typeof awaiting>, clock: Clock): number {
  importedOrder(ledger, orderId, "REJECTED");
  apply(ledger, row, clock);
  return ledger.tx((db) => reportWrongRejection(db, { orderId, reason: "customer shows the order delivered" }, staffDeps(db, clock))).caseId;
}

describe("Story 3.9 acceptance criteria", () => {
  it("AC1: an OPEN no-customer-found case with a rule candidate, applied with a reason, attributes the order to that candidate in AWAITING_APPROVAL and resolves the case as applied with staff, time and reason", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    apply(ledger, awaiting("261020NOCU0001", [20000], { subIds: ["NOBODY", "REQ1", "", "", ""] }), clock);
    const id = caseId(ledger, "unattributed_sub_id1");
    clock.advance(HOUR);
    expect(applyCase(ledger, { caseId: id, reason: "sub_id1 typo, link REQ1 is C1's" }, clock)).toEqual({ caseId: id, orderId: "261020NOCU0001", resolution: "APPLIED" });
    expect(one(ledger, "SELECT customer_id, request_id, status FROM orders")).toEqual({ customer_id: "C1", request_id: "REQ1", status: "AWAITING_APPROVAL" });
    expect(one(ledger, "SELECT status, resolution, resolved_by, resolved_at, resolution_reason, order_id FROM review_cases WHERE case_id = ?", id)).toEqual({
      status: "RESOLVED",
      resolution: "APPLIED",
      resolved_by: "staff-anh",
      resolved_at: clock.now(),
      resolution_reason: "sub_id1 typo, link REQ1 is C1's",
      order_id: "261020NOCU0001",
    });
    expect(all(ledger, "SELECT actor, to_status FROM order_status_history")).toEqual([{ actor: "staff-anh", to_status: "AWAITING_APPROVAL" }]);
    expect(all(ledger, "SELECT event, actor_id FROM audit_entries WHERE actor_id = 'staff-anh' ORDER BY id").map((r) => r.event)).toEqual(["orders.order.recorded", "messaging.outbox.enqueued", "orders.review_case.applied"]);
  });

  it("AC1: an approved row applied from its case lands in the state the report gives, with its cashback stored", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020NOCU0002", [100000], { subIds: ["", "", "", "", ""] }));
    ledger.sqlite.exec("UPDATE review_cases SET candidates = '[\"C2\"]'");
    applyCase(ledger, { caseId: caseId(ledger, "unattributed"), reason: "C2 sent the order screenshot" }, movingClock("2026-10-30T08:00:00.000Z"));
    expect(one(ledger, "SELECT customer_id, status, approved_commission, cashback FROM orders")).toEqual({ customer_id: "C2", status: "APPROVED", approved_commission: 100000, cashback: 71216 });
  });

  it("AC2: a case on a PAID order is refused with order_paid and nothing changes", () => {
    const ledger = freshLedger();
    paidOrder(ledger, "260910PAIDREV1");
    apply(ledger, reportRow("260910PAIDREV1", "UNKNOWN", [{ status: "APPROVED", parts: [100000] }]));
    const before = snapshot(ledger);
    const id = caseId(ledger, "unknown_status");
    expect(() => applyCase(ledger, { caseId: id, reason: "looks fine" }, movingClock("2026-10-30T08:00:00.000Z"))).toThrow(expect.objectContaining({ code: "order_paid" }));
    expect(() => previewCase(ledger, { caseId: id, reason: "x" }, movingClock("2026-10-30T08:00:00.000Z"))).toThrow(expect.objectContaining({ code: "order_paid" }));
    expect(snapshot(ledger)).toEqual(before);
  });

  it("AC3: applying a guest order to a customer is refused with guest_order, recorded or not", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T08:00:00.000Z");
    apply(ledger, awaiting("261020GUES0001", [20000], { subIds: ["HOUSE", "REQH", "", "", ""] }));
    apply(ledger, reportRow("261020GUES0001", "UNKNOWN", [{ status: "AWAITING", parts: [20000] }]));
    expect(() => applyCase(ledger, { caseId: caseId(ledger, "unknown_status"), reason: "it was C1", customerId: "C1" }, clock)).toThrow(expect.objectContaining({ code: "guest_order" }));

    apply(ledger, awaiting("261020GUES0002", [20000], { subIds: ["NOBODY", "REQH", "", "", ""] }));
    const before = snapshot(ledger);
    expect(() => applyCase(ledger, { caseId: caseId(ledger, "unattributed_sub_id1"), reason: "it was C1", customerId: "C1" }, clock)).toThrow(expect.objectContaining({ code: "guest_order" }));
    expect(snapshot(ledger)).toEqual(before);
  });

  it("AC4: a REJECTED order whose latest observation shows no cancel signal returns to AWAITING_APPROVAL; with a cancel signal the command refuses", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    const id = wronglyRejected(ledger, "261020WRRJ0001", awaiting("261020WRRJ0001"), clock);
    clock.advance(HOUR);
    applyCase(ledger, { caseId: id, reason: "rejected on UNPAID by the old system" }, clock);
    expect(one(ledger, "SELECT status, rejection_reason FROM orders WHERE order_id = '261020WRRJ0001'")).toEqual({ status: "AWAITING_APPROVAL", rejection_reason: null });
    expect(all(ledger, "SELECT from_status, to_status, actor, reason FROM order_status_history WHERE order_id = '261020WRRJ0001'")).toEqual([
      { from_status: "REJECTED", to_status: "AWAITING_APPROVAL", actor: "staff-anh", reason: "rejected on UNPAID by the old system" },
    ]);
    expect(all(ledger, "SELECT dedup_key FROM outbox WHERE dedup_key LIKE 'order:261020WRRJ0001%'")).toEqual([{ dedup_key: "order:261020WRRJ0001@1:reopened" }]);

    const cancelledId = wronglyRejected(ledger, "261020WRRJ0002", cancelled("261020WRRJ0002"), clock);
    const before = snapshot(ledger);
    expect(() => applyCase(ledger, { caseId: cancelledId, reason: "customer says delivered" }, clock)).toThrow(expect.objectContaining({ code: "cancel_signal_seen" }));
    expect(snapshot(ledger)).toEqual(before);
  });

  it("AC5: dismissing without a reason is refused; with a reason the case is RESOLVED dismissed and the order is unchanged", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T08:00:00.000Z");
    apply(ledger, approved("261020DISM0001"));
    apply(ledger, reportRow("261020DISM0001", "UNKNOWN", [{ status: "APPROVED", parts: [20000] }]));
    const id = caseId(ledger, "unknown_status");
    const orderBefore = all(ledger, "SELECT * FROM orders");
    expect(() => dismissCase(ledger, { caseId: id, reason: "  " }, clock)).toThrow(expect.objectContaining({ code: "reason_missing" }));
    expect(one(ledger, "SELECT status FROM review_cases WHERE case_id = ?", id).status).toBe("OPEN");
    expect(dismissCase(ledger, { caseId: id, reason: "network glitch, next run will tell" }, clock)).toEqual({ caseId: id, orderId: "261020DISM0001", resolution: "DISMISSED" });
    expect(one(ledger, "SELECT status, resolution, resolved_by, resolution_reason FROM review_cases WHERE case_id = ?", id)).toEqual({
      status: "RESOLVED",
      resolution: "DISMISSED",
      resolved_by: "staff-anh",
      resolution_reason: "network glitch, next run will tell",
    });
    expect(all(ledger, "SELECT * FROM orders")).toEqual(orderBefore);
    expect(all(ledger, "SELECT event FROM audit_entries WHERE actor_id = 'staff-anh'")).toEqual([{ event: "orders.review_case.dismissed" }]);
  });

  it("AC6: a preview before apply returns the resulting order state and writes nothing", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T08:00:00.000Z");
    apply(ledger, approved("261020PREV0001", [100000], { subIds: ["NOBODY", "REQ1", "", "", ""] }));
    const id = caseId(ledger, "unattributed_sub_id1");
    const before = snapshot(ledger);
    const preview = previewCase(ledger, { caseId: id, reason: "link REQ1 is C1's" }, clock);
    expect(preview).toEqual({ caseId: id, orderId: "261020PREV0001", customerId: "C1", from: null, to: "APPROVED", cashback: 71216 });
    expect(snapshot(ledger)).toEqual(before);
    applyCase(ledger, { caseId: id, reason: "link REQ1 is C1's" }, clock);
    expect(one(ledger, "SELECT customer_id, status, cashback FROM orders")).toEqual({ customer_id: preview.customerId, status: preview.to, cashback: preview.cashback });
  });
});

describe("Story 3.9: apply never chooses for staff", () => {
  it("refuses a customer who is not a candidate, asks for one when there are several, and refuses anyone but staff", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T08:00:00.000Z");
    apply(ledger, awaiting("261020DISA0001", [20000], { subIds: ["C2", "REQ1", "", "", ""] }));
    const id = caseId(ledger, "owner_disagreement");
    expect(() => applyCase(ledger, { caseId: id, reason: "x" }, clock)).toThrow(expect.objectContaining({ code: "candidate_required" }));
    expect(() => applyCase(ledger, { caseId: id, reason: "x", customerId: "CE" }, clock)).toThrow(expect.objectContaining({ code: "not_a_candidate" }));
    expect(() => applyCase(ledger, { caseId: id, reason: "x", customerId: "C2" }, clock, { kind: "system", id: "reconcile" })).toThrow(expect.objectContaining({ code: "staff_only" }));
    expect(() => applyCase(ledger, { caseId: id, reason: "", customerId: "C2" }, clock)).toThrow(expect.objectContaining({ code: "reason_missing" }));
    applyCase(ledger, { caseId: id, reason: "C2 bought it with C1's link", customerId: "C2" }, clock);
    expect(one(ledger, "SELECT customer_id, request_id FROM orders")).toEqual({ customer_id: "C2", request_id: null });
    expect(() => applyCase(ledger, { caseId: id, reason: "again", customerId: "C2" }, clock)).toThrow(expect.objectContaining({ code: "case_resolved" }));
  });

  it("a recorded order keeps its customer: naming another one is refused", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020KEEP0001"));
    apply(ledger, reportRow("261020KEEP0001", "UNKNOWN", [{ status: "APPROVED", parts: [20000] }]));
    expect(() => applyCase(ledger, { caseId: caseId(ledger, "unknown_status"), reason: "x", customerId: "C2" }, movingClock("2026-10-30T08:00:00.000Z"))).toThrow(expect.objectContaining({ code: "not_a_candidate" }));
  });

  it("a FROZEN order is restored to the state it was frozen from, or rejected, through transition", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T08:00:00.000Z");
    apply(ledger, approved("261020FROZ0001", [100000]));
    apply(ledger, reportRow("261020FROZ0001", "UNKNOWN", [{ status: "APPROVED", parts: [100000] }]));
    applyCase(ledger, { caseId: caseId(ledger, "unknown_status"), reason: "status is approved in the dashboard" }, clock);
    expect(one(ledger, "SELECT status, cashback FROM orders")).toEqual({ status: "APPROVED", cashback: 71216 });

    apply(ledger, approved("261020FROZ0002"));
    apply(ledger, reportRow("261020FROZ0002", "UNKNOWN", [{ status: "APPROVED", parts: [20000] }]));
    applyCase(ledger, { caseId: caseId(ledger, "unknown_status"), reason: "fraud confirmed by the network", outcome: "reject" }, clock);
    expect(one(ledger, "SELECT status, rejection_reason FROM orders WHERE order_id = '261020FROZ0002'")).toEqual({ status: "REJECTED", rejection_reason: "not_eligible" });
  });

  it("a case with nothing to change is refused: dismiss it instead", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020REVS0001"));
    apply(ledger, cancelled("261020REVS0001"));
    expect(() => applyCase(ledger, { caseId: caseId(ledger, "cancel_after_approval"), reason: "x" }, movingClock("2026-10-30T08:00:00.000Z"))).toThrow(expect.objectContaining({ code: "review_not_applicable" }));
  });
});

describe("Story 3.9 code review: apply writes the plan through reconciliation's path", () => {
  it("a restore to APPROVED of an order with no approval time stamps approvedAt and its settlement period", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T08:00:00.000Z");
    ledger.sqlite.exec(`
      INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, origin) VALUES ('261020NOAP0001', 'shopee', 'shopee', 'C1', 'FROZEN', 100000, 71216, 'CUTOVER');
      INSERT INTO order_status_history (order_id, from_status, to_status, actor, reason, changed_at) VALUES ('261020NOAP0001', 'APPROVED', 'FROZEN', 'cutover', 'unknown_status', '2026-10-01T00:00:00.000Z');
      INSERT INTO review_cases (network, subject, order_id, reason, status, candidates, observation, opened_at, opened_by) VALUES ('shopee', '261020NOAP0001', '261020NOAP0001', 'unknown_status', 'OPEN', '["C1"]', '{}', '2026-10-01T00:00:00.000Z', 'cutover');`);
    apply(ledger, approved("261020NOAP0001", [100000]), clock);
    applyCase(ledger, { caseId: caseId(ledger, "unknown_status"), reason: "approved in the network dashboard" }, clock);
    expect(one(ledger, "SELECT status, approved_at, settlement_period, cashback FROM orders")).toEqual({ status: "APPROVED", approved_at: clock.now(), settlement_period: "2026-10", cashback: 71216 });
  });

  it("a review rejection carries out every effect transition gives: the rejection is recorded and the awards are voided", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T08:00:00.000Z");
    apply(ledger, approved("261020EFFX0001"));
    ledger.sqlite.exec("INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, origin) VALUES ('CAMP1', 'C1', '261020EFFX0001', 20000, 'CONFIRMED', 'RULE')");
    apply(ledger, reportRow("261020EFFX0001", "UNKNOWN", [{ status: "APPROVED", parts: [20000] }]));
    applyCase(ledger, { caseId: caseId(ledger, "unknown_status"), reason: "fraud", outcome: "reject" }, clock);
    expect(one(ledger, "SELECT status, rejection_reason FROM orders")).toEqual({ status: "REJECTED", rejection_reason: "not_eligible" });
    expect(all(ledger, "SELECT status FROM campaign_awards")).toEqual([{ status: "VOID" }]);
    expect(all(ledger, "SELECT to_status, actor, reason FROM order_status_history WHERE to_status = 'REJECTED'")).toEqual([{ to_status: "REJECTED", actor: "staff-anh", reason: "fraud" }]);
    expect(all(ledger, "SELECT count(*) AS n FROM order_observations")).toEqual([{ n: 2 }]);
  });

  it("apply writes exactly the previewed cashback in a period marked not withheld", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T08:00:00.000Z");
    ledger.sqlite.exec("INSERT INTO settlement_periods (network, period_month, withheld, origin) VALUES ('shopee', '2026-10', 0, 'STAFF')");
    apply(ledger, approved("261020NOWH0001", [100000], { subIds: ["NOBODY", "REQ1", "", "", ""] }), clock);
    const input = { caseId: caseId(ledger, "unattributed_sub_id1"), reason: "link REQ1 is C1's" };
    const preview = previewCase(ledger, input, clock);
    expect(preview.cashback).toBe(79216);
    applyCase(ledger, input, clock);
    expect(one(ledger, "SELECT status, cashback, cashback_withheld FROM orders")).toEqual({ status: preview.to, cashback: preview.cashback, cashback_withheld: 0 });
  });

  it("reporting a wrong rejection of an order no report has shown is refused with no_observation", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T08:00:00.000Z");
    importedOrder(ledger, "261020NOOB0001", "REJECTED");
    expect(() => ledger.tx((db) => reportWrongRejection(db, { orderId: "261020NOOB0001", reason: "customer says delivered" }, staffDeps(db, clock)))).toThrow(expect.objectContaining({ code: "no_observation" }));
    expect(all(ledger, "SELECT * FROM review_cases")).toEqual([]);
  });
});
