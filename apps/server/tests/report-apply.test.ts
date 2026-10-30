/**
 * Stories 3.3 and 3.4: one report row applied to one order in one transaction (attribution,
 * `transition`, observation, history, audit, outbox, review cases, clawback entries and award
 * moves), the fingerprint skip, D4 held by the code and by the database triggers, D39, D55, D58,
 * and cashback stored at approval with the settlement period's withheld setting (D54). The golden
 * part runs packages/golden/fixtures/orders/report-apply.json against a migrated ledger.
 */
import { loadReportApplyFixtures, type RepeatRow } from "@cashback/golden/report-apply";
import { afterEach, describe, expect, it } from "vitest";

import { commandAudit } from "../src/modules/operations/index";
import { orderAwardsFor } from "../src/modules/campaigns/index";
import { outboxFor } from "../src/modules/messaging/index";
import { markOrderPaid, markSettlementPeriod, SettlementPeriodError, type OrderRecorded } from "../src/modules/orders/index";
import type { Ledger } from "../src/platform/db/ledger";
import { TEST_ACTOR, TEST_CLOCK } from "./helpers/live-fixture";
import { apply, approved, awaiting, cancelled, closeLedgers, freshLedger, HOUR, movingClock, reportRow, type Override } from "./helpers/order-ledger";

afterEach(closeLedgers);

const all = (ledger: Ledger, sql: string, ...args: unknown[]) => ledger.sqlite.prepare(sql).all(...args) as Record<string, unknown>[];
const one = (ledger: Ledger, sql: string, ...args: unknown[]) => ledger.sqlite.prepare(sql).get(...args) as Record<string, unknown> | undefined;
const count = (ledger: Ledger, table: string) => (one(ledger, `SELECT count(*) AS n FROM ${table}`) as { n: number }).n;
const orderOf = (ledger: Ledger, id: string) => one(ledger, "SELECT * FROM orders WHERE order_id = ?", id) as Record<string, unknown>;

const TABLES = ["orders", "order_items", "order_observations", "order_status_history", "review_cases", "audit_entries", "outbox", "alerts", "ledger_entries", "campaign_awards", "settlement_periods"];

/** Every row of every table apply writes, with each order's last-seen time left out. */
function snapshot(ledger: Ledger): Record<string, unknown[]> {
  return Object.fromEntries(TABLES.map((t) => [t, all(ledger, `SELECT * FROM ${t} ORDER BY rowid`).map((r) => (t === "orders" ? { ...r, last_seen_in_report_at: null } : r))]));
}

/** An order as the cutover imports it: stored amounts, one placeholder item, one history row. */
function importOrder(ledger: Ledger, o: { id: string; status: string; approved: number | null; cashback: number | null; paidAt?: string | null; customer?: string; network?: string | null }): void {
  ledger.sqlite
    .prepare(
      `INSERT INTO orders (order_id, network, platform, customer_id, status, order_value, estimated_commission, approved_commission, cashback, approved_at, paid_at, origin)
       VALUES (?, ?, 'shopee', ?, ?, 100000, ?, ?, ?, '2026-09-10T03:00:00.000Z', ?, 'CUTOVER')`,
    )
    .run(o.id, o.network === undefined ? "shopee" : o.network, o.customer ?? "C1", o.status, o.approved, o.approved, o.cashback, o.paidAt ?? null);
  ledger.sqlite.prepare("INSERT INTO order_items (order_id, line_no, price, estimated_commission, approved_commission, origin) VALUES (?, 1, 100000, ?, ?, 'CUTOVER')").run(o.id, o.approved, o.approved);
  ledger.sqlite.prepare("INSERT INTO order_status_history (order_id, to_status, actor, changed_at) VALUES (?, ?, 'cutover', '2026-10-01T00:00:00.000Z')").run(o.id, o.status);
}

const award = (ledger: Ledger, orderId: string, status: string, amount = 20000) =>
  ledger.sqlite.prepare("INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, origin) VALUES ('CAMP1', 'C1', ?, ?, ?, 'RULE')").run(orderId, amount, status);

describe("Story 3.3 acceptance criteria", () => {
  it("AC1: a new attributed row records the order AWAITING_APPROVAL with its items, an observation, a history row, an audit entry and one outbox row, in one transaction", () => {
    const ledger = freshLedger();
    const recorded: OrderRecorded[] = [];
    const row = reportRow("261020AAAA0001", "AWAITING", [
      { status: "AWAITING", parts: [6000, 1000], value: 150000 },
      { status: "AWAITING", parts: [2000], value: 50000 },
    ]);
    const report = apply(ledger, row, TEST_CLOCK, () => ({ events: { recorded: (e) => void recorded.push(e) } }));
    expect(report).toEqual({ outcome: "recorded", orderId: "261020AAAA0001", steps: [[null, "AWAITING_APPROVAL"]], reviewCases: [] });
    expect(orderOf(ledger, "261020AAAA0001")).toMatchObject({
      status: "AWAITING_APPROVAL",
      network: "shopee",
      platform: "shopee",
      customer_id: "C1",
      request_id: "REQ1",
      estimated_commission: 9000,
      order_value: 200000,
      cashback: null,
      recorded_at: "2026-10-20T03:00:00.000Z",
      last_seen_in_report_at: TEST_CLOCK.now(),
      origin: "REPORT",
    });
    expect(all(ledger, "SELECT line_no, item_id, price, estimated_commission, approved_commission, network_status, origin FROM order_items ORDER BY line_no")).toEqual([
      { line_no: 1, item_id: "I1", price: 150000, estimated_commission: 7000, approved_commission: null, network_status: "AWAITING", origin: "REPORT" },
      { line_no: 2, item_id: "I2", price: 50000, estimated_commission: 2000, approved_commission: null, network_status: "AWAITING", origin: "REPORT" },
    ]);
    expect(all(ledger, "SELECT fingerprint, applied, observed_at FROM order_observations")).toEqual([{ fingerprint: row.fingerprint, applied: 1, observed_at: TEST_CLOCK.now() }]);
    expect(all(ledger, "SELECT from_status, to_status, actor FROM order_status_history")).toEqual([{ from_status: null, to_status: "AWAITING_APPROVAL", actor: "reconcile" }]);
    expect(all(ledger, "SELECT actor_kind, actor_id, event, entity_id FROM audit_entries WHERE event LIKE 'orders.%'")).toEqual([{ actor_kind: "system", actor_id: "reconcile", event: "orders.order.recorded", entity_id: "261020AAAA0001" }]);
    expect(all(ledger, "SELECT dedup_key, customer_id, message_key FROM outbox")).toEqual([{ dedup_key: "order:261020AAAA0001:recorded", customer_id: "C1", message_key: "order_recorded" }]);
    expect(recorded).toEqual([{ orderId: "261020AAAA0001", network: "shopee", customerId: "C1", requestId: "REQ1" }]);
  });

  it("AC1: when any part of the apply fails, nothing of it is written", () => {
    const ledger = freshLedger();
    const before = snapshot(ledger);
    const failing = () => ({
      events: {
        recorded: () => {
          throw new Error("the listener failed");
        },
      },
    });
    expect(() => apply(ledger, awaiting("261020AAAA0002"), TEST_CLOCK, failing)).toThrow("the listener failed");
    expect(snapshot(ledger)).toEqual(before);
  });

  it("AC2: the same row applied a second time writes nothing but last_seen_in_report_at", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    const row = approved("261020AAAA0003");
    apply(ledger, awaiting("261020AAAA0003"), clock);
    apply(ledger, row, clock);
    const before = snapshot(ledger);
    clock.advance(HOUR);
    expect(apply(ledger, row, clock).outcome).toBe("skipped");
    expect(snapshot(ledger)).toEqual(before);
    expect(orderOf(ledger, "261020AAAA0003").last_seen_in_report_at).toBe(clock.now());
  });

  it("AC2 (golden): repeated reports write each change once", () => {
    const toRow = (orderId: string, r: RepeatRow) => reportRow(orderId, r.orderStatus, r.items.map((i) => ({ status: i.status, parts: i.parts })));
    for (const [n, c] of loadReportApplyFixtures().repeats.entries()) {
      const ledger = freshLedger();
      const orderId = `261020REPT${String(n).padStart(4, "0")}`;
      const outcomes = c.rows.map((r) => apply(ledger, toRow(orderId, r)).outcome);
      const got = { outcomes, status: orderOf(ledger, orderId).status, observations: count(ledger, "order_observations"), history: count(ledger, "order_status_history"), outbox: count(ledger, "outbox") };
      expect(got, c.name).toEqual(c.expected);
    }
  });

  it("AC3: a PAID order and a row with different amounts: the order, its amounts and items are unchanged; only the clawback and the review case are written", () => {
    const ledger = freshLedger();
    importOrder(ledger, { id: "260910PAID0001", status: "PAID", approved: 100000, cashback: 71216, paidAt: "2026-10-05T03:00:00.000Z" });
    const order = () => ({ ...orderOf(ledger, "260910PAID0001"), last_seen_in_report_at: null });
    const before = { order: order(), items: all(ledger, "SELECT * FROM order_items"), history: count(ledger, "order_status_history") };
    const report = apply(ledger, approved("260910PAID0001", [60000]));
    expect(report).toMatchObject({ outcome: "observed", steps: [], reviewCases: ["commission_drop_after_payout"] });
    expect({ order: order(), items: all(ledger, "SELECT * FROM order_items"), history: count(ledger, "order_status_history") }).toEqual(before);
    // 71,216 stored minus the 42,730 cashback 60,000 gives, withheld as the live split was.
    expect(all(ledger, "SELECT clawback_id, customer_id, kind, amount, order_id, reason FROM ledger_entries")).toEqual([
      { clawback_id: "260910PAID0001-1", customer_id: "C1", kind: "CLAWBACK", amount: -28486, order_id: "260910PAID0001", reason: "commission_drop_after_payout" },
    ]);
    expect(all(ledger, "SELECT order_id, reason, status FROM review_cases")).toEqual([{ order_id: "260910PAID0001", reason: "commission_drop_after_payout", status: "OPEN" }]);
    // The only message is the clawback's (Story 3.6); the order itself is not told anything new.
    expect(all(ledger, "SELECT dedup_key FROM outbox")).toEqual([{ dedup_key: "clawback:260910PAID0001-1:opened" }]);
  });

  it("AC3: a cancel after payout keeps the order PAID and claws back the stored cashback plus the paid bonus, once", () => {
    const ledger = freshLedger();
    importOrder(ledger, { id: "260910PAID0002", status: "PAID", approved: 100000, cashback: 79216, paidAt: "2026-10-05T03:00:00.000Z" });
    award(ledger, "260910PAID0002", "PAID");
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    apply(ledger, cancelled("260910PAID0002"), clock);
    clock.advance(HOUR);
    apply(ledger, reportRow("260910PAID0002", "CANCELLED", [{ status: "CANCELLED", parts: [0], value: 99000 }]), clock);
    expect(orderOf(ledger, "260910PAID0002")).toMatchObject({ status: "PAID", cashback: 79216, paid_at: "2026-10-05T03:00:00.000Z" });
    expect(all(ledger, "SELECT amount FROM ledger_entries")).toEqual([{ amount: -99216 }]);
    expect(all(ledger, "SELECT event FROM audit_entries WHERE event LIKE 'payouts.%'")).toEqual([{ event: "payouts.clawback.opened" }]);
    expect(all(ledger, "SELECT status FROM campaign_awards")).toEqual([{ status: "PAID" }]);
  });

  it("AC3: the database refuses any change to a paid order beyond its last-seen time, its items included (D4)", () => {
    const ledger = freshLedger();
    importOrder(ledger, { id: "260910PAID0003", status: "PAID", approved: 100000, cashback: 79216, paidAt: "2026-10-05T03:00:00.000Z" });
    for (const sql of [
      "UPDATE orders SET cashback = 1 WHERE order_id = '260910PAID0003'",
      "UPDATE orders SET cashback_fee = 1 WHERE order_id = '260910PAID0003'",
      "UPDATE orders SET estimated_commission = 1 WHERE order_id = '260910PAID0003'",
      "UPDATE orders SET status = 'REJECTED', paid_at = NULL WHERE order_id = '260910PAID0003'",
      "UPDATE orders SET status = 'FROZEN', paid_at = NULL WHERE order_id = '260910PAID0003'",
      "UPDATE order_items SET approved_commission = 1 WHERE order_id = '260910PAID0003'",
      "DELETE FROM order_items WHERE order_id = '260910PAID0003'",
    ]) {
      expect(() => ledger.sqlite.exec(sql), sql).toThrow("a paid order never changes");
    }
    ledger.sqlite.exec("UPDATE orders SET last_seen_in_report_at = '2026-10-30T07:00:00.000Z' WHERE order_id = '260910PAID0003'");
    expect(orderOf(ledger, "260910PAID0003")).toMatchObject({ status: "PAID", last_seen_in_report_at: "2026-10-30T07:00:00.000Z" });
  });

  it("AC4: an imported order seen for the first time gets its real items; its stored amounts are not recomputed", () => {
    const ledger = freshLedger();
    // Live stored 15,000 for a 20,000 commission (its own split); the new split would give 14,243.
    importOrder(ledger, { id: "260910IMPT0001", status: "APPROVED", approved: 20000, cashback: 15000 });
    expect(apply(ledger, reportRow("260910IMPT0001", "APPROVED", [{ status: "APPROVED", parts: [12000, 8000], value: 120000 }])).outcome).toBe("observed");
    expect(orderOf(ledger, "260910IMPT0001")).toMatchObject({ status: "APPROVED", approved_commission: 20000, cashback: 15000, cashback_fee: null, origin: "CUTOVER" });
    expect(all(ledger, "SELECT line_no, item_id, approved_commission, network_status, origin FROM order_items")).toEqual([{ line_no: 1, item_id: "I1", approved_commission: 20000, network_status: "APPROVED", origin: "REPORT" }]);
    expect(count(ledger, "order_status_history")).toBe(1);
  });

  it("AC5: a guest (HOUSE) row records an order owned by HOUSE, approved with cashback 0, and no outbox row", () => {
    const ledger = freshLedger();
    const house = { subIds: ["HOUSE", "REQH", "", "", ""] };
    apply(ledger, awaiting("261020HOUS0001", [100000], house));
    apply(ledger, approved("261020HOUS0001", [100000], house));
    expect(orderOf(ledger, "261020HOUS0001")).toMatchObject({ customer_id: "HOUSE", status: "APPROVED", approved_commission: 100000, cashback: 0 });
    expect(count(ledger, "outbox")).toBe(0);
    expect(count(ledger, "order_status_history")).toBe(2);
  });
});

describe("Story 3.3: attribution, claims, holds and notifications", () => {
  it("D58: a sub_id1 that resolves to nobody records no order and opens one review case with the sub_id2 owner as the candidate, once", () => {
    const ledger = freshLedger();
    const row = awaiting("261020UNKN0001", [20000], { subIds: ["NOBODY", "REQ1", "", "", ""] });
    expect(apply(ledger, row)).toEqual({ outcome: "unrecorded", orderId: "261020UNKN0001", steps: [], reviewCases: ["unattributed_sub_id1"] });
    expect(apply(ledger, row).reviewCases).toEqual([]);
    expect(count(ledger, "orders")).toBe(0);
    expect(all(ledger, "SELECT network, subject, order_id, reason, status, candidates FROM review_cases")).toEqual([
      { network: "shopee", subject: "261020UNKN0001", order_id: null, reason: "unattributed_sub_id1", status: "OPEN", candidates: '["C1"]' },
    ]);
    expect(count(ledger, "outbox")).toBe(0);
  });

  it("an owner disagreement between sub_id1 and sub_id2 opens a case carrying both candidates and credits nobody", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020DISA0001", [20000], { subIds: ["C2", "REQ1", "", "", ""] }));
    expect(count(ledger, "orders")).toBe(0);
    expect(all(ledger, "SELECT reason, candidates FROM review_cases")).toEqual([{ reason: "owner_disagreement", candidates: '["C2","C1"]' }]);
  });

  it("D39: a cancel on an order under an OPEN payout claim is stored, not applied, and applied by the first run after the claim ends", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    apply(ledger, approved("261020CLAM0001"), clock);
    const claimed: Override = (deps) => ({ payouts: { ...deps.payouts, coveredByOpenClaim: () => true } });
    clock.advance(HOUR);
    expect(apply(ledger, cancelled("261020CLAM0001"), clock, claimed).outcome).toBe("deferred");
    clock.advance(HOUR);
    expect(apply(ledger, cancelled("261020CLAM0001"), clock, claimed).outcome).toBe("deferred");
    expect(orderOf(ledger, "261020CLAM0001")).toMatchObject({ status: "APPROVED", last_seen_in_report_at: clock.now() });
    expect(all(ledger, "SELECT applied FROM order_observations ORDER BY id")).toEqual([{ applied: 1 }, { applied: 0 }]);
    clock.advance(HOUR);
    expect(apply(ledger, cancelled("261020CLAM0001"), clock).outcome).toBe("changed");
    expect(orderOf(ledger, "261020CLAM0001").status).toBe("REVERSED");
    expect(all(ledger, "SELECT kind, severity FROM alerts")).toEqual([{ kind: "order_reversed", severity: "high" }]);
    expect(all(ledger, "SELECT reason FROM review_cases")).toEqual([{ reason: "cancel_after_approval" }]);
    expect(all(ledger, "SELECT dedup_key FROM outbox ORDER BY id").map((r) => r.dedup_key)).toEqual(["order:261020CLAM0001:recorded", "order:261020CLAM0001:approved", "order:261020CLAM0001:reversed"]);
  });

  it("D55: an unknown status freezes an approved order and suspends its award without voiding it; a cancel before approval voids it", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020FRZN0001"));
    award(ledger, "261020FRZN0001", "CONFIRMED");
    apply(ledger, reportRow("261020FRZN0001", "UNKNOWN", [{ status: "APPROVED", parts: [20000] }]));
    expect(orderOf(ledger, "261020FRZN0001").status).toBe("FROZEN");
    expect(all(ledger, "SELECT status FROM campaign_awards")).toEqual([{ status: "CONFIRMED" }]);
    expect(all(ledger, "SELECT reason FROM review_cases")).toEqual([{ reason: "unknown_status" }]);

    apply(ledger, awaiting("261020VOID0001"));
    award(ledger, "261020VOID0001", "HELD");
    apply(ledger, cancelled("261020VOID0001"));
    expect(orderOf(ledger, "261020VOID0001")).toMatchObject({ status: "REJECTED", rejection_reason: "order_cancelled" });
    expect(all(ledger, "SELECT status FROM campaign_awards WHERE order_id = '261020VOID0001'")).toEqual([{ status: "VOID" }]);
  });

  it("an approval confirms the order's held award", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020AWRD0001"));
    award(ledger, "261020AWRD0001", "HELD");
    apply(ledger, approved("261020AWRD0001"));
    expect(one(ledger, "SELECT status, confirmed_at FROM campaign_awards")).toEqual({ status: "CONFIRMED", confirmed_at: TEST_CLOCK.now() });
  });

  it("one notification per change: an event the cutover already told is not told again", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020TOLD0001"));
    ledger.sqlite.exec("DELETE FROM outbox; INSERT INTO outbox (dedup_key, customer_id, message_key, created_at, sent_at, origin) VALUES ('order:261020TOLD0001:approved', 'C1', 'order_approved', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'CUTOVER_SEED')");
    apply(ledger, approved("261020TOLD0001"));
    expect(all(ledger, "SELECT dedup_key, origin FROM outbox")).toEqual([{ dedup_key: "order:261020TOLD0001:approved", origin: "CUTOVER_SEED" }]);
  });

  it("a row of another network for an existing order id changes nothing on the order and opens one network_mismatch case", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020NETW0001"));
    const before = snapshot(ledger);
    const report = apply(ledger, awaiting("261020NETW0001", [20000], { network: "accesstrade", subIds: ["C1", "REQT", "", "", ""] }));
    expect(report).toMatchObject({ outcome: "unrecorded", reviewCases: ["network_mismatch"] });
    const after = snapshot(ledger);
    for (const table of TABLES.filter((t) => t !== "review_cases" && t !== "audit_entries")) expect(after[table]).toEqual(before[table]);
    expect(all(ledger, "SELECT network, subject, order_id, reason FROM review_cases")).toEqual([{ network: "accesstrade", subject: "261020NETW0001", order_id: "261020NETW0001", reason: "network_mismatch" }]);
  });

  it("AccessTrade orders take the platform of their link request", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("AT0000000001", [50000], { network: "accesstrade", subIds: ["C1", "REQT", "", "", ""] }));
    expect(orderOf(ledger, "AT0000000001")).toMatchObject({ network: "accesstrade", platform: "tiktok", request_id: "REQT" });
  });
});

describe("Story 3.4 acceptance criteria", () => {
  const markPeriod = (ledger: Ledger, withheld: boolean, network: "shopee" | "accesstrade" = "shopee") =>
    ledger.tx((db) => markSettlementPeriod(db, { network, periodMonth: "2026-10", withheld }, commandAudit(db, TEST_CLOCK, TEST_ACTOR)));

  it("AC1, AC2, AC3, AC5 (golden): stored cashback, fee, tax and withheld setting at approval", () => {
    for (const [n, c] of loadReportApplyFixtures().approvals.entries()) {
      const ledger = freshLedger();
      const orderId = `261020GOLD${String(n).padStart(4, "0")}`;
      const subIds = c.guest ? ["HOUSE", "REQH", "", "", ""] : c.network === "accesstrade" ? ["C1", "REQT", "", "", ""] : ["C1", "REQ1", "", "", ""];
      if (c.periodMark !== null) markPeriod(ledger, c.periodMark, c.network);
      apply(ledger, awaiting(orderId, [c.estimatedCommission], { network: c.network, subIds }));
      apply(ledger, reportRow(orderId, c.network === "accesstrade" ? null : "APPROVED", [{ status: "APPROVED", parts: c.approvedParts }], { network: c.network, subIds }));
      const o = orderOf(ledger, orderId);
      expect({ approvedCommission: o.approved_commission, fee: o.cashback_fee, tax: o.cashback_tax, withheld: o.cashback_withheld === 1, cashback: o.cashback }, c.name).toEqual(c.expected);
      expect(o, c.name).toMatchObject({ status: "APPROVED", settlement_period: "2026-10", approved_at: TEST_CLOCK.now() });
    }
  });

  it("AC2: an unmark changes only approvals after it; an order approved before it keeps 71,216", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    apply(ledger, awaiting("261020BEFR0001", [100000]), clock);
    apply(ledger, approved("261020BEFR0001", [100000]), clock);
    clock.advance(HOUR);
    markPeriod(ledger, false);
    apply(ledger, awaiting("261020AFTR0001", [100000]), clock);
    apply(ledger, approved("261020AFTR0001", [100000]), clock);
    expect(orderOf(ledger, "261020BEFR0001")).toMatchObject({ cashback: 71216, cashback_tax: 10000, cashback_withheld: 1 });
    expect(orderOf(ledger, "261020AFTR0001")).toMatchObject({ cashback: 79216, cashback_tax: 0, cashback_withheld: 0 });
    expect(all(ledger, "SELECT event, payload FROM audit_entries WHERE event = 'orders.settlement_period.marked'")).toEqual([
      { event: "orders.settlement_period.marked", payload: '{"network":"shopee","periodMonth":"2026-10","withheld":false}' },
    ]);
  });

  it("AC4: a later report repeating the approved commission leaves the stored cashback as it is, even after the period mark changes", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020KEEP0001", [100000]));
    apply(ledger, approved("261020KEEP0001", [100000]));
    markPeriod(ledger, false);
    expect(apply(ledger, reportRow("261020KEEP0001", "APPROVED", [{ status: "APPROVED", parts: [100000], value: 90000 }])).outcome).toBe("observed");
    expect(orderOf(ledger, "261020KEEP0001")).toMatchObject({ cashback: 71216, cashback_fee: 980, cashback_tax: 10000, cashback_withheld: 1, approved_commission: 100000 });
    expect(count(ledger, "order_status_history")).toBe(2);
  });

  it("an AccessTrade period cannot be unmarked: AccessTrade always withholds", () => {
    const ledger = freshLedger();
    expect(() => markPeriod(ledger, false, "accesstrade")).toThrow(SettlementPeriodError);
    expect(() => ledger.tx((db) => markSettlementPeriod(db, { network: "shopee", periodMonth: "2026-13", withheld: false }, commandAudit(db, TEST_CLOCK, TEST_ACTOR)))).toThrow(/YYYY-MM/);
  });

  it("a commission drop after payout claws back against the split the order was approved with", () => {
    const ledger = freshLedger();
    markPeriod(ledger, false);
    apply(ledger, awaiting("261020DROP0001", [100000]));
    apply(ledger, approved("261020DROP0001", [100000]));
    markPeriod(ledger, true);
    ledger.sqlite.exec("UPDATE orders SET status = 'PAID', paid_at = '2026-10-30T08:00:00.000Z' WHERE order_id = '261020DROP0001'");
    apply(ledger, approved("261020DROP0001", [60000]));
    // Not withheld: 79,216 stored, 60,000 gives 47,530.
    expect(all(ledger, "SELECT amount FROM ledger_entries")).toEqual([{ amount: -31686 }]);
  });
});

describe("review fixes: approvals, request links and networks", () => {
  const markPeriod = (ledger: Ledger, periodMonth: string, withheld: boolean) =>
    ledger.tx((db) => markSettlementPeriod(db, { network: "shopee", periodMonth, withheld }, commandAudit(db, TEST_CLOCK, TEST_ACTOR)));

  it("a re-approval after reject and reopen is a new approval: the current period's setting, period and time stamped together and recorded in history", () => {
    const ledger = freshLedger();
    const september = movingClock("2026-09-15T03:00:00.000Z");
    apply(ledger, approved("260915RAPP0001", [100000]), september);
    expect(orderOf(ledger, "260915RAPP0001")).toMatchObject({ cashback: 71216, cashback_withheld: 1, settlement_period: "2026-09", approved_at: "2026-09-15T03:00:00.000Z" });
    // Frozen by the report, then rejected and reopened by staff through review cases (Story 3.9).
    apply(ledger, reportRow("260915RAPP0001", "UNKNOWN", [{ status: "APPROVED", parts: [100000] }]), september);
    ledger.sqlite.exec("UPDATE orders SET status = 'REJECTED' WHERE order_id = '260915RAPP0001'; UPDATE orders SET status = 'AWAITING_APPROVAL' WHERE order_id = '260915RAPP0001'");
    markPeriod(ledger, "2026-10", false);
    apply(ledger, reportRow("260915RAPP0001", "APPROVED", [{ status: "APPROVED", parts: [100000], value: 90000 }]));
    expect(orderOf(ledger, "260915RAPP0001")).toMatchObject({ status: "APPROVED", cashback: 79216, cashback_fee: 980, cashback_tax: 0, cashback_withheld: 0, settlement_period: "2026-10", approved_at: TEST_CLOCK.now() });
    expect(one(ledger, "SELECT from_status, to_status, reason FROM order_status_history ORDER BY id DESC LIMIT 1")).toEqual({
      from_status: "AWAITING_APPROVAL",
      to_status: "APPROVED",
      reason: "approved in settlement period shopee 2026-10, not withheld",
    });
    const audit = one(ledger, "SELECT payload FROM audit_entries WHERE event = 'orders.order.approved' ORDER BY id DESC LIMIT 1") as { payload: string };
    expect(JSON.parse(audit.payload)).toMatchObject({ settlementPeriod: "2026-10", withheld: false, cashback: 79216 });
  });

  it("a sub_id2 request owned by no one is not linked: the order has no request and the case notes the uncredited request", () => {
    const ledger = freshLedger();
    apply(ledger, reportRow("261020NREQ0001", "UNKNOWN", [{ status: "AWAITING", parts: [20000] }], { subIds: ["C1", "REQE", "", "", ""] }));
    expect(orderOf(ledger, "261020NREQ0001")).toMatchObject({ customer_id: "C1", request_id: null, platform: "shopee", status: "FROZEN" });
    const c = one(ledger, "SELECT reason, observation FROM review_cases") as { reason: string; observation: string };
    expect(c.reason).toBe("unknown_status");
    expect(JSON.parse(c.observation)).toMatchObject({ unmatchedRequest: "REQE" });
    apply(ledger, awaiting("261020NREQ0002", [20000], { subIds: ["C1", "NOSUCHREQ", "", "", ""] }));
    expect(orderOf(ledger, "261020NREQ0002")).toMatchObject({ customer_id: "C1", request_id: null, platform: "shopee" });
  });

  it("a sub_id2 request owned by someone else credits nobody (owner disagreement); one whose owner is credited is linked", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020OREQ0001", [20000], { subIds: ["C1", "REQ2", "", "", ""] }));
    expect(orderOf(ledger, "261020OREQ0001")).toBeUndefined();
    expect(all(ledger, "SELECT reason, candidates FROM review_cases")).toEqual([{ reason: "owner_disagreement", candidates: '["C1","C2"]' }]);
    apply(ledger, awaiting("261020OREQ0002", [20000], { subIds: ["", "REQ2", "", "", ""] }));
    expect(orderOf(ledger, "261020OREQ0002")).toMatchObject({ customer_id: "C2", request_id: "REQ2" });
  });

  it("an imported order of no network takes the row's network in the same step, recorded in history, and can then be paid", () => {
    const ledger = freshLedger();
    importOrder(ledger, { id: "260910NONE0001", status: "APPROVED", approved: 20000, cashback: 14243, network: null });
    apply(ledger, approved("260910NONE0001"));
    expect(orderOf(ledger, "260910NONE0001")).toMatchObject({ network: "shopee", status: "APPROVED", cashback: 14243 });
    expect(one(ledger, "SELECT from_status, to_status, reason FROM order_status_history ORDER BY id DESC LIMIT 1")).toEqual({ from_status: "APPROVED", to_status: "APPROVED", reason: "network set to shopee by its report" });
    expect(all(ledger, "SELECT event FROM audit_entries WHERE event = 'orders.order.network_set'")).toHaveLength(1);
    ledger.tx((db) => {
      const by = commandAudit(db, TEST_CLOCK, TEST_ACTOR);
      return markOrderPaid(db, { orderId: "260910NONE0001", customerId: "C1" }, { clock: TEST_CLOCK, by, outbox: outboxFor(db, TEST_CLOCK, by), awards: orderAwardsFor(db, TEST_CLOCK, by) });
    });
    expect(orderOf(ledger, "260910NONE0001")).toMatchObject({ status: "PAID", paid_at: TEST_CLOCK.now() });
  });

  it("a PAID imported order of no network keeps it (D4); a real network mismatch is still not applied", () => {
    const ledger = freshLedger();
    importOrder(ledger, { id: "260910NONE0002", status: "PAID", approved: 20000, cashback: 14243, paidAt: "2026-10-05T03:00:00.000Z", network: null });
    apply(ledger, approved("260910NONE0002"));
    expect(orderOf(ledger, "260910NONE0002")).toMatchObject({ network: null, status: "PAID" });
    importOrder(ledger, { id: "260910SHOP0003", status: "APPROVED", approved: 20000, cashback: 14243 });
    expect(apply(ledger, approved("260910SHOP0003", [20000], { network: "accesstrade" }))).toMatchObject({ outcome: "unrecorded", reviewCases: ["network_mismatch"] });
    expect(orderOf(ledger, "260910SHOP0003")).toMatchObject({ network: "shopee", status: "APPROVED" });
  });

  it("claims are read only for an APPROVED order, paid bonus and earlier clawbacks only for a PAID one", () => {
    const ledger = freshLedger();
    const asked: string[] = [];
    const watching: Override = (deps) => ({
      payouts: { ...deps.payouts, coveredByOpenClaim: (id) => (asked.push("claim"), deps.payouts.coveredByOpenClaim(id)), clawedBack: (id) => (asked.push("clawback"), deps.payouts.clawedBack(id)) },
      awards: { ...deps.awards, paidBonus: (id) => (asked.push("bonus"), deps.awards.paidBonus(id)) },
    });
    apply(ledger, awaiting("261020LAZY0001"), TEST_CLOCK, watching);
    apply(ledger, awaiting("261020LAZY0001", [21000]), TEST_CLOCK, watching);
    expect(asked).toEqual([]);
    apply(ledger, approved("261020LAZY0001", [21000]), TEST_CLOCK, watching);
    apply(ledger, approved("261020LAZY0001", [22000]), TEST_CLOCK, watching);
    expect(asked).toEqual(["claim"]);
    ledger.sqlite.exec("UPDATE orders SET status = 'PAID', paid_at = '2026-10-30T08:00:00.000Z' WHERE order_id = '261020LAZY0001'");
    apply(ledger, cancelled("261020LAZY0001"), TEST_CLOCK, watching);
    expect(asked).toEqual(["claim", "bonus", "clawback"]);
  });
});
