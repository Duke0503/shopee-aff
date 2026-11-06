/**
 * D69: owner alerts stop reporting what is already over, one captcha raises one alert, and the
 * captcha alert names the blocked page. The bridge and Telegram are fakes; no test reaches a network.
 */
import { bridgeResultSchema } from "@cashback/contracts";
import { instantFromMs, parseInstant, toMs, type Clock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { ownerJobs } from "../src/health/owner-jobs";
import { browserBridge, CAPTCHA_HOLD_MS, clearCaptchaHold, holdShopeeQueue, pauseShopeeQueue, resumeShopeeQueue, runProductLookups, ReportSourceError, shopeeBridgeSource, type BridgeTimer, type WindowedReportSource } from "../src/modules/linking/index";
import { alertsFor, assistantHeartbeats, commandAudit, deliverPendingAlerts, healthCheck, ledgerAlerts, parseAlertDetail, telegramText, type AlertSender, type HealthEntry } from "../src/modules/operations/index";
import { runReconciliation } from "../src/modules/orders/index";
import { linkEffectsFor } from "../src/links/link-jobs";
import type { Ledger, LedgerDb } from "../src/platform/db/ledger";
import type { AlertDetail } from "../src/platform/ports/alert.port";
import type { BridgePayoutRecordResult, BridgePort } from "../src/platform/ports/bridge.port";
import { runShopeePayoutRecords } from "../src/reconcile/payout-record.job";
import { answeringBridge, C1, linkLedger, memoryLogger, movingClock, queueLink, runLinks, SILENT } from "./helpers/link-ledger";
import { tempDir } from "./helpers/live-fixture";

const ledgers: Ledger[] = [];
afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
});

const NEVER = new AbortController().signal;
const MINUTE = 60_000;
const VERIFY_PAGE = "https://affiliate.shopee.vn/verify/traffic/error";
const LINK_URL = (subId1: string, subId2: string) => `https://shopee.vn/x?utm_content=${subId1}-${subId2}---`;

function setup() {
  const ledger = linkLedger(ledgers);
  const clock = movingClock();
  const sent: string[] = [];
  const sender: AlertSender = { send: async (text) => void sent.push(text) };
  const { logger, lines } = memoryLogger();
  return { ledger, clock, sent, lines, deliver: () => deliverPendingAlerts(ledger, sender, clock, logger) };
}

const raise = (ledger: Ledger, clock: Clock, kind: string, detail?: AlertDetail) => ledger.tx((db) => alertsFor(db, clock).alert(kind, "high", detail));
const rows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT kind, delivery FROM alerts ORDER BY id").all() as { kind: string; delivery: string }[];
const kinds = (ledger: Ledger) => rows(ledger).map((r) => r.kind);
function jobRow(ledger: Ledger, status: string, at: string, kind = "LINK", resultUrl: string | null = "https://s.shopee.vn/x"): void {
  const request = queueLink(ledger, C1);
  ledger.sqlite.prepare("INSERT INTO bridge_jobs (kind, status, request_id, customer_id, sub_id1, sub_id2, source_url, result_url, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, 'https://shopee.vn/x', ?, ?, ?)").run(kind, status, request, C1, C1, request, resultUrl, at, at);
}

/** A captcha met now: the queue held and the moment recorded, as the job that met it does. */
const captcha = (ledger: Ledger, clock: Clock) => ledger.tx((db) => holdShopeeQueue(db, "captcha", instantFromMs(toMs(clock.now()) + CAPTCHA_HOLD_MS), clock.now()));
const by = (ledger: Ledger, clock: Clock) => (db: LedgerDb) => commandAudit(db, clock, { kind: "system", id: "test" });

const WINDOW = { since: parseInstant("2026-10-01T00:00:00.000Z"), until: parseInstant("2026-10-02T00:00:00.000Z") };
const succeeds = (network: WindowedReportSource["network"]): WindowedReportSource => ({ network, read: async () => ({ network, source: "test", rows: [], skippedLines: 0, sha256: null }) });
const failsWith = (network: WindowedReportSource["network"], reason: string): WindowedReportSource => ({
  network,
  read: async () => {
    throw new ReportSourceError("report_fetch_failed", "the read failed", { reason });
  },
});
const reconcile = (ledger: Ledger, clock: Clock, source: WindowedReportSource) => runReconciliation("HOURLY", source, WINDOW, { ledger, clock, alerts: ledgerAlerts(ledger, clock), logger: SILENT, applyRow: () => { throw new Error("no rows"); } });

describe("D69: an alert whose condition ended is dropped at send time", () => {
  it("AC: a bridge_captcha held by its cooldown and a link job DONE before it is due is EXPIRED, unsent and counted once by kind", async () => {
    const { ledger, clock, sent, lines, deliver } = setup();
    raise(ledger, clock, "bridge_captcha", { source: "link_request" });
    await deliver();
    expect(sent).toHaveLength(1);

    clock.advance(MINUTE);
    const request = queueLink(ledger, C1, undefined, clock);
    const bridge = answeringBridge((job) => (bridge.jobs.length === 1 ? { outcome: "failed", reason: "captcha", blockedAt: VERIFY_PAGE } : { outcome: "link", url: LINK_URL(job.subId1, job.subId2) }));
    await runLinks(ledger, bridge, { clock });
    expect(rows(ledger)).toEqual([{ kind: "bridge_captcha", delivery: "SENT" }, { kind: "bridge_captcha", delivery: "PENDING" }]);

    clock.advance(6 * MINUTE);
    await runLinks(ledger, bridge, { clock });
    expect(ledger.sqlite.prepare("SELECT status FROM link_requests WHERE request_id = ?").get(request)).toEqual({ status: "ISSUED" });
    clock.advance(9 * MINUTE);
    const result = await deliver();

    expect(sent).toHaveLength(1);
    expect(result).toMatchObject({ sent: 0, failed: 0, dropped: 1 });
    expect(rows(ledger).at(-1)).toEqual({ kind: "bridge_captcha", delivery: "EXPIRED" });
    const logged = lines.filter((l) => l.includes("operations.alert.ended_alerts_dropped"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"dropped":{"bridge_captcha":1}');
    expect(logged[0]).toMatch(/"alerts":\[\{"id":\d+,"kind":"bridge_captcha"\}\]/);
  });

  it("a Shopee run that succeeded after the alert ends the captcha; another network's run does not", async () => {
    const shopee = setup();
    raise(shopee.ledger, shopee.clock, "bridge_captcha");
    shopee.clock.advance(MINUTE);
    await reconcile(shopee.ledger, shopee.clock, succeeds("shopee"));
    await shopee.deliver();
    expect(shopee.sent).toEqual([]);
    expect(rows(shopee.ledger)).toEqual([{ kind: "bridge_captcha", delivery: "EXPIRED" }]);

    const other = setup();
    raise(other.ledger, other.clock, "bridge_captcha");
    other.clock.advance(MINUTE);
    await reconcile(other.ledger, other.clock, succeeds("accesstrade"));
    await other.deliver();
    expect(other.sent).toHaveLength(1);
  });

  it("a captcha with no such evidence is sent: nothing since, only FAILED jobs, older successes, a lookup that may never have used the browser", async () => {
    for (const evidence of [
      () => undefined,
      (ledger: Ledger) => jobRow(ledger, "FAILED", "2026-11-01T03:01:00.000Z", "LINK", null),
      (ledger: Ledger) => jobRow(ledger, "DONE", "2026-11-01T02:59:00.000Z"),
      (ledger: Ledger) => jobRow(ledger, "DONE", "2026-11-01T03:00:00.000Z"),
      (ledger: Ledger) => jobRow(ledger, "DONE", "2026-11-01T03:01:00.000Z", "LOOKUP", null),
    ]) {
      const { ledger, clock, sent, deliver } = setup();
      raise(ledger, clock, "bridge_captcha");
      evidence(ledger);
      clock.advance(2 * MINUTE);
      await deliver();
      expect(sent).toHaveLength(1);
      expect(rows(ledger)).toEqual([{ kind: "bridge_captcha", delivery: "SENT" }]);
    }
  });

  it("a second captcha after the success keeps the waiting alert: a repeat does not move raised_at", async () => {
    const { ledger, clock, sent, deliver } = setup();
    raise(ledger, clock, "bridge_captcha");
    jobRow(ledger, "DONE", "2026-11-01T03:01:00.000Z");
    clock.advance(2 * MINUTE);
    captcha(ledger, clock);
    raise(ledger, clock, "bridge_captcha");
    clock.advance(10 * MINUTE); // The hold has run out by itself by now, unsolved.
    await deliver();
    expect(sent).toHaveLength(1);
  });

  it("a later page error hold does not lose the captcha, and an earlier clear does not end a later one", async () => {
    const pageError = setup();
    raise(pageError.ledger, pageError.clock, "bridge_captcha");
    jobRow(pageError.ledger, "DONE", "2026-11-01T03:01:00.000Z");
    pageError.clock.advance(2 * MINUTE);
    captcha(pageError.ledger, pageError.clock);
    pageError.clock.advance(6 * MINUTE); // The captcha hold ran out; a page error hold now takes its place.
    pageError.ledger.tx((db) => holdShopeeQueue(db, "page_error", instantFromMs(toMs(pageError.clock.now()) + MINUTE)));
    await pageError.deliver();
    expect(pageError.sent).toHaveLength(1);

    const cleared = setup();
    raise(cleared.ledger, cleared.clock, "bridge_captcha");
    captcha(cleared.ledger, cleared.clock);
    cleared.clock.advance(MINUTE);
    cleared.ledger.tx((db) => clearCaptchaHold(db, by(cleared.ledger, cleared.clock)(db), cleared.clock.now()));
    cleared.clock.advance(MINUTE);
    captcha(cleared.ledger, cleared.clock);
    raise(cleared.ledger, cleared.clock, "bridge_captcha");
    cleared.clock.advance(MINUTE);
    await cleared.deliver();
    expect(cleared.sent).toHaveLength(1);
  });

  it("a clear after the captcha drops the alert with nothing else after it: the bridge's, the owner's resume, or one slower than the hold", async () => {
    const steps: ((l: Ledger, c: Clock) => unknown)[] = [
      (l, c) => l.tx((db) => clearCaptchaHold(db, by(l, c)(db), c.now())),
      (l, c) => l.tx((db) => resumeShopeeQueue(db, by(l, c)(db), c.now())),
    ];
    for (const clear of steps) {
      const { ledger, clock, sent, deliver } = setup();
      captcha(ledger, clock);
      raise(ledger, clock, "bridge_captcha");
      clock.advance(MINUTE);
      clear(ledger, clock);
      await deliver();
      expect(sent).toEqual([]);
      expect(rows(ledger)).toEqual([{ kind: "bridge_captcha", delivery: "EXPIRED" }]);
    }
    const slow = setup();
    captcha(slow.ledger, slow.clock);
    raise(slow.ledger, slow.clock, "bridge_captcha");
    slow.clock.advance(CAPTCHA_HOLD_MS + MINUTE);
    expect(slow.ledger.tx((db) => clearCaptchaHold(db, by(slow.ledger, slow.clock)(db), slow.clock.now()))).toBe(false);
    await slow.deliver();
    expect(slow.sent).toEqual([]);
  });

  it("the owner's resume of a page error hold or a pause alone clears no captcha", async () => {
    const { ledger, clock, sent, deliver } = setup();
    captcha(ledger, clock);
    raise(ledger, clock, "bridge_captcha");
    clock.advance(CAPTCHA_HOLD_MS + MINUTE);
    ledger.tx((db) => holdShopeeQueue(db, "page_error", instantFromMs(toMs(clock.now()) + MINUTE)));
    ledger.tx((db) => resumeShopeeQueue(db, by(ledger, clock)(db), clock.now()));
    await deliver();
    expect(sent).toHaveLength(1);
  });

  it("a run that starts before the captcha and finishes after it leaves the alert sent", async () => {
    const { ledger, clock, sent, deliver } = setup();
    const straddling: WindowedReportSource = {
      network: "shopee",
      read: async () => {
        clock.advance(MINUTE);
        captcha(ledger, clock);
        raise(ledger, clock, "bridge_captcha");
        clock.advance(MINUTE);
        return { network: "shopee", source: "test", rows: [], skippedLines: 0, sha256: null };
      },
    };
    expect(await reconcile(ledger, clock, straddling)).toMatchObject({ outcome: "SUCCEEDED" });
    await deliver();
    expect(sent).toHaveLength(1);
  });

  it("a Shopee run between two captchas leaves the alert sent", async () => {
    const { ledger, clock, sent, deliver } = setup();
    captcha(ledger, clock);
    raise(ledger, clock, "bridge_captcha");
    clock.advance(MINUTE);
    await reconcile(ledger, clock, succeeds("shopee"));
    clock.advance(MINUTE);
    captcha(ledger, clock);
    raise(ledger, clock, "bridge_captcha");
    clock.advance(MINUTE);
    await deliver();
    expect(sent).toHaveLength(1);
  });

  it("reconciliation_failed is dropped only when each network's latest run succeeded after it", async () => {
    const { ledger, clock, sent, deliver } = setup();
    await reconcile(ledger, clock, failsWith("accesstrade", "x"));
    clock.advance(MINUTE);
    await reconcile(ledger, clock, succeeds("shopee"));
    clock.advance(MINUTE);
    raise(ledger, clock, "reconciliation_failed");
    clock.advance(MINUTE);
    await reconcile(ledger, clock, succeeds("shopee"));
    await reconcile(ledger, clock, failsWith("accesstrade", "x"));
    // One network still failing: told.
    await deliver();
    expect(sent).toHaveLength(1);

    const recovered = setup();
    await reconcile(recovered.ledger, recovered.clock, failsWith("accesstrade", "x"));
    raise(recovered.ledger, recovered.clock, "reconciliation_failed");
    recovered.clock.advance(MINUTE);
    await reconcile(recovered.ledger, recovered.clock, succeeds("shopee"));
    await reconcile(recovered.ledger, recovered.clock, succeeds("accesstrade"));
    await recovered.deliver();
    expect(recovered.sent).toEqual([]);
    expect(rows(recovered.ledger).at(-1)).toEqual({ kind: "reconciliation_failed", delivery: "EXPIRED" });
  });

  it("reconciliation_failed reads the hourly runs of the watched networks: a network with no run, or a nightly success, is no evidence", async () => {
    const unrun = setup();
    raise(unrun.ledger, unrun.clock, "reconciliation_failed");
    unrun.clock.advance(MINUTE);
    await reconcile(unrun.ledger, unrun.clock, succeeds("shopee"));
    await unrun.deliver();
    expect(unrun.sent).toHaveLength(1);

    const nightly = setup();
    raise(nightly.ledger, nightly.clock, "reconciliation_failed");
    nightly.clock.advance(MINUTE);
    await reconcile(nightly.ledger, nightly.clock, succeeds("shopee"));
    await runReconciliation("NIGHTLY", succeeds("accesstrade"), WINDOW, { ledger: nightly.ledger, clock: nightly.clock, alerts: ledgerAlerts(nightly.ledger, nightly.clock), logger: SILENT, applyRow: () => { throw new Error("no rows"); } });
    await nightly.deliver();
    expect(nightly.sent).toHaveLength(1);
  });

  it("reconciliation_failed with no run at all, or a network whose latest success came before it, is sent", async () => {
    const none = setup();
    raise(none.ledger, none.clock, "reconciliation_failed");
    await none.deliver();
    expect(none.sent).toHaveLength(1);

    const older = setup();
    await reconcile(older.ledger, older.clock, succeeds("accesstrade"));
    older.clock.advance(MINUTE);
    raise(older.ledger, older.clock, "reconciliation_failed");
    older.clock.advance(MINUTE);
    await reconcile(older.ledger, older.clock, succeeds("shopee"));
    await older.deliver();
    expect(older.sent).toHaveLength(1);
  });

  it("link_request_stuck is dropped once the request is not QUEUED, sent while it is or when the request is unknown", async () => {
    const { ledger, clock, sent, deliver } = setup();
    const waiting = queueLink(ledger, C1, "https://shopee.vn/a-i.1.2", clock);
    const moved = queueLink(ledger, C1, "https://shopee.vn/b-i.3.4", clock);
    ledger.sqlite.prepare("UPDATE link_requests SET status = 'ISSUED' WHERE request_id = ?").run(moved);
    const insert = ledger.sqlite.prepare("INSERT INTO alerts (kind, severity, raised_at, delivery, detail, dedup_key) VALUES ('link_request_stuck', 'high', ?, 'PENDING', ?, ?)");
    for (const id of [waiting, moved, "UNKNOWN1"]) insert.run(clock.now(), JSON.stringify({ source: "captcha", requestId: id }), `k:${id}`);
    const result = await deliver();
    expect(result).toMatchObject({ sent: 2, dropped: 1 });
    expect(sent).toHaveLength(2);
    expect(rows(ledger).map((r) => r.delivery)).toEqual(["SENT", "EXPIRED", "SENT"]);
  });

  it("any other kind is sent as today, whatever the ledger shows", async () => {
    const { ledger, clock, sent, deliver } = setup();
    raise(ledger, clock, "bridge_login_lost");
    jobRow(ledger, "DONE", "2026-11-01T03:01:00.000Z");
    clock.advance(2 * MINUTE);
    await deliver();
    expect(sent).toHaveLength(1);
  });

  it("the check runs again on a retry: an alert whose send failed is dropped once its condition has ended", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const { logger } = memoryLogger();
    raise(ledger, clock, "bridge_captcha");
    await deliverPendingAlerts(ledger, { send: async () => Promise.reject(new Error("down")) }, clock, logger);
    expect(rows(ledger)).toEqual([{ kind: "bridge_captcha", delivery: "PENDING" }]);
    jobRow(ledger, "DONE", "2026-11-01T03:01:00.000Z");
    clock.advance(2 * MINUTE);
    const sent: string[] = [];
    await deliverPendingAlerts(ledger, { send: async (t) => void sent.push(t) }, clock, logger);
    expect(sent).toEqual([]);
    expect(rows(ledger)).toEqual([{ kind: "bridge_captcha", delivery: "EXPIRED" }]);
  });
});

describe("D69: one captcha raises one alert", () => {
  it("two failed runs: reason captcha raises nothing and still records the run; another reason alerts", async () => {
    const { ledger, clock } = setup();
    await reconcile(ledger, clock, failsWith("shopee", "captcha"));
    const second = await reconcile(ledger, clock, failsWith("shopee", "captcha"));
    expect(second).toMatchObject({ outcome: "FAILED", errorCode: "report_fetch_failed" });
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM reconciliation_runs").get()).toEqual({ n: 2 });
    expect(kinds(ledger)).toEqual([]);

    await reconcile(ledger, clock, failsWith("shopee", "report_http_error"));
    expect(kinds(ledger)).toEqual(["reconciliation_failed"]);
  });

  /** A fake model with reconciliation down, and the health check around it. */
  function healthWith(state: { held: boolean; down: boolean }) {
    const raised: string[] = [];
    const clock = movingClock();
    const entry = (): HealthEntry => ({ component: "reconciliation", state: state.down ? "down" : "up", at: null, alert: state.down ? { kind: "reconciliation_failed", severity: "high" } : null });
    return { raised, check: healthCheck({ model: () => [entry()], alerts: { alert: (kind) => void raised.push(kind) }, clock, staleReconciliationByCaptcha: () => state.held }) };
  }

  it("stale health while held by a captcha raises nothing, the model still shows it down, and it alerts once the hold has ended", () => {
    const state = { held: true, down: true };
    const { raised, check } = healthWith(state);
    expect(check.run().model[0]).toMatchObject({ component: "reconciliation", state: "down" });
    check.run();
    expect(raised).toEqual([]);
    state.held = false;
    check.run();
    check.run();
    expect(raised).toEqual(["reconciliation_failed"]);
  });

  it("stale health with no hold alerts as today; a part already told is not told again after a hold", () => {
    const state = { held: false, down: true };
    const { raised, check } = healthWith(state);
    check.run();
    expect(raised).toEqual(["reconciliation_failed"]);
    state.held = true;
    check.run();
    state.held = false;
    check.run();
    expect(raised).toEqual(["reconciliation_failed"]);
  });

  it("a read refused during a captcha hold has the reason captcha and raises nothing; one refused for a page error or a pause alerts as today", async () => {
    const run = async (stop: (ledger: Ledger, clock: Clock) => void) => {
      const { ledger, clock } = setup();
      const { logger, lines } = memoryLogger();
      const bridge: BridgePort = { mode: "browser", createLink: async () => ({ outcome: "unavailable", reason: "no_bridge" }), readReportPage: async () => ({ outcome: "failed", reason: "report_http_error" }) };
      const source = shopeeBridgeSource({ bridge, ledger, clock, wait: async () => undefined, alerts: (db) => alertsFor(db, clock) });
      const deps = { ledger, clock, alerts: ledgerAlerts(ledger, clock), logger, applyRow: () => { throw new Error("no rows"); } };
      await runReconciliation("HOURLY", source, WINDOW, deps);
      stop(ledger, clock);
      await runReconciliation("HOURLY", source, WINDOW, deps);
      return { kinds: kinds(ledger), lines };
    };
    const held = await run(captcha);
    expect(held.kinds).toEqual([]);
    expect(held.lines.some((l) => l.includes("orders.reconciliation.read_failed") && l.includes('"reason":"captcha"'))).toBe(true);
    const pageError = await run((ledger, clock) => ledger.tx((db) => holdShopeeQueue(db, "page_error", instantFromMs(toMs(clock.now()) + MINUTE))));
    expect(pageError.kinds).toEqual(["reconciliation_failed"]);
    expect(pageError.lines.some((l) => l.includes('"reason":"queue_held"'))).toBe(true);
    const paused = await run((ledger, clock) => ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", clock.now())));
    expect(paused.kinds).toEqual(["reconciliation_failed"]);
    expect(paused.lines.some((l) => l.includes('"reason":"queue_paused"'))).toBe(true);
  });

  it("the health job of the start reads the real hold: a captcha hold keeps the stale alert back, a page error hold does not", async () => {
    const runHealth = async (hold: "captcha" | "page_error", accessTradeFresh = true) => {
      const { ledger, clock } = setup();
      await reconcile(ledger, clock, succeeds("shopee"));
      await reconcile(ledger, clock, succeeds("accesstrade"));
      clock.advance(9 * 60 * MINUTE);
      if (accessTradeFresh) await reconcile(ledger, clock, succeeds("accesstrade"));
      if (hold === "captcha") captcha(ledger, clock);
      else ledger.tx((db) => holdShopeeQueue(db, hold, instantFromMs(toMs(clock.now()) + 5 * MINUTE)));
      const heartbeats = assistantHeartbeats(null);
      const config = { env: "prod" as const, dataDir: tempDir("cashback-owner-"), backupOffsite: null, assistantToken: null, telegram: null };
      const job = ownerJobs({ config, ledger, clock, logger: SILENT, heartbeats, health: {} }).find((j) => j.name === "health");
      await job?.run(NEVER);
      return kinds(ledger);
    };
    expect(await runHealth("captcha")).not.toContain("reconciliation_failed");
    expect(await runHealth("page_error")).toContain("reconciliation_failed");
    // An AccessTrade outage is not hidden by a Shopee captcha.
    expect(await runHealth("captcha", false)).toContain("reconciliation_failed");
  });

  const payoutBridge = (answer: BridgePayoutRecordResult): BridgePort => ({ mode: "browser", createLink: async () => ({ outcome: "unavailable", reason: "no_bridge" }), readPayoutRecords: async () => answer });
  const read = (ledger: Ledger, clock: Clock, answer: BridgePayoutRecordResult) => runShopeePayoutRecords({ ledger, clock, bridge: payoutBridge(answer), logger: SILENT }, NEVER);
  const BLOCKED: BridgePayoutRecordResult = { outcome: "failed", reason: "captcha", blockedAt: VERIFY_PAGE };

  it("a payout read during a captcha hold raises no alert and fails as today, so the job tries again next hour", async () => {
    const { ledger, clock } = setup();
    captcha(ledger, clock);
    await expect(read(ledger, clock, BLOCKED)).rejects.toMatchObject({ code: "payout_record_unavailable", byCaptcha: true });
    expect(kinds(ledger)).toEqual([]);
  });

  it("a payout read held for a page error, paused by a lost login, without a browser or failing otherwise alerts as today", async () => {
    const pageError = setup();
    pageError.ledger.tx((db) => holdShopeeQueue(db, "page_error", parseInstant("2026-11-01T03:01:00.000Z")));
    await expect(read(pageError.ledger, pageError.clock, BLOCKED)).rejects.toMatchObject({ code: "payout_record_unavailable", byCaptcha: false });
    expect(kinds(pageError.ledger)).toEqual(["shopee_payout_record_unavailable"]);

    const lost = setup();
    lost.ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", lost.clock.now()));
    await expect(read(lost.ledger, lost.clock, BLOCKED)).rejects.toMatchObject({ byCaptcha: false });
    expect(kinds(lost.ledger)).toEqual(["shopee_payout_record_unavailable"]);

    const absent = setup();
    await expect(read(absent.ledger, absent.clock, { outcome: "unavailable", reason: "no_bridge" })).rejects.toMatchObject({ byCaptcha: false });
    expect(kinds(absent.ledger)).toEqual(["shopee_payout_record_unavailable"]);

    const other = setup();
    await expect(read(other.ledger, other.clock, { outcome: "failed", reason: "page_not_ready" })).rejects.toMatchObject({ code: "payout_record_failed" });
    expect(kinds(other.ledger)).toEqual(["shopee_payout_record_failed"]);
  });

  it("AC: one captcha during a reconcile and a payout read, both failing, tells the owner the captcha only", async () => {
    const { ledger, clock, sent, deliver } = setup();
    const { logger, lines: readLines } = memoryLogger();
    const bridge: BridgePort = { mode: "browser", createLink: async () => ({ outcome: "unavailable", reason: "no_bridge" }), readReportPage: async () => BLOCKED, readPayoutRecords: async () => BLOCKED };
    const source = shopeeBridgeSource({ bridge, ledger, clock, wait: async () => undefined, alerts: (db) => alertsFor(db, clock) });
    const run = () => runReconciliation("HOURLY", source, WINDOW, { ledger, clock, alerts: ledgerAlerts(ledger, clock), logger, applyRow: () => { throw new Error("no rows"); } });
    await run();
    clock.advance(6 * MINUTE); // The first hold ran out unsolved; the next run meets the captcha again.
    await run();
    clock.advance(6 * MINUTE);
    await expect(runShopeePayoutRecords({ ledger, clock, bridge, logger }, NEVER)).rejects.toMatchObject({ code: "payout_record_failed", byCaptcha: true, page: VERIFY_PAGE });
    await expect(runShopeePayoutRecords({ ledger, clock, bridge, logger }, NEVER)).rejects.toMatchObject({ code: "payout_record_unavailable", byCaptcha: true });

    expect(kinds(ledger)).toEqual(["bridge_captcha"]);
    await deliver();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(`Trang: ${VERIFY_PAGE}`);
    expect(readLines.some((l) => l.includes("orders.reconciliation.read_failed") && l.includes(`"page":"${VERIFY_PAGE}"`))).toBe(true);
    expect(readLines.some((l) => l.includes("payouts.payout_record.read_failed") && l.includes(`"page":"${VERIFY_PAGE}"`))).toBe(true);
  });
});

describe("D69: the blocked page, from the answer to the alert", () => {
  const TICKET = "a".repeat(32);

  it("the answer may carry origin and path, bounded; one without it is accepted; a query string or a fragment is refused", () => {
    const answer = { ticket: TICKET, outcome: "failed", reason: "captcha" };
    expect(bridgeResultSchema.parse(answer)).toEqual(answer);
    expect(bridgeResultSchema.parse({ ...answer, blockedAt: VERIFY_PAGE })).toEqual({ ...answer, blockedAt: VERIFY_PAGE });
    expect(bridgeResultSchema.safeParse({ ...answer, blockedAt: "https://shopee.vn/shop@name" }).success).toBe(true);
    for (const blockedAt of ["https://user:pw@shopee.vn/verify/x", "https://user@shopee.vn", `${VERIFY_PAGE}?a=1`, `${VERIFY_PAGE}#x`, "not a page", `https://shopee.vn/${"a".repeat(600)}`]) expect(bridgeResultSchema.safeParse({ ...answer, blockedAt }).success).toBe(false);
  });

  it("the browser bridge hands the page on for a link job and a lookup; without one the answer has none", async () => {
    const timer: BridgeTimer = { schedule: () => 0, cancel: () => undefined };
    const instance = "c".repeat(32);
    const bridge = browserBridge({ timer });
    const answerNext = async (extra: { blockedAt?: string }) => {
      const job = await bridge.work.next(instance, NEVER);
      bridge.work.deliver({ ticket: job?.ticket as string, outcome: "failed", reason: "captcha", ...extra }, instance);
    };
    const link = bridge.createLink({ jobId: 1, requestId: "R1", sourceUrl: "https://shopee.vn/x", subId1: "C1", subId2: "R1" }, NEVER);
    await answerNext({ blockedAt: VERIFY_PAGE });
    expect(await link).toEqual({ outcome: "failed", reason: "captcha", blockedAt: VERIFY_PAGE });
    const lookup = bridge.lookupProduct?.({ jobId: 2, requestId: "R1", url: "https://shopee.vn/x" }, NEVER);
    await answerNext({ blockedAt: VERIFY_PAGE });
    expect(await lookup).toEqual({ outcome: "failed", reason: "captcha", blockedAt: VERIFY_PAGE });
    const old = bridge.createLink({ jobId: 3, requestId: "R2", sourceUrl: "https://shopee.vn/x", subId1: "C1", subId2: "R2" }, NEVER);
    await answerNext({});
    expect(await old).toEqual({ outcome: "failed", reason: "captcha" });
  });

  it("a link job's captcha stores the page in the alert, shows it in the log line, and a lost login logs it too", async () => {
    const { ledger, clock } = setup();
    const { logger, lines } = memoryLogger();
    queueLink(ledger, C1, undefined, clock);
    await runLinks(ledger, answeringBridge(() => ({ outcome: "failed", reason: "captcha", blockedAt: VERIFY_PAGE })), { clock, logger });
    const stored = ledger.sqlite.prepare("SELECT detail FROM alerts WHERE kind = 'bridge_captcha'").get() as { detail: string };
    expect(parseAlertDetail(stored.detail)).toMatchObject({ source: "link_request", page: VERIFY_PAGE });
    expect(lines.some((l) => l.includes("linking.link.recorded") && l.includes(`"page":"${VERIFY_PAGE}"`))).toBe(true);

    const lost = setup();
    const logged = memoryLogger();
    queueLink(lost.ledger, C1, undefined, lost.clock);
    await runLinks(lost.ledger, answeringBridge(() => ({ outcome: "failed", reason: "login_redirect", blockedAt: "https://shopee.vn/buyer/login" })), { clock: lost.clock, logger: logged.logger });
    expect(logged.lines.some((l) => l.includes("linking.link_queue.paused") && l.includes('"page":"https://shopee.vn/buyer/login"'))).toBe(true);
  });

  it("a lookup answering a captcha on a fresh ledger logs the page and sends Trang: <page>", async () => {
    const { ledger, clock, sent, deliver } = setup();
    const { logger, lines } = memoryLogger();
    queueLink(ledger, C1, undefined, clock);
    const bridge: BridgePort = { ...answeringBridge((job) => ({ outcome: "link", url: LINK_URL(job.subId1, job.subId2) })), lookupProduct: async () => ({ outcome: "failed", reason: "captcha", blockedAt: VERIFY_PAGE }) };
    await runLinks(ledger, bridge, { clock });
    await runProductLookups({ ledger, clock, bridge, logger, effects: linkEffectsFor(clock) }, NEVER);
    expect(lines.some((l) => l.includes("linking.lookup.recorded") && l.includes(`"page":"${VERIFY_PAGE}"`))).toBe(true);
    await deliver();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(`Trang: ${VERIFY_PAGE}`);
  });

  it("a payout read answering a captcha on a fresh ledger sends Trang: <page>", async () => {
    const { ledger, clock, sent, deliver } = setup();
    const bridge: BridgePort = { mode: "browser", createLink: async () => ({ outcome: "unavailable", reason: "no_bridge" }), readPayoutRecords: async () => ({ outcome: "failed", reason: "captcha", blockedAt: VERIFY_PAGE }) };
    await expect(runShopeePayoutRecords({ ledger, clock, bridge, logger: SILENT }, NEVER)).rejects.toMatchObject({ byCaptcha: true });
    await deliver();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(`Trang: ${VERIFY_PAGE}`);
  });

  it("an old extension's answer is accepted: the alert has no page line", async () => {
    const { ledger, clock, sent, deliver } = setup();
    queueLink(ledger, C1, undefined, clock);
    await runLinks(ledger, answeringBridge(() => ({ outcome: "failed", reason: "captcha" })), { clock });
    await deliver();
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain("Trang:");
  });

  it("the Telegram line is escaped; a stored page that is not an address is ignored", () => {
    const base = { kind: "bridge_captcha", severity: "high" as const, suppressed: 0, raisedAt: "2026-11-01T03:00:00.000Z" };
    expect(telegramText({ ...base, detail: { source: "link_request", page: "https://shopee.vn/a<b>&c" } })).toContain("Trang: https://shopee.vn/a&lt;b&gt;&amp;c");
    expect(telegramText({ ...base, detail: { source: "link_request" } })).not.toContain("Trang:");
    expect(parseAlertDetail(JSON.stringify({ source: "link_request", page: `${VERIFY_PAGE}?a=1` }))).toEqual({ source: "link_request" });
    expect(parseAlertDetail(JSON.stringify({ source: "link_request", requestId: "R1", page: VERIFY_PAGE }))).toEqual({ source: "link_request", requestId: "R1", page: VERIFY_PAGE });
  });

  it("an alert refuses a page that is not an origin and a path, so free text cannot reach the table", () => {
    const { ledger, clock } = setup();
    expect(() => raise(ledger, clock, "bridge_captcha", { source: "link_request", page: `${VERIFY_PAGE}?sub=123` })).toThrow(RangeError);
    expect(() => raise(ledger, clock, "bridge_captcha", { source: "link_request", page: "https://user:pw@shopee.vn/verify/x" })).toThrow(RangeError);
  });
});
