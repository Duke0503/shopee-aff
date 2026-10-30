/**
 * Story 2.3: live orders imported with their stored amounts, status and paid time, from a
 * read-only copy of the live ledger (fixtures/live-schema.sql + fixtures/live-rows.sql), with the
 * paid parity of D44 in the report.
 */
import { splitCommission } from "@cashback/money";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { paidParity } from "../src/cutover/order-checks";
import { LIVE_ORDER_STATUS } from "../src/cutover/order-source";
import { CUTOVER_ACTOR } from "../src/modules/orders/index";
import { openLedger } from "../src/platform/db/ledger";
import { buildLiveCopy, importOnce, rows, TEST_CLOCK } from "./helpers/live-fixture";

type Row = Record<string, string | number | null>;

const ORDER_TABLES = ["orders", "order_items", "order_status_history", "order_observations", "settlement_periods"] as const;
const source = buildLiveCopy();
const run = importOnce(source);
const orders = new Map((rows(run.targetPath, "SELECT * FROM orders") as Row[]).map((o) => [o["order_id"], o]));
const notesOf = (kind: string) => run.report.notes.filter((n) => n.kind === kind).map((n) => n.key);

describe("Story 2.3 acceptance criteria", () => {
  it("AC1: a live order with paid_at set is PAID with the same paid_at (converted by its rule) and the same stored cashback", () => {
    expect(orders.get("260911AAAA0001")).toMatchObject({ status: "PAID", paid_at: "2026-10-05T03:00:00.000Z", cashback: 6232, approved_commission: 8745 });
    expect(orders.get("261001JJJJ0010")).toMatchObject({ status: "PAID", paid_at: "2026-10-08T02:00:00.000Z", cashback: 7000 });
    expect(orders.get("TT0000000000000007")).toMatchObject({ status: "PAID", paid_at: "2026-10-06T02:00:00.000Z", cashback: null, network: "accesstrade", platform: "tiktok" });
    expect(notesOf("paid_cashback_missing")).toEqual(["TT0000000000000007"]);
  });

  it("AC1: a paid order whose paid time fits no rule stays PAID, is listed, and its time is not written", () => {
    expect(orders.get("260919IIII0009")).toMatchObject({ status: "PAID", paid_at: null, cashback: 10000 });
    expect(run.report.timeProblems).toContainEqual({ table: "orders", key: "260919IIII0009", column: "paid_at" });
    expect(notesOf("paid_at_missing")).toEqual(["260919IIII0009"]);
  });

  it("AC1: a live order with paid_at set but another status is imported PAID, counts as paid on both sides, and is listed as a paid status conflict", () => {
    const copy = buildLiveCopy({
      extraSql: "INSERT INTO orders (order_id, customer_id, order_value, estimated_commission, approved_commission, cashback_amount, status, recorded_at, approved_at, paid_at, updated_at, platform) VALUES ('261002KKKK0011', '1000000000000000005', 100000, 5000, 5000, 3561, 'approved', '2026-10-02T09:00:00+07:00', '2026-10-03T09:00:00+07:00', '2026-10-09 02:00:00', '2026-10-09 02:00:00', 'shopee');",
    });
    const altered = importOnce(copy);
    expect(rows(altered.targetPath, "SELECT status, paid_at, cashback FROM orders WHERE order_id = '261002KKKK0011'")).toEqual([{ status: "PAID", paid_at: "2026-10-09T02:00:00.000Z", cashback: 3561 }]);
    expect(altered.report.notes).toContainEqual({ kind: "paid_at_status_conflict", table: "orders", key: "261002KKKK0011", detail: "approved" });
    expect(altered.report.orders?.paidParity).toEqual({ result: "pass", customers: 4, mismatches: [] });
    expect(altered.report.orders?.paidStatusConflicts).toEqual([{ orderId: "261002KKKK0011", kind: "paid_at_without_paid_status", liveStatus: "approved" }]);
  });

  it("AC1: a live order with status paid and no paid_at counts as paid on both sides and is listed as a paid status conflict", () => {
    const copy = buildLiveCopy({
      extraSql: "INSERT INTO orders (order_id, customer_id, order_value, estimated_commission, approved_commission, cashback_amount, status, recorded_at, approved_at, paid_at, updated_at, platform) VALUES ('261002LLLL0012', '1000000000000000005', 100000, 5000, 5000, 3561, 'paid', '2026-10-02T09:00:00+07:00', '2026-10-03T09:00:00+07:00', NULL, '2026-10-09 02:00:00', 'shopee');",
    });
    const altered = importOnce(copy);
    expect(rows(altered.targetPath, "SELECT status, paid_at, cashback FROM orders WHERE order_id = '261002LLLL0012'")).toEqual([{ status: "PAID", paid_at: null, cashback: 3561 }]);
    expect(altered.report.orders?.paidParity).toEqual({ result: "pass", customers: 4, mismatches: [] });
    expect(altered.report.orders?.paidStatusConflicts).toEqual([{ orderId: "261002LLLL0012", kind: "paid_status_without_paid_at", liveStatus: "paid" }]);
  });

  it("AC1: the fixture has no paid status conflict (an unreadable paid_at is still a paid_at set)", () => {
    expect(run.report.orders?.paidStatusConflicts).toEqual([]);
  });

  it("lists a request id the import did not take (its customer is gone) as missing", () => {
    const copy = buildLiveCopy({ extraSql: "UPDATE orders SET request_id = '26091800008' WHERE order_id = '260915EEEE0005';" });
    expect(importOnce(copy).report.notes.filter((n) => n.kind === "order_request_missing").map((n) => n.key)).toEqual(["260913CCCC0003", "260915EEEE0005"]);
  });

  it("compares a guest order's cashback as 0 by the import's own rule: role HOUSE in any case, aliases resolved", () => {
    const copy = buildLiveCopy({
      extraSql: `INSERT INTO customers (customer_id, display_name, status, created_at, role, customer_code) VALUES
        ('GUEST2', 'Guest two', 'active', '2026-10-01T00:00:00+07:00', 'HOUSE', 'DP00500'),
        ('GUEST3', 'Guest three', 'active', '2026-10-01T00:00:00+07:00', 'House', 'DP00501');
      INSERT INTO orders (order_id, customer_id, order_value, estimated_commission, approved_commission, cashback_amount, status, recorded_at, approved_at, updated_at, platform) VALUES
        ('261003MMMM0013', 'GUEST2', 100000, 5000, 5000, 500, 'approved', '2026-10-02T09:00:00+07:00', '2026-10-03T09:00:00+07:00', '2026-10-03T09:00:00+07:00', 'shopee'),
        ('261003NNNN0014', 'GUEST3', 100000, 5000, 5000, 500, 'approved', '2026-10-02T09:00:00+07:00', '2026-10-03T09:00:00+07:00', '2026-10-03T09:00:00+07:00', 'shopee'),
        ('261003OOOO0015', '9000000000000000777', 100000, 5000, 5000, 500, 'approved', '2026-10-02T09:00:00+07:00', '2026-10-03T09:00:00+07:00', '2026-10-03T09:00:00+07:00', 'shopee');
      INSERT INTO customer_aliases (alias, customer_id, created_at) VALUES ('9000000000000000777', 'GUEST2', '2026-10-01T00:00:00+07:00');`,
    });
    const imported = importOnce(copy);
    expect(rows(imported.targetPath, "SELECT order_id, cashback FROM orders WHERE order_id LIKE '261003%' ORDER BY 1")).toEqual([
      { order_id: "261003MMMM0013", cashback: 0 },
      { order_id: "261003NNNN0014", cashback: 0 },
      { order_id: "261003OOOO0015", cashback: 0 },
    ]);
    expect(imported.report.comparison["orders"]?.mismatches).toEqual([]);
  });

  it("AC2: a stored cashback the FR-13 split computes differently is kept unchanged and listed with both amounts", () => {
    expect(splitCommission({ approvedCommission: 8745, network: "shopee", withheld: true }).cashback).toBe(6228);
    expect(orders.get("260911AAAA0001")?.["cashback"]).toBe(6232);
    expect(run.report.orders?.cashbackDifferences).toEqual([
      { orderId: "260911AAAA0001", stored: 6232, newSplit: 6228 },
      { orderId: "260919IIII0009", stored: 10000, newSplit: 10002 },
    ]);
    // The approved order whose stored amount equals the split is not listed.
    expect(orders.get("260912BBBB0002")?.["cashback"]).toBe(14243);
  });

  it("AC3: a live status that maps to no new status is listed, imported FROZEN (in no total), never guessed", () => {
    expect(Object.keys(LIVE_ORDER_STATUS)).toEqual(["awaiting_approval", "approved", "paid", "rejected"]);
    expect(run.report.notes).toContainEqual({ kind: "unknown_order_status", table: "orders", key: "260916FFFF0006", detail: "weird_status" });
    expect(orders.get("260916FFFF0006")).toMatchObject({ status: "FROZEN", cashback: null });
  });

  it("AC4: every imported order has exactly one item and one history row with actor cutover", () => {
    const perOrder = rows(
      run.targetPath,
      `SELECT o.order_id,
              (SELECT count(*) FROM order_items i WHERE i.order_id = o.order_id) AS items,
              (SELECT count(*) FROM order_status_history h WHERE h.order_id = o.order_id) AS history
         FROM orders o ORDER BY o.order_id`,
    ) as Row[];
    expect(perOrder).toHaveLength(10);
    for (const row of perOrder) expect(row).toMatchObject({ items: 1, history: 1 });
    expect(rows(run.targetPath, "SELECT DISTINCT actor, from_status, changed_at FROM order_status_history")).toEqual([{ actor: CUTOVER_ACTOR, from_status: null, changed_at: TEST_CLOCK.now() }]);
    expect(rows(run.targetPath, "SELECT h.to_status = o.status AS same FROM order_status_history h JOIN orders o USING (order_id)").every((r) => (r as Row)["same"] === 1)).toBe(true);
    expect(rows(run.targetPath, "SELECT line_no, price, estimated_commission, approved_commission, network_status, origin FROM order_items WHERE order_id = '260911AAAA0001'")).toEqual([
      { line_no: 1, price: 159000, estimated_commission: 8745, approved_commission: 8745, network_status: null, origin: "CUTOVER" },
    ]);
    expect(rows(run.targetPath, "SELECT count(*) AS n FROM order_observations")).toEqual([{ n: 0 }]);
  });

  it("AC5: a guest (HOUSE) order has cashback 0 and stays owned by HOUSE; the stored amount is listed", () => {
    expect(orders.get("260914DDDD0004")).toMatchObject({ customer_id: "HOUSE", cashback: 0, approved_commission: 12000, status: "APPROVED" });
    expect(run.report.notes).toContainEqual({ kind: "house_cashback_zeroed", table: "orders", key: "260914DDDD0004", detail: "3000" });
    expect(run.report.orders?.cashbackDifferences.map((d) => d.orderId)).not.toContain("260914DDDD0004");
  });
});

describe("Story 2.3: the rest of each order and the report", () => {
  it("D44: paid totals per customer equal the live ones to the dong, and the report says pass", () => {
    expect(run.report.orders?.paidParity).toEqual({ result: "pass", customers: 3, mismatches: [] });
    expect(rows(run.targetPath, "SELECT customer_id, sum(coalesce(cashback, 0)) AS paid FROM orders WHERE status = 'PAID' GROUP BY customer_id ORDER BY customer_id")).toEqual([
      { customer_id: "1000000000000000001", paid: 6232 },
      { customer_id: "1000000000000000002", paid: 10000 },
      { customer_id: "1000000000000000009", paid: 7000 },
    ]);
  });

  it("D44: one deliberately altered paid amount in the new ledger fails parity with that customer and both totals", () => {
    const { targetPath } = importOnce(source);
    const ledger = openLedger(targetPath);
    const live = new Database(source, { readonly: true });
    try {
      // Only a test can do this: the trigger forbids changing a paid order.
      ledger.sqlite.exec("DROP TRIGGER orders_paid_amounts_unchanged; UPDATE orders SET cashback = 7001 WHERE order_id = '261001JJJJ0010';");
      expect(paidParity(live, ledger.sqlite, new Set(["HOUSE"]))).toEqual({ result: "fail", customers: 3, mismatches: [{ customerId: "1000000000000000009", live: 7000, imported: 7001 }] });
    } finally {
      live.close();
      ledger.close();
    }
  });

  it("D44: guests are left out of parity, and a live paid order under an old Zalo id counts for the survivor", () => {
    const copy = buildLiveCopy({
      extraSql:
        "UPDATE orders SET status = 'paid', paid_at = '2026-10-09 02:00:00' WHERE order_id IN ('260914DDDD0004', '260912BBBB0002');",
    });
    const result = importOnce(copy).report.orders?.paidParity;
    expect(result).toEqual({ result: "pass", customers: 3, mismatches: [] });
  });

  it("flags the recorded time synthesized from the SN prefix on the order row and counts it (Story 2.1 AC4)", () => {
    expect(orders.get("260913CCCC0003")).toMatchObject({ recorded_at: "2026-09-12T17:00:00.000Z", recorded_at_approximate: 1 });
    expect(orders.get("260911AAAA0001")).toMatchObject({ recorded_at: "2026-09-11T06:11:31.000Z", recorded_at_approximate: 0 });
    expect(run.report.approximate).toEqual({ "orders.recorded_at": 1 });
  });

  it("keeps ids, owners and request ids; follows an alias to the survivor; lists a gone customer, a missing request and an unknown platform", () => {
    expect(orders.get("260912BBBB0002")).toMatchObject({ customer_id: "1000000000000000002", request_id: "26091200002", status: "APPROVED" });
    expect(orders.get("260913CCCC0003")).toMatchObject({ request_id: "nope0000001", status: "AWAITING_APPROVAL" });
    expect(orders.get("260918HHHH0008")).toMatchObject({ customer_id: null, network: null, platform: "grab" });
    expect(notesOf("order_customer_via_alias")).toEqual(["260912BBBB0002"]);
    expect(notesOf("order_customer_missing")).toEqual(["260918HHHH0008"]);
    expect(notesOf("order_request_missing")).toEqual(["260913CCCC0003"]);
    expect(notesOf("unknown_platform")).toEqual(["260918HHHH0008"]);
    // Rows the report already names (an owner via an alias, a gone customer) are not compared again.
    expect(run.report.comparison["orders"]).toEqual({ source: 10, imported: 10, mismatches: [] });
  });

  it("keeps the rejection reason, the network batch and settled time, and marks every row CUTOVER", () => {
    expect(orders.get("260915EEEE0005")?.["rejection_reason"]).toBe((rows(source, "SELECT rejection_reason AS r FROM orders WHERE order_id = '260915EEEE0005'")[0] as Row)["r"]);
    expect(orders.get("260911AAAA0001")).toMatchObject({ network_batch_id: "B202610", settled_at: "2026-10-20T02:00:00.000Z", approved_at: "2026-10-01T03:00:00.000Z", updated_at: "2026-10-05T03:00:00.000Z", last_seen_in_report_at: null });
    expect(new Set([...orders.values()].map((o) => o["origin"]))).toEqual(new Set(["CUTOVER"]));
    expect(run.report.orders?.byStatus).toEqual({ APPROVED: 2, AWAITING_APPROVAL: 2, FROZEN: 1, PAID: 4, REJECTED: 1 });
  });

  it("adds a withheld settlement period per network month of the imported approvals", () => {
    expect(rows(run.targetPath, "SELECT * FROM settlement_periods ORDER BY period_month")).toEqual([
      { network: "shopee", period_month: "2026-09", withheld: 1, origin: "CUTOVER" },
      { network: "shopee", period_month: "2026-10", withheld: 1, origin: "CUTOVER" },
    ]);
  });

  it("D4: a paid order's amounts, owner and paid time never change; history and observations are insert-only", () => {
    const { targetPath } = importOnce(source);
    const ledger = openLedger(targetPath);
    try {
      const exec = (q: string) => () => ledger.sqlite.exec(q);
      expect(exec("UPDATE orders SET cashback = 1 WHERE order_id = '260911AAAA0001'")).toThrow("a paid order never changes");
      expect(exec("UPDATE orders SET customer_id = 'HOUSE' WHERE order_id = '260911AAAA0001'")).toThrow("a paid order never changes");
      expect(exec("UPDATE orders SET paid_at = '2026-10-06T00:00:00.000Z' WHERE order_id = '260911AAAA0001'")).toThrow("a paid order never changes");
      expect(exec("UPDATE orders SET status = 'APPROVED' WHERE order_id = '260911AAAA0001'")).toThrow("a paid order never changes");
      // A payout void (AD-9) leaves PAID and clears paid_at in one statement.
      expect(exec("UPDATE orders SET status = 'APPROVED', paid_at = NULL WHERE order_id = '260911AAAA0001'")).not.toThrow();
      expect(exec("UPDATE orders SET paid_at = '2026-10-06T00:00:00.000Z' WHERE order_id = '260912BBBB0002'")).toThrow("CHECK");
      expect(exec("UPDATE order_status_history SET actor = 'x'")).toThrow("insert_only: order_status_history");
      expect(exec("DELETE FROM order_status_history")).toThrow("insert_only: order_status_history");
      expect(exec("DELETE FROM order_observations")).not.toThrow();
      expect(exec("INSERT INTO order_observations (order_id, observed_at, fingerprint, observation, applied) VALUES ('260912BBBB0002', '2026-10-30T07:00:00.000Z', 'f', '{}', 0)")).not.toThrow();
      expect(exec("UPDATE order_observations SET applied = 1")).toThrow("insert_only: order_observations");
    } finally {
      ledger.close();
    }
  });

  it("is deterministic: two imports of one source give identical order tables and reports", () => {
    const second = importOnce(source);
    for (const table of ORDER_TABLES) expect(rows(second.targetPath, `SELECT * FROM ${table} ORDER BY 1, 2`)).toEqual(rows(run.targetPath, `SELECT * FROM ${table} ORDER BY 1, 2`));
    expect(second.report).toEqual(run.report);
  });

  it("logs counts and the parity result, never an amount per customer", () => {
    const line = JSON.parse(run.lines.find((l) => l.includes("cutover.import.finished")) ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({ orders: 10, linkRequests: 8, shareCodes: 3, seededNotifications: 10, paidParity: "pass" });
  });
});
