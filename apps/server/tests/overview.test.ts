/**
 * Story 4.17: the Overview's one server query layer (FR-25, FR-27, FR-38, AD-5, AD-27,
 * docs/operations/dashboard-spec.md). Every money figure is checked against the golden ledger in
 * packages/golden/fixtures/overview, whose expected figures were computed independently; the ACs
 * and the "Dashboard" list-defects regressions that live on the server are checked here, the
 * screen side in apps/admin/tests/overview.test.tsx.
 */
import { overviewSchema, payoutListResponseSchema } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { loadOverviewFixture } from "@cashback/golden/overview";
import { afterEach, describe, expect, it } from "vitest";

import { overviewOf } from "../src/admin/overview.query";
import type { Ledger } from "../src/platform/db/ledger";
import { close, type Servers } from "../src/platform/http/servers";
import { deskGet, errorOf, staffCookie } from "./helpers/desk-http";
import { closeLedgers, freshLedger } from "./helpers/order-ledger";
import { addBank, addOrder, CLOCK, FIXTURE, payoutLedger } from "./helpers/payout-ledger";
import { deskServers } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

const golden = loadOverviewFixture();

function goldenLedger(): Ledger {
  const ledger = freshLedger();
  for (const statement of golden.seed) ledger.sqlite.exec(statement);
  return ledger;
}

const goldenOverview = () => overviewOf(goldenLedger().db, { period: "thisMonth" }, fixedClock(golden.clock));

describe("Overview golden ledger: every figure to the dong (Story 4.17, dashboard-spec)", () => {
  const blocks = ["period", "todo", "business", "money", "trend", "orders", "events", "customers", "health"] as const;
  for (const block of blocks) {
    it(`golden_${block}_matches_the_independently_computed_figures`, () => {
      const overview = overviewSchema.parse(goldenOverview());
      expect(overview[block]).toEqual(golden.expected[block]);
    });
  }

  it("profit_is_commission_minus_fee_tax_cashback_bonus_plus_clawback_netted (Block 2)", () => {
    const b = goldenOverview().business;
    expect(b.profit.value).toBe((b.commission.value ?? 0) - (b.fee.value ?? 0) - (b.tax.value ?? 0) - (b.cashback.value ?? 0) - (b.eventBonus.value ?? 0) + (b.clawbackNetted.value ?? 0));
    expect(b.cashbackPaid + b.cashbackOwed).toBe(b.cashback.value);
  });

  it("reversed_rejected_and_frozen_orders_are_in_no_money_line", () => {
    const b = goldenOverview().business;
    // O5 (REVERSED, 40,000) and O6 (FROZEN, 10,000) were approved in October too.
    expect(b.commission.value).toBe(210000);
    expect(b.approvedOrders.value).toBe(5);
  });

  it("a period with no approved order shows dashes (null), never 0 (LC-9, LC-15)", () => {
    const overview = overviewOf(freshLedger().db, { period: "thisMonth" }, fixedClock(golden.clock));
    expect(overview.business.profit).toEqual({ value: null, previous: null, change: null });
    expect(overview.business.commission.value).toBeNull();
    expect(overview.business.margin.bps).toBeNull();
    expect(overview.trend.totals.profit.value).toBeNull();
  });
});

describe("Story 4.17 acceptance criteria (server)", () => {
  it("AC1: eight payable customers give the Payouts tab's own count and sum", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('P8', 'DP00090', 'USER', 'ACTIVE')");
    const eight = [...FIXTURE.customers.map(([id]) => id), "P8"];
    expect(eight).toHaveLength(8);
    eight.forEach((id, i) => {
      addOrder(ledger, { id: `A${i}`, customer: id, cashback: 10000 + i * 1111 });
      addBank(ledger, id, { number: `00710000099${String(i).padStart(2, "0")}` });
    });
    const overview = overviewOf(ledger.db, { period: "thisMonth" }, CLOCK);
    servers = deskServers(ledger, CLOCK);
    const res = await deskGet(servers, "/api/admin/payouts?filter[queue]=PAYABLE", staffCookie(ledger, "tuan", CLOCK), CLOCK);
    const tab = payoutListResponseSchema.parse(res.json());
    expect(overview.todo.payable).toEqual({ customers: 8, amount: tab.summary["payable"] });
    expect(tab.queues.payable).toBe(8);
  });

  it("AC2: at 06:30 Vietnam time this month and today are the Vietnam day (regression: today and month in UTC)", () => {
    const ledger = freshLedger();
    const clock = fixedClock("2026-10-31T23:30:00.000Z"); // 1 November, 06:30 in Vietnam
    ledger.sqlite.exec(`
      INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, cashback_fee, cashback_tax, approved_at, recorded_at, origin) VALUES
        ('NOV', 'shopee', 'shopee', 'C1', 'APPROVED', 10000, 7122, 98, 1000, '2026-10-31T23:00:00.000Z', '2026-10-31T23:00:00.000Z', 'REPORT'),
        ('OCT', 'shopee', 'shopee', 'C1', 'APPROVED', 20000, 14243, 196, 2000, '2026-10-31T16:30:00.000Z', '2026-10-31T16:30:00.000Z', 'REPORT');
      INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, created_at, origin) VALUES
        ('F1', 'C1', 'shopee', 'shopee', 'FAILED', 'https://shopee.vn/p/9', '2026-10-31T17:30:00.000Z', 'REQUEST'),
        ('F2', 'C1', 'shopee', 'shopee', 'FAILED', 'https://shopee.vn/p/10', '2026-10-31T16:00:00.000Z', 'REQUEST');`);
    const month = overviewOf(ledger.db, { period: "thisMonth" }, clock);
    expect(month.period).toMatchObject({ from: "2026-11-01", to: "2026-11-01", previousFrom: "2026-10-01", previousTo: "2026-10-01" });
    expect(month.business.commission).toEqual({ value: 10000, previous: null, change: null });
    expect(month.todo.failedLinksToday).toBe(1);
    const today = overviewOf(ledger.db, { period: "today" }, clock);
    expect(today.period).toMatchObject({ from: "2026-11-01", to: "2026-11-01", previousFrom: "2026-10-31", previousTo: "2026-10-31" });
    expect(today.business.commission.previous).toBe(20000);
  });

  it("AC3 (server side): below 100 approved orders every ratio is the real value with enoughData false, never a placeholder", () => {
    const all = goldenOverview().orders.networks.find((n) => n.network === "all");
    expect(all?.cancelRate).toEqual({ bps: 3333, previousBps: 0, changeBps: 3333, enoughData: false });
    expect(goldenOverview().customers.repeatShare.enoughData).toBe(false);
  });

  it("AC5: HOUSE orders count in commission and profit, never in cashback, payables or customers", () => {
    const ledger = freshLedger();
    // A guest order whose stored cashback is wrongly above 0 still counts 0 cashback (D5).
    ledger.sqlite.exec(`INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, cashback_fee, cashback_tax, approved_at, recorded_at, origin) VALUES
      ('G1', 'shopee', 'shopee', 'HOUSE', 'APPROVED', 30000, 5000, 294, 3000, '2026-10-15T03:00:00.000Z', '2026-10-15T03:00:00.000Z', 'REPORT')`);
    const o = overviewOf(ledger.db, { period: "thisMonth" }, fixedClock(golden.clock));
    expect(o.business.commission.value).toBe(30000);
    expect(o.business.cashback.value).toBe(0);
    expect(o.business.profit.value).toBe(30000 - 294 - 3000);
    expect(o.todo.payable).toEqual({ customers: 0, amount: 0 });
    expect(o.money.weOweCustomers).toBe(0);
    expect(o.customers.withOrder.value).toBe(0);
    expect(o.customers.concentration).toBeNull();
  });

  it("AC6 (server side): each network's reconciliation counts on its own and the worst wins; one never seen while another ran is down; nothing ran is unknown", () => {
    const ledger = freshLedger();
    const run = (network: string, finished: string) =>
      ledger.sqlite.exec(`INSERT INTO reconciliation_runs (kind, network, window_from, window_to, started_at, finished_at, duration_ms, outcome) VALUES ('HOURLY', '${network}', '2026-10-23T00:00:00.000Z', '2026-10-30T00:00:00.000Z', '${finished}', '${finished}', 10, 'SUCCEEDED')`);
    const state = () => overviewOf(ledger.db, { period: "today" }, fixedClock(golden.clock)).health.find((h) => h.component === "reconciliation");
    expect(state()).toEqual({ component: "reconciliation", state: "unknown", at: null });
    run("shopee", "2026-10-30T04:30:00.000Z");
    expect(state()).toEqual({ component: "reconciliation", state: "down", at: "2026-10-30T04:30:00.000Z" });
    run("accesstrade", "2026-10-30T04:40:00.000Z");
    expect(state()).toEqual({ component: "reconciliation", state: "up", at: "2026-10-30T04:30:00.000Z" });
    // The clock moves on: Shopee's last success is now over 3 hours old while AccessTrade's is fresh.
    run("accesstrade", "2026-10-30T07:50:00.000Z");
    const later = overviewOf(ledger.db, { period: "today" }, fixedClock("2026-10-30T08:00:00.000Z")).health.find((h) => h.component === "reconciliation");
    expect(later).toEqual({ component: "reconciliation", state: "down", at: "2026-10-30T04:30:00.000Z" });
    expect(overviewOf(ledger.db, { period: "today" }, fixedClock(golden.clock)).health.filter((h) => h.component !== "reconciliation").every((h) => h.state === "unknown")).toBe(true);
  });

  it("an erased customer's awaiting order is estimated at 0 cashback (FR-35)", () => {
    const ledger = freshLedger();
    ledger.sqlite.exec(`INSERT INTO orders (order_id, network, platform, customer_id, status, estimated_commission, recorded_at, origin) VALUES ('E1', 'shopee', 'shopee', 'CE', 'AWAITING_APPROVAL', 25000, '2026-10-20T03:00:00.000Z', 'REPORT')`);
    expect(overviewOf(ledger.db, { period: "thisMonth" }, fixedClock(golden.clock)).money.awaiting).toEqual({ orders: 1, commission: 25000, cashback: 0 });
  });
});

describe("GET /api/admin/overview", () => {
  it("answers the contract for any staff role and refuses a custom period over 366 days", async () => {
    const ledger = payoutLedger();
    servers = deskServers(ledger, CLOCK);
    const cookie = staffCookie(ledger, "tuan", CLOCK);
    const ok = await deskGet(servers, "/api/admin/overview?period=last7", cookie, CLOCK);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(overviewSchema.parse(ok.json()).period.preset).toBe("last7");
    const custom = await deskGet(servers, "/api/admin/overview?period=custom&from=2026-10-01&to=2026-10-15", cookie, CLOCK);
    expect(overviewSchema.parse(custom.json()).period).toMatchObject({ from: "2026-10-01", to: "2026-10-15", previousFrom: "2026-09-16", previousTo: "2026-09-30" });
    const long = await deskGet(servers, "/api/admin/overview?period=custom&from=2025-01-01&to=2026-10-15", cookie, CLOCK);
    expect(long.statusCode).toBe(400);
    expect(errorOf(long.body).messageKey).toBe("error.overview.bad_period");
    const missing = await deskGet(servers, "/api/admin/overview?period=custom", cookie, CLOCK);
    expect(missing.statusCode).toBe(400);
  });

  it("review fix 5: only the period is the caller's mistake; a fault in the stored data is a 500, never bad_period", async () => {
    const ledger = payoutLedger();
    // A commission that is not whole dong can only come from a damaged ledger: packages/money refuses it with a RangeError.
    ledger.sqlite.exec("INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, approved_at, origin) VALUES ('BAD1', 'shopee', 'shopee', 'P1', 'APPROVED', 100.5, 0, '2026-10-20T03:00:00.000Z', 'REPORT')");
    servers = deskServers(ledger, CLOCK);
    const res = await deskGet(servers, "/api/admin/overview", staffCookie(ledger, "tuan", CLOCK), CLOCK);
    expect(res.statusCode).toBe(500);
    expect(errorOf(res.body).messageKey).not.toBe("error.overview.bad_period");
  });
});
