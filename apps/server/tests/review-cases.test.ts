/**
 * Story 3.5: every reason the reconciliation rules decline to guess opens one review case per
 * (network, subject, reason), refreshed with the latest evidence (row, fingerprint, candidates)
 * and never a second one, and a case on its own never moves money.
 */
import { afterEach, describe, expect, it } from "vitest";

import { sourced, type RowProblem, type SourcedRow } from "../src/modules/linking/index";
import type { Ledger } from "../src/platform/db/ledger";
import { apply, approved, awaiting, cancelled, closeLedgers, freshLedger, HOUR, movingClock, reportRow } from "./helpers/order-ledger";

afterEach(closeLedgers);

const all = (ledger: Ledger, sql: string, ...args: unknown[]) => ledger.sqlite.prepare(sql).all(...args) as Record<string, unknown>[];
const one = (ledger: Ledger, sql: string, ...args: unknown[]) => ledger.sqlite.prepare(sql).get(...args) as Record<string, unknown>;
const cases = (ledger: Ledger) => all(ledger, "SELECT network, subject, order_id, reason, status, candidates, fingerprint FROM review_cases ORDER BY case_id");
const money = (ledger: Ledger) => ({
  orders: all(ledger, "SELECT order_id, approved_commission, cashback, cashback_fee, cashback_tax, paid_at FROM orders ORDER BY order_id"),
  entries: all(ledger, "SELECT * FROM ledger_entries"),
  awards: all(ledger, "SELECT award_id, amount, status FROM campaign_awards"),
});

function withProblem(row: SourcedRow, problem: RowProblem): SourcedRow {
  const { fingerprint: _f, purchasedAt, ...plain } = row;
  return sourced({ ...plain, problems: [problem] }, purchasedAt);
}

function paidOrder(ledger: Ledger, id: string, cashback = 79216): void {
  ledger.sqlite
    .prepare(
      "INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, approved_at, paid_at, origin) VALUES (?, 'shopee', 'shopee', 'C1', 'PAID', 100000, ?, '2026-09-10T03:00:00.000Z', '2026-10-05T03:00:00.000Z', 'CUTOVER')",
    )
    .run(id, cashback);
}

describe("Story 3.5 acceptance criteria", () => {
  it("AC1: an unattributed row opens one OPEN case with the report row and its fingerprint, and attributes no order", () => {
    const ledger = freshLedger();
    const row = awaiting("261020NOON0001", [20000], { subIds: ["", "", "", "", ""] });
    expect(apply(ledger, row)).toMatchObject({
      outcome: "unrecorded",
      reviewCases: ["unattributed"],
    });
    expect(cases(ledger)).toEqual([
      {
        network: "shopee",
        subject: "261020NOON0001",
        order_id: null,
        reason: "unattributed",
        status: "OPEN",
        candidates: "[]",
        fingerprint: row.fingerprint,
      },
    ]);
    expect(JSON.parse(one(ledger, "SELECT observation FROM review_cases").observation as string)).toMatchObject({ orderId: "261020NOON0001", subIds: ["", "", "", "", ""] });
    expect(all(ledger, "SELECT * FROM orders")).toEqual([]);
  });

  it("AC2: the same unattributed row in the next run opens no second case and writes nothing; a changed row refreshes the one case", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    const row = awaiting("261020NOON0002", [20000], { subIds: ["", "", "", "", ""] });
    apply(ledger, row, clock);
    const audits = all(ledger, "SELECT * FROM audit_entries");
    clock.advance(HOUR);
    expect(apply(ledger, row, clock).reviewCases).toEqual([]);
    expect(all(ledger, "SELECT * FROM audit_entries")).toEqual(audits);
    expect(one(ledger, "SELECT refreshed_at FROM review_cases").refreshed_at).toBeNull();

    clock.advance(HOUR);
    const changed = awaiting("261020NOON0002", [25000], { subIds: ["", "", "", "", ""] });
    expect(apply(ledger, changed, clock).reviewCases).toEqual([]);
    expect(all(ledger, "SELECT fingerprint, refreshed_at FROM review_cases")).toEqual([{ fingerprint: changed.fingerprint, refreshed_at: clock.now() }]);
    expect(all(ledger, "SELECT event FROM audit_entries ORDER BY id").map((r) => r.event)).toEqual(["orders.review_case.opened", "orders.review_case.refreshed"]);
  });

  it("AC3: a cancel signal on an APPROVED order reverses it, opens a case and raises the owner alert", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020REVS0001"));
    apply(ledger, cancelled("261020REVS0001"));
    expect(one(ledger, "SELECT status FROM orders").status).toBe("REVERSED");
    expect(cases(ledger)).toMatchObject([{ order_id: "261020REVS0001", reason: "cancel_after_approval", candidates: '["C1"]' }]);
    expect(all(ledger, "SELECT kind, severity FROM alerts")).toEqual([{ kind: "order_reversed", severity: "high" }]);
  });

  it("AC4: an owner disagreement carries only the candidates the rules produce, and the case has no field for another customer", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020DISA0002", [20000], { subIds: ["C2", "REQ1", "", "", ""] }));
    expect(cases(ledger)).toMatchObject([{ reason: "owner_disagreement", candidates: '["C2","C1"]', order_id: null }]);
    const columns = all(ledger, "SELECT name FROM pragma_table_info('review_cases')").map((c) => c.name);
    expect(columns.filter((c) => typeof c === "string" && c.includes("customer"))).toEqual([]);
  });

  it("AC5: an unknown status freezes the order and suspends its award, without voiding it", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020UNST0001"));
    ledger.sqlite.prepare("INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, origin) VALUES ('CAMP1', 'C1', '261020UNST0001', 20000, 'CONFIRMED', 'RULE')").run();
    apply(ledger, reportRow("261020UNST0001", "UNKNOWN", [{ status: "APPROVED", parts: [20000] }]));
    expect(one(ledger, "SELECT status FROM orders").status).toBe("FROZEN");
    expect(all(ledger, "SELECT status FROM campaign_awards")).toEqual([{ status: "CONFIRMED" }]);
    // Suspension is the order being FROZEN (D55): the award row and its slot stay as they were.
    expect(all(ledger, "SELECT event FROM audit_entries WHERE event = 'campaigns.award.voided'")).toEqual([]);
    expect(cases(ledger)).toMatchObject([{ reason: "unknown_status", candidates: '["C1"]' }]);
  });
});

describe("Story 3.5: every reason the rules produce opens a case and moves no money", () => {
  const FREEZES: [string, (id: string) => SourcedRow][] = [
    ["unknown_status", (id) => reportRow(id, "UNKNOWN", [{ status: "AWAITING", parts: [20000] }])],
    ["no_items", (id) => reportRow(id, "AWAITING", [])],
    ["missing_commission", (id) => reportRow(id, "AWAITING", [{ status: "AWAITING", parts: [] }])],
    ["invalid_amount", (id) => withProblem(awaiting(id), "invalid_amount")],
    ["invalid_quantity", (id) => withProblem(awaiting(id), "invalid_quantity")],
    ["ambiguous_sub_ids", (id) => withProblem(awaiting(id), "ambiguous_sub_ids")],
    ["conflicting_sub_ids", (id) => withProblem(awaiting(id), "conflicting_sub_ids")],
  ];
  for (const [reason, build] of FREEZES) {
    it(`D31 ${reason}: the order is FROZEN with no cashback, one case carries the row's fingerprint and the order's customer as the candidate`, () => {
      const ledger = freshLedger();
      const row = build("261020FREZ0001");
      apply(ledger, row);
      apply(ledger, row);
      expect(one(ledger, "SELECT status, cashback FROM orders")).toEqual({
        status: "FROZEN",
        cashback: null,
      });
      expect(cases(ledger)).toEqual([
        {
          network: "shopee",
          subject: "261020FREZ0001",
          order_id: "261020FREZ0001",
          reason,
          status: "OPEN",
          candidates: '["C1"]',
          fingerprint: row.fingerprint,
        },
      ]);
      expect(money(ledger).entries).toEqual([]);
    });
  }

  it("D31: a row without an order id is a case under its fingerprint, with no order", () => {
    const ledger = freshLedger();
    const row = awaiting("");
    apply(ledger, row);
    expect(cases(ledger)).toEqual([
      {
        network: "shopee",
        subject: `#${row.fingerprint}`,
        order_id: null,
        reason: "missing_order_id",
        status: "OPEN",
        candidates: "[]",
        fingerprint: row.fingerprint,
      },
    ]);
  });

  it("D58: an unresolved sub_id1 is a case carrying the sub_id2 owner, never credited", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020D58X0001", [20000], { subIds: ["NOBODY", "REQ1", "", "", ""] }));
    expect(cases(ledger)).toMatchObject([{ reason: "unattributed_sub_id1", candidates: '["C1"]', order_id: null }]);
    expect(all(ledger, "SELECT * FROM orders")).toEqual([]);
  });

  it("an unknown status on a PAID order opens a case and leaves the order, its cashback and the ledger as they are", () => {
    const ledger = freshLedger();
    paidOrder(ledger, "260910PAIDUNK1");
    const before = money(ledger);
    apply(ledger, reportRow("260910PAIDUNK1", "UNKNOWN", [{ status: "APPROVED", parts: [100000] }]));
    expect(one(ledger, "SELECT status FROM orders").status).toBe("PAID");
    expect(money(ledger)).toEqual(before);
    expect(cases(ledger)).toMatchObject([{ order_id: "260910PAIDUNK1", reason: "unknown_status", candidates: '["C1"]' }]);
  });

  it("a commission drop on an approved unpaid order freezes it with a case and keeps its stored cashback", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020DROP0001", [100000]));
    const stored = one(ledger, "SELECT cashback FROM orders").cashback;
    apply(ledger, approved("261020DROP0001", [60000]));
    expect(one(ledger, "SELECT status, cashback FROM orders")).toEqual({
      status: "FROZEN",
      cashback: stored,
    });
    expect(cases(ledger)).toMatchObject([{ reason: "commission_drop" }]);
  });

  it("a network mismatch is a case and the order is unchanged", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020MISM0001"));
    const before = money(ledger);
    apply(
      ledger,
      approved("261020MISM0001", [20000], {
        network: "accesstrade",
        subIds: ["C1", "REQT", "", "", ""],
      }),
    );
    expect(money(ledger)).toEqual(before);
    expect(cases(ledger)).toMatchObject([{ network: "accesstrade", order_id: "261020MISM0001", reason: "network_mismatch" }]);
  });

  it("a case resolved earlier does not block a new case for the same reason", () => {
    const ledger = freshLedger();
    const row = awaiting("261020AGAN0001", [20000], { subIds: ["", "", "", "", ""] });
    apply(ledger, row);
    ledger.sqlite.exec("UPDATE review_cases SET status = 'RESOLVED', resolution = 'DISMISSED', resolved_at = '2026-10-30T08:00:00.000Z', resolved_by = 'admin', resolution_reason = 'test'");
    expect(apply(ledger, row).reviewCases).toEqual(["unattributed"]);
    expect(all(ledger, "SELECT status FROM review_cases ORDER BY case_id")).toEqual([{ status: "RESOLVED" }, { status: "OPEN" }]);
  });
});

describe("review item 6: an order seen in the report again resolves its not_seen_in_report case", () => {
  function unseenCase(ledger: Ledger, orderId: string): void {
    ledger.sqlite
      .prepare("INSERT INTO review_cases (network, subject, order_id, reason, status, candidates, observation, opened_at, opened_by) VALUES ('shopee', ?, ?, 'not_seen_in_report', 'OPEN', '[\"C1\"]', '{}', '2026-10-29T19:00:00.000Z', 'reconcile')")
      .run(orderId, orderId);
  }

  it("a fingerprint skip and a changing row both resolve it as seen_again, with an audit entry, and change nothing else", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    apply(ledger, awaiting("261020BACK0001"), clock);
    apply(ledger, awaiting("261020BACK0002"), clock);
    unseenCase(ledger, "261020BACK0001");
    unseenCase(ledger, "261020BACK0002");
    const before = money(ledger);
    clock.advance(HOUR);
    expect(apply(ledger, awaiting("261020BACK0001"), clock).outcome).toBe("skipped");
    expect(apply(ledger, approved("261020BACK0002"), clock).outcome).toBe("changed");
    expect(all(ledger, "SELECT subject, status, resolution, resolution_reason, resolved_by, resolved_at FROM review_cases ORDER BY subject")).toEqual([
      { subject: "261020BACK0001", status: "RESOLVED", resolution: "DISMISSED", resolution_reason: "seen_again", resolved_by: "reconcile", resolved_at: clock.now() },
      { subject: "261020BACK0002", status: "RESOLVED", resolution: "DISMISSED", resolution_reason: "seen_again", resolved_by: "reconcile", resolved_at: clock.now() },
    ]);
    expect(all(ledger, "SELECT entity_id FROM audit_entries WHERE event = 'orders.review_case.resolved' ORDER BY id").length).toBe(2);
    expect(money(ledger).orders.find((o) => o.order_id === "261020BACK0001")).toEqual(before.orders.find((o) => o.order_id === "261020BACK0001"));
  });

  it("other reasons stay open when the order is seen again", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020KEEP0001"));
    apply(ledger, cancelled("261020KEEP0001"));
    apply(ledger, cancelled("261020KEEP0001"));
    expect(all(ledger, "SELECT reason, status FROM review_cases")).toEqual([{ reason: "cancel_after_approval", status: "OPEN" }]);
  });
});
