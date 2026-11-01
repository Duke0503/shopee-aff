/**
 * Story 4.22: the Shopee payout record page read through the bridge records each network payout
 * batch through the Story 4.21 recording, once (FR-19, D8, D59). The bridge is a fake port that
 * answers the page's rows as the extension would (amounts x100,000, Unix seconds); the browser
 * bridge's own queue is checked for the job's shape and its place in the order of service.
 */
import { splitCommission } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { browserBridge, readShopeePayoutRecords, type BridgeTimer } from "../src/modules/linking/index";
import { PAYOUT_RECORD_ALERTS, payoutRecordJobs, runShopeePayoutRecords } from "../src/reconcile/payout-record.job";
import type { Ledger } from "../src/platform/db/ledger";
import { createLogger } from "../src/platform/log/logger";
import type { BridgePayoutRecordResult, BridgePort } from "../src/platform/ports/bridge.port";
import { closeLedgers } from "./helpers/order-ledger";
import { CLOCK, payoutLedger } from "./helpers/payout-ledger";

afterEach(() => closeLedgers());

const SILENT = createLogger({ level: "fatal" });
const NEVER = new AbortController().signal;
const UNITS = 100_000;
const seconds = (iso: string): number => Date.parse(iso) / 1000;
const withheldNet = (gross: number): number => splitCommission({ approvedCommission: gross, network: "shopee", withheld: true }).net;

/** One row of the page as the extension answers it. */
function row(id: string, status: number, gross: number, received: number, created: string, arrived: string | null) {
  return { payoutId: id, payoutPaymentStatus: status, totalPaymentAmount: String(received * UNITS), eligibleTotalAmount: String(gross * UNITS), payoutCreatedTime: seconds(created), payArrivalTime: arrived === null ? 0 : seconds(arrived) };
}

const PAID = row("900002", 10, 100_000, withheldNet(100_000), "2026-09-28T03:00:00.000Z", "2026-10-01T03:00:00.000Z");
const PROCESSING = row("900003", 1, 50_000, withheldNet(50_000), "2026-10-02T03:00:00.000Z", null);
const FAILED = row("900004", 9, 20_000, withheldNet(20_000), "2026-10-05T03:00:00.000Z", null);

/** A bridge port that reads the payout record page by answering `answers` in turn, and counts the reads. */
function payoutBridge(...answers: BridgePayoutRecordResult[]): BridgePort & { reads: number } {
  const port = {
    mode: "browser" as const,
    reads: 0,
    createLink: async () => ({ outcome: "unavailable" as const, reason: "no_bridge" as const }),
    readPayoutRecords: async (): Promise<BridgePayoutRecordResult> => {
      port.reads++;
      return answers.length > 1 ? (answers.shift() as BridgePayoutRecordResult) : (answers[0] as BridgePayoutRecordResult);
    },
  };
  return port;
}

const page = (...rows: Record<string, unknown>[]): BridgePayoutRecordResult => ({ outcome: "value", value: { list: rows } });
const run = (ledger: Ledger, bridge: BridgePort) => runShopeePayoutRecords({ ledger, clock: CLOCK, bridge, logger: SILENT }, NEVER);
const settlements = (ledger: Ledger) => ledger.sqlite.prepare("SELECT network, network_payout_id, status, amount, eligible_amount, withheld, created_at, paid_at, match FROM network_settlements ORDER BY network_payout_id").all();
const count = (ledger: Ledger, table: string): number => (ledger.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const alertKinds = (ledger: Ledger) => (ledger.sqlite.prepare("SELECT kind FROM alerts ORDER BY id").all() as { kind: string }[]).map((a) => a.kind);

function addOrder(ledger: Ledger, id: string, gross: number, approvedAt: string, status: "APPROVED" | "PAID" = "APPROVED"): void {
  ledger.sqlite
    .prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, approved_at, paid_at, origin) VALUES (?, 'shopee', 'shopee', 'P1', ?, ?, 1000, ?, ?, 'REPORT')")
    .run(id, status, gross, approvedAt, status === "PAID" ? "2026-10-01T03:00:00.000Z" : null);
}

describe("Story 4.22 acceptance criteria", () => {
  it("AC1: three batches (paid, processing, failed) are each recorded once in whole dong with their times; a second run records nothing new", async () => {
    const ledger = payoutLedger();
    const bridge = payoutBridge(page(FAILED, PROCESSING, PAID));
    expect(await run(ledger, bridge)).toEqual({ batches: 3, recorded: 3, replays: 0, refused: 0 });
    const stored = settlements(ledger);
    expect(stored).toEqual([
      { network: "shopee", network_payout_id: "900002", status: "PAID", amount: withheldNet(100_000), eligible_amount: 100_000, withheld: 1, created_at: "2026-09-28T03:00:00.000Z", paid_at: "2026-10-01T03:00:00.000Z", match: expect.any(String) },
      { network: "shopee", network_payout_id: "900003", status: "PROCESSING", amount: withheldNet(50_000), eligible_amount: 50_000, withheld: 1, created_at: "2026-10-02T03:00:00.000Z", paid_at: null, match: "PENDING" },
      { network: "shopee", network_payout_id: "900004", status: "FAILED", amount: withheldNet(20_000), eligible_amount: 20_000, withheld: 1, created_at: "2026-10-05T03:00:00.000Z", paid_at: null, match: "PENDING" },
    ]);
    const audits = count(ledger, "audit_entries");
    expect(await run(ledger, bridge)).toEqual({ batches: 3, recorded: 0, replays: 3, refused: 0 });
    expect(settlements(ledger)).toEqual(stored);
    expect(count(ledger, "audit_entries")).toBe(audits);
  });

  it("AC2: a paid batch has its withholding classified from its amount against its eligible amount and is matched to its orders by the Story 4.21 rules", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, "W1", 30_000, "2026-09-25T03:00:00.000Z");
    addOrder(ledger, "W2", 40_000, "2026-09-27T03:00:00.000Z", "PAID");
    const earlier = row("900001", 10, 25_000, 25_000 - 245, "2026-09-24T03:00:00.000Z", "2026-09-27T03:00:00.000Z");
    // The page lists the newest batch first; the earlier one opens the later one's window.
    await run(ledger, payoutBridge(page(PAID, earlier)));
    expect(ledger.sqlite.prepare("SELECT network_payout_id, withheld, fee, tax, match, matched_gross, unattributed, window_from FROM network_settlements ORDER BY network_payout_id").all()).toEqual([
      { network_payout_id: "900001", withheld: 0, fee: 245, tax: 0, match: expect.any(String), matched_gross: expect.anything(), unattributed: expect.anything(), window_from: null },
      { network_payout_id: "900002", withheld: 1, fee: 980, tax: 10_000, match: "MATCHED", matched_gross: 70_000, unattributed: 30_000, window_from: "2026-09-24T03:00:00.000Z" },
    ]);
    expect(ledger.sqlite.prepare("SELECT order_id, network_batch_id FROM orders WHERE order_id IN ('W1', 'W2') ORDER BY order_id").all()).toEqual([
      { order_id: "W1", network_batch_id: "900002" },
      { order_id: "W2", network_batch_id: "900002" },
    ]);
  });

  it("AC3: rows without the known record shape, or with an unreadable amount, write nothing, fail the run loudly and raise an owner alert", async () => {
    const pages: BridgePayoutRecordResult[] = [
      page({ ...PAID, totalPaymentAmount: "12,5 trieu" }, PROCESSING),
      page(PAID, { ...PROCESSING, payoutPaymentStatus: 7 }),
      page({ ...PAID, payoutId: null }),
      page({ ...PAID, payoutCreatedTime: 0 }),
      { outcome: "value", value: { list: [{ ...PAID, bankAccount: "0123" }] } },
      { outcome: "value", value: { rows: [PAID] } },
    ];
    for (const answer of pages) {
      const ledger = payoutLedger();
      await expect(run(ledger, payoutBridge(answer))).rejects.toMatchObject({ code: "payout_record_unreadable" });
      expect(count(ledger, "network_settlements")).toBe(0);
      expect(count(ledger, "audit_entries")).toBe(0);
      expect(alertKinds(ledger)).toEqual([PAYOUT_RECORD_ALERTS.unreadable.kind]);
    }
    expect(readShopeePayoutRecords([PAID, { ...PAID, totalPaymentAmount: "1" }])).toMatchObject({ ok: false });
  });

  it("AC4: a captcha holds and the login page pauses the Shopee queue exactly as for a link job, and nothing is written; a held queue is not read", async () => {
    const ledger = payoutLedger();
    await expect(run(ledger, payoutBridge({ outcome: "failed", reason: "captcha" }))).rejects.toMatchObject({ code: "payout_record_failed" });
    expect(ledger.sqlite.prepare("SELECT held_reason, held_until IS NOT NULL AS held FROM link_queue_state").get()).toEqual({ held_reason: "captcha", held: 1 });
    expect(alertKinds(ledger)).toContain("bridge_captcha");
    const again = payoutBridge(page(PAID));
    await expect(run(ledger, again)).rejects.toMatchObject({ code: "payout_record_unavailable" });
    expect(again.reads).toBe(0);
    expect(count(ledger, "network_settlements")).toBe(0);

    const other = payoutLedger();
    await expect(run(other, payoutBridge({ outcome: "failed", reason: "login_redirect" }))).rejects.toMatchObject({ code: "payout_record_failed" });
    expect(other.sqlite.prepare("SELECT paused_reason FROM link_queue_state").get()).toEqual({ paused_reason: "login_redirect" });
    expect(alertKinds(other)).toContain("bridge_login_lost");
    expect(count(other, "network_settlements")).toBe(0);
  });

  it("AC5: the job reads page 1 only: it holds no page parameter, and the bridge serves it after a link like a report page", async () => {
    const timer: BridgeTimer = { schedule: () => 0, cancel: () => undefined };
    const bridge = browserBridge({ timer, makeTicket: (() => { let n = 0; return () => (++n).toString(16).padStart(32, "0"); })() });
    const payout = bridge.readPayoutRecords(NEVER);
    const link = bridge.createLink({ jobId: 1, requestId: "R1", sourceUrl: "https://shopee.vn/Ao-i.11001.22001", subId1: "C1", subId2: "R1" }, NEVER);
    const instance = "c".repeat(32);
    const first = await bridge.work.next(instance, NEVER);
    expect(first?.kind).toBe("link");
    bridge.work.deliver({ ticket: first!.ticket, outcome: "failed", reason: "no_link" }, instance);
    await link;
    const second = await bridge.work.next(instance, NEVER);
    expect(second).toEqual({ ticket: second!.ticket, kind: "payout_record", timeoutMs: 90_000 });
    bridge.work.deliver({ ticket: second!.ticket, outcome: "value", value: { list: [] } }, instance);
    expect(await payout).toEqual({ outcome: "value", value: { list: [] } });
  });

  it("review 9: a read the bridge could not serve raises a warning; the hourly job tries again from 09:30 until one read of the day succeeds", async () => {
    const ledger = payoutLedger();
    let now = "2026-10-31T02:00:00.000Z";
    const clock = { now: () => now as ReturnType<typeof CLOCK.now> };
    const bridge = payoutBridge({ outcome: "unavailable", reason: "no_bridge" }, { outcome: "unavailable", reason: "no_bridge" }, page(PAID));
    const [job] = payoutRecordJobs({ ledger, clock, bridge, logger: SILENT });
    await job!.run(NEVER);
    expect(bridge.reads).toBe(0);
    now = "2026-10-31T02:30:00.000Z";
    await expect(job!.run(NEVER)).rejects.toMatchObject({ code: "payout_record_unavailable" });
    expect(alertKinds(ledger)).toEqual([PAYOUT_RECORD_ALERTS.unavailable.kind]);
    now = "2026-10-31T03:30:00.000Z";
    await expect(job!.run(NEVER)).rejects.toMatchObject({ code: "payout_record_unavailable" });
    now = "2026-10-31T04:30:00.000Z";
    await job!.run(NEVER);
    expect(bridge.reads).toBe(3);
    expect(count(ledger, "network_settlements")).toBe(1);
    now = "2026-10-31T05:30:00.000Z";
    await job!.run(NEVER);
    expect(bridge.reads).toBe(3);
    now = "2026-11-01T02:30:00.000Z";
    await job!.run(NEVER);
    expect(bridge.reads).toBe(4);
  });

  it("the job exists only when the bridge reads the payout record page (the real browser), every hour", () => {
    const ledger = payoutLedger();
    expect(payoutRecordJobs({ ledger, clock: CLOCK, bridge: payoutBridge(page()), logger: SILENT }).map((j) => [j.name, j.schedule])).toEqual([["payoutRecords", { kind: "every", delayMs: 3_600_000 }]]);
    const fake: BridgePort = { mode: "fake", createLink: async () => ({ outcome: "unavailable", reason: "no_bridge" }) };
    expect(payoutRecordJobs({ ledger, clock: CLOCK, bridge: fake, logger: SILENT })).toEqual([]);
  });
});
