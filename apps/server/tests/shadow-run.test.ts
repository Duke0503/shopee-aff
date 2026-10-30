/**
 * Story 2.9 (D44): the shadow run applies the new reconciliation to a read-only copy of the live
 * ledger and the saved reports, writes nothing to the copy, and produces a per-order and
 * per-customer report for the owner's sign-off. The fixtures carry the cancelled-but-payable
 * incident: live orders still owed although the report carries an order-level cancel or a
 * cancelled item.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixedClock, parseInstant } from "@cashback/core";
import { splitCommission } from "@cashback/money";
import Database from "better-sqlite3";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LIVE_PAYABLE_SQL } from "../src/cutover/shadow-ledger";
import type { ShadowOrder } from "../src/cutover/shadow-evaluate";
import type { ShadowReport } from "../src/cutover/shadow-report";
import { runShadow, sha256File, SHADOW_JSON, SHADOW_MARKDOWN, SHADOW_SIGN_OFF, signShadowReport, windowOf, type ShadowRunOptions } from "../src/cutover/shadow-run";
import { SHADOW_REASONS } from "../src/cutover/shadow-reasons";
import { accessTradeFileSource, ReportSourceError, shopeeFileSource } from "../src/modules/linking/index";
import { commandAudit } from "../src/modules/operations/index";
import { markSettlementPeriod } from "../src/modules/orders/index";
import { createLogger } from "../src/platform/log/logger";
import { buildLiveCopy, LIVE_LEDGER_PATH, TEST_ACTOR, TEST_CLOCK, tempDir } from "./helpers/live-fixture";
import { apply, approved, awaiting, closeLedgers, freshLedger } from "./helpers/order-ledger";

const SHADOW = fileURLToPath(new URL("./fixtures/shadow", import.meta.url));
const fixture = (name: string) => join(SHADOW, name);
const INCIDENTS = readFileSync(fixture("live-incidents.sql"), "utf8");

const C1 = "1000000000000000001";
const C2 = "1000000000000000002";
const C3 = "1000000000000000003";
const C5 = "1000000000000000005";

function options(source: string, outDir: string, overrides: Partial<ShadowRunOptions> = {}): ShadowRunOptions {
  return {
    sourcePath: source,
    liveLedgerPath: LIVE_LEDGER_PATH,
    sources: [
      { source: shopeeFileSource({ path: fixture("shopee-report.json") }) },
      { source: accessTradeFileSource(fixture("accesstrade-transactions.json")) },
    ],
    outDir,
    clock: TEST_CLOCK,
    logger: createLogger({ destination: { write: () => undefined } }),
    ...overrides,
  };
}

const cashbackOf = (commission: number, network: "shopee" | "accesstrade" = "shopee") => splitCommission({ approvedCommission: commission, network, withheld: true }).cashback;

describe("the shadow run over the incident fixtures", () => {
  let source: string;
  let out: string;
  let report: ShadowReport;
  let before: string;
  let liveDir: string[];
  const order = (id: string): ShadowOrder => {
    const found = report.orders.find((o) => o.orderId === id);
    if (!found) throw new Error(`no order ${id}`);
    return found;
  };

  beforeAll(async () => {
    source = buildLiveCopy({ extraSql: INCIDENTS });
    before = sha256File(source);
    liveDir = readdirSync(dirname(source)).sort();
    out = join(tempDir("cashback-shadow-"), "run");
    report = await runShadow(options(source, out));
  });

  it("AC1: lists per order the current state, the expected transition, the amount difference and the reason", () => {
    const approved = order("260913CCCC0003");
    expect(approved).toMatchObject({ live: { status: "AWAITING_APPROVAL", payable: 0 }, shadow: { status: "APPROVED", cashback: cashbackOf(5000) }, steps: ["AWAITING_APPROVAL->APPROVED"], reason: "approved_by_report", changed: true });
    expect(approved.payableDifference).toBe(cashbackOf(5000));
    expect(approved.waitingDifference).toBe(-cashbackOf(5000));
    expect(order("260912BBBB0002")).toMatchObject({ customerId: C2, live: { status: "APPROVED", payable: 0 }, shadow: { status: "APPROVED", payable: 14243 + 20000 }, reason: "live_orphan_owed" });
    expect(order("261004MMMM0013").reason).toBe("cancelled_item_counted");
    const md = readFileSync(join(out, SHADOW_MARKDOWN), "utf8");
    expect(md).toContain(`### ${SHADOW_REASONS.approved_by_report} (1)`);
    expect(md).toContain("| 260913CCCC0003 | shopee | 1000000000000000003 | AWAITING_APPROVAL | APPROVED");
  });

  it("AC2: orders live keeps owed despite an order-level cancel or a cancelled item would be REJECTED, REVERSED or frozen, not payable", () => {
    expect(order("261002KKKK0011")).toMatchObject({ live: { status: "APPROVED", payable: 7128 }, shadow: { status: "REVERSED", payable: 0 }, reason: "order_cancel_ignored_by_first_item", payableDifference: -7128 });
    expect(order("261002KKKK0011").reviewCases).toEqual(["cancel_after_approval"]);
    expect(order("261003LLLL0012")).toMatchObject({ live: { status: "AWAITING_APPROVAL" }, shadow: { status: "REJECTED", waiting: 0 }, reason: "order_cancel_ignored_by_first_item", waitingDifference: -cashbackOf(5000) });
    expect(order("261004MMMM0013")).toMatchObject({ live: { status: "APPROVED", payable: 14256 }, shadow: { status: "FROZEN", payable: 0 }, reason: "cancelled_item_counted", detail: "commission_drop", payableDifference: -14256 });
    expect(order("TT0000000000000017")).toMatchObject({ network: "accesstrade", shadow: { status: "REVERSED" }, reason: "cancelled_by_report", payableDifference: -10500 });
    expect(order("261005NNNN0014")).toMatchObject({ live: { status: "REJECTED" }, shadow: { status: "REJECTED" }, reason: "first_item_cancel_rejected_order", changed: true });

    const byReason = Object.fromEntries(report.summary.byReason.map((r) => [r.reason, r]));
    expect(byReason["order_cancel_ignored_by_first_item"]).toMatchObject({ orders: 2, payableDifference: -7128, waitingDifference: -cashbackOf(5000) });
    expect(byReason["cancelled_item_counted"]).toMatchObject({ orders: 1, payableDifference: -14256 });
    expect(report.summary.overpaid).toEqual([
      { customerId: C1, amount: 7128 + 10500 },
      { customerId: C5, amount: 14256 - cashbackOf(12000, "accesstrade") },
    ]);
    const md = readFileSync(join(out, SHADOW_MARKDOWN), "utf8");
    expect(md).toContain(`### ${SHADOW_REASONS.order_cancel_ignored_by_first_item} (2)`);
    expect(md).toContain("live first-item status ignored an order-level cancel");
    expect(md).toContain("## Customers live would have overpaid");
  });

  it("AC3: every customer shows the named live-payable SQL figure, the shadow payable and their difference", () => {
    const db = new Database(source, { readonly: true });
    const live = new Map((db.prepare(LIVE_PAYABLE_SQL).all() as { customer_id: string; cashback: number; bonus: number }[]).map((r) => [r.customer_id, r.cashback + r.bonus]));
    // payouts.py collect() and campaigns.py bonus_owed(), as the live code runs them.
    const collect = db
      .prepare(
        "SELECT o.customer_id, SUM(COALESCE(o.cashback_amount, 0)) AS amount, (SELECT COALESCE(SUM(w.amount), 0) FROM campaign_awards w WHERE w.status = 'confirmed' AND w.order_id IN (SELECT o2.order_id FROM orders o2 WHERE o2.customer_id = o.customer_id AND o2.status = 'approved' AND o2.paid_at IS NULL)) AS bonus FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.status = 'approved' AND o.paid_at IS NULL AND COALESCE(c.role, 'user') != 'house' GROUP BY o.customer_id",
      )
      .all() as { customer_id: string; amount: number; bonus: number }[];
    db.close();
    expect(new Map(collect.map((r) => [r.customer_id, r.amount + r.bonus]))).toEqual(live);
    for (const c of report.customers) {
      expect(c.livePayable).toBe(live.get(c.customerId) ?? 0);
      expect(c.payableDifference).toBe((c.shadowPayable) - (c.livePayable ?? 0));
    }
    const c1 = report.customers.find((c) => c.customerId === C1);
    expect(c1).toMatchObject({ livePayable: 7128 + 10500, shadowPayable: 0, clawbacks: 6232, payableDifference: -17628 });
    expect(report.customers.find((c) => c.customerId === C2)).toMatchObject({ livePayable: 0, shadowPayable: 14243 + 20000, payableDifference: 14243 + 20000 });
    expect(report.customers.find((c) => c.customerId === C3)).toMatchObject({ livePayable: 0, shadowPayable: cashbackOf(5000) });
    expect(report.customers.map((c) => c.customerId)).not.toContain("HOUSE");
  });

  it("AC4: an unpaid order older than the report window would be FROZEN with a review case; one missing inside it is listed too", () => {
    expect(order("260601OOOO0015")).toMatchObject({ live: { status: "AWAITING_APPROVAL" }, shadow: { status: "FROZEN", waiting: 0 }, steps: ["AWAITING_APPROVAL->FROZEN"], reviewCases: ["not_in_report"], reason: "older_than_report_window" });
    expect(order("261006PPPP0016")).toMatchObject({ shadow: { status: "FROZEN" }, reviewCases: ["not_in_report"], reason: "missing_from_report" });
    expect(report.inputs.reports.find((r) => r.network === "shopee")?.windowFrom).toBe("2026-09-11T06:11:00.000Z");
  });

  it("an order whose live customer id is no customer is a live orphan, never in live payable (payouts.collect)", () => {
    expect(report.liveOrphanOwed).toEqual([{ orderId: "260912BBBB0002", liveCustomerId: "9000000000000000002", importedCustomerId: C2, cashback: 14243, bonus: 20000 }]);
    expect(readFileSync(join(out, SHADOW_MARKDOWN), "utf8")).toContain("| 260912BBBB0002 | 9000000000000000002 | 1000000000000000002 | 14,243 | 20,000 |");
  });

  it("a HELD bonus is never payable; only a CONFIRMED one is, as bonus_owed()", () => {
    expect(order("260913CCCC0003").shadow.payable).toBe(cashbackOf(5000));
    expect(order("260912BBBB0002").shadow.payable).toBe(14243 + 20000);
  });

  it("an unpaid order recorded after the report window ends is newer, not missing, and not frozen", () => {
    expect(report.inputs.reports.find((r) => r.network === "shopee")).toMatchObject({ windowFrom: "2026-09-11T06:11:00.000Z", windowTo: "2026-10-07T03:00:00.000Z" });
    expect(order("261020SSSS0022")).toMatchObject({ live: { status: "AWAITING_APPROVAL" }, shadow: { status: "AWAITING_APPROVAL" }, steps: [], reviewCases: [], reason: "newer_than_report_window", changed: false });
    expect(report.summary.notJudged).toMatchObject({ newer_than_report_window: 1 });
    expect(report.summary.byReason.map((r) => r.reason)).not.toContain("newer_than_report_window");
  });

  it("each report's sha256 is of the exact bytes its source parsed", () => {
    for (const [network, file] of [["shopee", "shopee-report.json"], ["accesstrade", "accesstrade-transactions.json"]] as const) {
      expect(report.inputs.reports.find((r) => r.network === network)?.sha256).toBe(sha256File(fixture(file)));
    }
  });

  it("AC5: the same inputs give byte-identical files, and the live copy is unchanged", async () => {
    expect(sha256File(source)).toBe(before);
    // SQLite readers of a WAL file create empty -wal and -shm beside it; nothing is written into them.
    for (const file of readdirSync(dirname(source)).filter((f) => !liveDir.includes(f))) {
      expect(file).toMatch(/-(wal|shm)$/);
      if (file.endsWith("-wal")) expect(statSync(join(dirname(source), file)).size).toBe(0);
    }
    expect(readdirSync(out).sort()).toEqual([SHADOW_JSON, SHADOW_MARKDOWN]);
    const again = join(tempDir("cashback-shadow-"), "run");
    await runShadow(options(source, again, { clock: fixedClock("2027-01-01T00:00:00.000Z") }));
    for (const file of [SHADOW_JSON, SHADOW_MARKDOWN]) expect(readFileSync(join(again, file))).toEqual(readFileSync(join(out, file)));
    expect(report.inputs.liveCopy.sha256).toBe(before);
    expect(sha256File(source)).toBe(before);
  });

  it("AC6: a PAID order never changes state; a cancel after payout is only a would-be clawback", () => {
    expect(order("260911AAAA0001")).toMatchObject({ live: { status: "PAID" }, shadow: { status: "PAID", clawback: 6232 }, steps: [], reason: "clawback_after_payout", reviewCases: ["cancel_after_payout"] });
    for (const o of report.orders.filter((x) => x.live.status === "PAID")) {
      expect(o.shadow.status).toBe("PAID");
      expect(o.steps).toEqual([]);
    }
  });

  it("paid totals match to the dong through the import's paid parity", () => {
    expect(report.paidParity).toMatchObject({ result: "pass", mismatches: [] });
    for (const c of report.customers) expect(c.shadowPaid).toBe(c.livePaid);
  });

  it("records report orders the live ledger lacks, attributed by the new rule", () => {
    expect(order("261002KKKK0018")).toMatchObject({ customerId: C1, live: { status: null }, shadow: { status: "AWAITING_APPROVAL", waiting: cashbackOf(3000) }, reason: "not_in_live_ledger" });
    expect(order("TT0000000000000020")).toMatchObject({ customerId: C5, shadow: { status: "APPROVED", payable: cashbackOf(12000, "accesstrade") }, reason: "not_in_live_ledger" });
    expect(order("261007QQQQ0019")).toMatchObject({ customerId: null, shadow: { status: null }, reviewCases: ["unattributed"], reason: "unattributed_report_row" });
  });

  it("leaves orders of no network and orders it cannot judge unchanged", () => {
    expect(order("260918HHHH0008")).toMatchObject({ reason: "unknown_network", changed: false });
    expect(order("260916FFFF0006")).toMatchObject({ live: { status: "FROZEN" }, shadow: { status: "FROZEN" }, changed: false });
  });

  it("records the sign-off once with name, time and checksums, and never writes over a signed folder", async () => {
    const signOff = signShadowReport(out, " Owner Name ", fixedClock("2026-11-01T02:00:00.000Z"));
    expect(signOff).toEqual({ name: "Owner Name", signedAt: "2026-11-01T02:00:00.000Z", reportSha256: sha256File(join(out, SHADOW_JSON)), markdownSha256: sha256File(join(out, SHADOW_MARKDOWN)), paidParity: "pass", changedOrders: report.summary.changed });
    expect(JSON.parse(readFileSync(join(out, SHADOW_SIGN_OFF), "utf8"))).toEqual(signOff);
    expect(() => signShadowReport(out, "Someone", TEST_CLOCK)).toThrow(expect.objectContaining({ code: "signed_off" }));
    await expect(runShadow(options(source, out))).rejects.toMatchObject({ code: "signed_off" });
    expect(() => signShadowReport(join(out, "missing"), "x", TEST_CLOCK)).toThrow(expect.objectContaining({ code: "report_missing" }));
    expect(() => signShadowReport(out, "  ", TEST_CLOCK)).toThrow(expect.objectContaining({ code: "name_missing" }));
  });
});

describe("the window a source was read for (--accesstrade-api --since --until)", () => {
  it("is AccessTrade's report window, over the run's default from the purchases", async () => {
    const source = buildLiveCopy({ extraSql: INCIDENTS });
    const window = { from: parseInstant("2026-10-01T17:00:00.000Z"), to: parseInstant("2026-10-30T16:59:59.999Z") };
    const sources = [{ source: accessTradeFileSource(fixture("accesstrade-transactions.json")), window }];
    const report = await runShadow(options(source, join(tempDir("cashback-shadow-"), "run"), { sources }));
    expect(report.inputs.reports).toEqual([expect.objectContaining({ network: "accesstrade", windowFrom: window.from, windowTo: window.to })]);
    expect(windowOf([], undefined, { windowFrom: window.from })).toEqual({ from: window.from, to: null });
  });
});

describe("shadow run refusals", () => {
  it("refuses without LIVE_LEDGER_PATH and refuses the live production file itself", async () => {
    const source = buildLiveCopy();
    const out = join(tempDir("cashback-shadow-"), "run");
    await expect(runShadow(options(source, out, { liveLedgerPath: null }))).rejects.toMatchObject({ code: "live_ledger_path_missing" });
    await expect(runShadow(options(source, out, { liveLedgerPath: source }))).rejects.toMatchObject({ code: "live_production_file" });
    expect(existsSync(out)).toBe(false);
  });

  it("a source at its page cap fails the run before the live copy is read, and writes nothing", async () => {
    const source = buildLiveCopy();
    const out = join(tempDir("cashback-shadow-"), "run");
    const capped = { network: "shopee" as const, read: () => Promise.reject(new ReportSourceError("report_page_cap", "cap")) };
    await expect(runShadow(options(source, out, { sources: [{ source: capped }] }))).rejects.toMatchObject({ code: "report_page_cap" });
    expect(existsSync(out)).toBe(false);
  });

  it("refuses two sources for one network", async () => {
    const source = buildLiveCopy();
    const s = { source: shopeeFileSource({ path: fixture("shopee-report.json") }) };
    await expect(runShadow(options(source, join(tempDir("cashback-shadow-"), "run"), { sources: [s, s] }))).rejects.toMatchObject({ code: "duplicate_source" });
  });
});

describe("the shadow run and the ledger apply read one withheld setting (D54, D44)", () => {
  afterEach(closeLedgers);

  it("with the approval month unmarked, the shadow stores what the ledger apply stores; AccessTrade stays withheld", async () => {
    const source = buildLiveCopy({ extraSql: INCIDENTS });
    const marks = new Map([["shopee|2026-10", false], ["accesstrade|2026-10", false]]);
    const report = await runShadow(options(source, join(tempDir("cashback-shadow-"), "run"), { periodMarks: marks }));
    const shadowOf = (id: string) => report.orders.find((o) => o.orderId === id);
    const notWithheld = splitCommission({ approvedCommission: 5000, network: "shopee", withheld: false }).cashback;
    expect(shadowOf("260913CCCC0003")).toMatchObject({ steps: ["AWAITING_APPROVAL->APPROVED"], shadow: { status: "APPROVED", cashback: notWithheld } });
    expect(shadowOf("TT0000000000000020")).toMatchObject({ shadow: { status: "APPROVED", payable: cashbackOf(12000, "accesstrade") } });

    const ledger = freshLedger();
    ledger.tx((db) => markSettlementPeriod(db, { network: "shopee", periodMonth: "2026-10", withheld: false }, commandAudit(db, TEST_CLOCK, TEST_ACTOR)));
    apply(ledger, awaiting("261020SHDW0001", [5000]));
    apply(ledger, approved("261020SHDW0001", [5000]));
    expect(ledger.sqlite.prepare("SELECT cashback FROM orders WHERE order_id = '261020SHDW0001'").get()).toEqual({ cashback: notWithheld });
  });
});
