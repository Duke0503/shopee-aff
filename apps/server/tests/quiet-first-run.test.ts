/**
 * Story 6.10: the quiet first run after the cutover (AD-16, AD-24, D46, FR-33). With
 * `messaging.silent` on, a reconciliation run's notifications are recorded as would-be sends and
 * none becomes due; the run reports them per event. Turning the flag off makes only later
 * notifications due; a key seeded as already told is a no-op either way; every change of the flag
 * is audited with its actor, and the cutover import turns it on.
 */
import { MESSAGING_SILENT_PATH } from "@cashback/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { runAdminCli, type CliIo } from "../src/admin/admin-cli";
import { adminCommandRoutes } from "../src/admin/admin-command.routes";
import { messagingSilentRoutes } from "../src/admin/messaging-silent.routes";
import { FirstRunRefusedError, runQuietFirstRun } from "../src/cutover/first-run";
import type { SourcedRow, WindowedReportSource } from "../src/modules/linking/index";
import { acknowledgeNotification, enqueue, handOutNext, isSilent, seedSentNotifications, setSilent, silentFlag, wasTold, wouldBeSends } from "../src/modules/messaging/index";
import { alertsFor, commandAudit } from "../src/modules/operations/index";
import type { Ledger } from "../src/platform/db/ledger";
import { INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { createLogger } from "../src/platform/log/logger";
import { logWouldBeSends, reportingWouldBeSends } from "../src/reconcile/reconcile-jobs";
import { memoryLogger } from "./helpers/link-ledger";
import { auditBy, buildLiveCopy, importOnce, TEST_CLOCK } from "./helpers/live-fixture";
import { approved, awaiting, closeLedgers, freshLedger, HOUR, movingClock } from "./helpers/order-ledger";
import { addStaff, generatedPassword } from "./helpers/staff-desk";
import { openLedger } from "../src/platform/db/ledger";

const SILENT_LOG = createLogger({ level: "fatal" });
const SYSTEM = { kind: "system", id: "test" } as const;
const INTERNAL = "i".repeat(40);

const servers: Servers[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await close(s);
  closeLedgers();
});

/** A saved report as a source: every row, whatever window is asked. */
function savedReport(rows: SourcedRow[]): WindowedReportSource {
  return { network: "shopee", read: () => Promise.resolve({ network: "shopee", source: "fake:shopee", rows, skippedLines: 0, sha256: null }) };
}

/** 30 awaiting and 5 approved new orders of C1: 40 events (an order first seen approved is recorded and approved). */
const fortyEvents = (prefix: string): SourcedRow[] => [...Array.from({ length: 30 }, (_, i) => awaiting(`${prefix}A${i}`)), ...Array.from({ length: 5 }, (_, i) => approved(`${prefix}B${i}`))];

const dueCount = (ledger: Ledger): number => (ledger.sqlite.prepare("SELECT count(*) AS n FROM outbox WHERE due_at IS NOT NULL AND sent_at IS NULL").get() as { n: number }).n;
const quiet = (ledger: Ledger, clock = TEST_CLOCK) => ledger.tx((db) => setSilent(db, true, clock.now(), commandAudit(db, clock, SYSTEM)));

describe("Story 6.10: quiet first run after cutover reports would-be sends", () => {
  it("AC1: with messaging.silent on, a reconciliation run enqueueing 40 events makes none due and its report lists the 40 would-be sends by event", async () => {
    const ledger = freshLedger();
    quiet(ledger);
    const report = await runQuietFirstRun({ ledger, clock: TEST_CLOCK, logger: SILENT_LOG, sources: [savedReport(fortyEvents("Q"))], production: true });
    expect(report.runs).toEqual([{ network: "shopee", outcome: "SUCCEEDED", applied: 35, errorCode: null }]);
    expect(report.wouldBeSends.total).toBe(40);
    expect(report.wouldBeSends.byEvent).toEqual({ "order:approved": 5, "order:recorded": 35 });
    expect(Object.values(report.wouldBeSends.byMessageKey).reduce((a, b) => a + b, 0)).toBe(40);
    expect(report.due).toBe(0);
    expect(dueCount(ledger)).toBe(0);
    expect(ledger.tx((db) => handOutNext(db, TEST_CLOCK, { dailyCap: 150, alerts: alertsFor(db, TEST_CLOCK) })).kind).toBe("none");
    // The report holds counts only: no order id, no customer.
    expect(JSON.stringify(report)).not.toMatch(/QA0|C1/);
  });

  it("AC1: the hourly job, while quiet, ends with one log line of the would-be sends by event", () => {
    const ledger = freshLedger();
    quiet(ledger);
    ledger.tx((db) => enqueue(db, TEST_CLOCK, { dedupKey: "order:X1:approved", customerId: "C1", messageKey: "order_approved", params: {} }, commandAudit(db, TEST_CLOCK, SYSTEM)));
    const { logger, lines } = memoryLogger();
    logWouldBeSends({ ledger, logger }, TEST_CLOCK.now(), "reconcile");
    const line = JSON.parse(lines.find((l) => l.includes("messaging.outbox.would_be_sends")) ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({ job: "reconcile", total: 1, byEvent: { "order:approved": 1 }, byMessageKey: { order_approved: 1 } });
    ledger.tx((db) => setSilent(db, false, TEST_CLOCK.now(), commandAudit(db, TEST_CLOCK, SYSTEM)));
    const after = memoryLogger();
    logWouldBeSends({ ledger, logger: after.logger }, TEST_CLOCK.now(), "reconcile");
    expect(after.lines.filter((l) => l.includes("would_be_sends"))).toEqual([]);
  });

  it("review 10: a run that fails still logs the would-be sends it recorded before it failed", async () => {
    const ledger = freshLedger();
    quiet(ledger);
    const { logger, lines } = memoryLogger();
    const failing = reportingWouldBeSends({ ledger, logger, clock: TEST_CLOCK }, "reconcile", async () => {
      ledger.tx((db) => enqueue(db, TEST_CLOCK, { dedupKey: "order:F1:recorded", customerId: "C1", messageKey: "order_recorded", params: {} }, commandAudit(db, TEST_CLOCK, SYSTEM)));
      throw new Error("source broke");
    });
    await expect(failing).rejects.toThrow("source broke");
    expect(lines.filter((l) => l.includes("messaging.outbox.would_be_sends")).map((l) => (JSON.parse(l) as { total: number }).total)).toEqual([1]);
  });

  it("the first run refuses to run with messaging.silent off, so it can never be the burst", async () => {
    const ledger = freshLedger();
    await expect(runQuietFirstRun({ ledger, clock: TEST_CLOCK, logger: SILENT_LOG, sources: [savedReport(fortyEvents("R"))], production: true })).rejects.toBeInstanceOf(FirstRunRefusedError);
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM orders").get()).toEqual({ n: 0 });
  });

  it("AC2: given the flag turned off, only the next events become due; the silent rows never do", async () => {
    const ledger = freshLedger();
    const clock = movingClock(TEST_CLOCK.now());
    ledger.sqlite.exec("UPDATE customers SET zalo_user_id = '70001' WHERE customer_id = 'C1'");
    quiet(ledger, clock);
    await runQuietFirstRun({ ledger, clock, logger: SILENT_LOG, sources: [savedReport(fortyEvents("S"))], production: true });
    clock.advance(HOUR);
    ledger.tx((db) => setSilent(db, false, clock.now(), commandAudit(db, clock, SYSTEM)));
    clock.advance(HOUR);
    const result = ledger.tx((db) => enqueue(db, clock, { dedupKey: "order:LATER1:approved", customerId: "C1", messageKey: "order_approved", params: {} }, commandAudit(db, clock, SYSTEM)));
    expect(result).toBe("enqueued");
    expect(dueCount(ledger)).toBe(1);
    const handOut = () => ledger.tx((db) => handOutNext(db, clock, { dailyCap: 150, alerts: alertsFor(db, clock) }));
    const first = handOut();
    expect(first.kind === "row" && first.row.dedupKey).toBe("order:LATER1:approved");
    if (first.kind === "row") ledger.tx((db) => acknowledgeNotification(db, clock, first.row.id, "sent", alertsFor(db, clock)));
    for (let day = 0; day < 10; day++) {
      clock.advance(24 * HOUR);
      expect(handOut().kind).not.toBe("row");
    }
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM outbox WHERE silenced_at IS NOT NULL AND (due_at IS NOT NULL OR sent_at IS NOT NULL OR attempts > 0)").get()).toEqual({ n: 0 });
    // A would-be send was never told, so no correction ever follows it.
    expect(ledger.tx((db) => wasTold(db, "order:SA0:recorded"))).toBe(false);
  });

  it("AC3: an event whose dedup key was seeded as already sent is a no-op in both modes", () => {
    const ledger = freshLedger();
    ledger.tx((db) => seedSentNotifications(db, [{ dedupKey: "order:SEEDED:approved", customerId: "C1", messageKey: "order_approved", sentAt: null }], TEST_CLOCK.now(), auditBy(db)));
    const enqueueSeeded = () => ledger.tx((db) => enqueue(db, TEST_CLOCK, { dedupKey: "order:SEEDED:approved", customerId: "C1", messageKey: "order_approved", params: {} }, auditBy(db)));
    expect(enqueueSeeded()).toBe("duplicate");
    quiet(ledger);
    expect(enqueueSeeded()).toBe("duplicate");
    expect(wouldBeSends(ledger.db, TEST_CLOCK.now()).total).toBe(0);
    expect(ledger.sqlite.prepare("SELECT origin, due_at, silenced_at FROM outbox").all()).toEqual([{ origin: "CUTOVER_SEED", due_at: null, silenced_at: null }]);
  });

  it("AC4: changing the flag is audited with the actor: the admin through the internal CLI; the same value again changes nothing", async () => {
    const ledger = freshLedger();
    const clock = movingClock(TEST_CLOCK.now());
    const password = generatedPassword();
    await addStaff(ledger, "duc", "ADMIN", password, { root: true });
    await addStaff(ledger, "minh", "EMPLOYEE", password);
    const s = buildServers({ clock, internalToken: INTERNAL, internal: [adminCommandRoutes({ ledger, clock }), messagingSilentRoutes({ ledger, clock })] });
    servers.push(s);
    const cli = async (argv: string[]) => {
      const lines: Record<string, unknown>[] = [];
      const io: CliIo = {
        call: async (method, url, body, headers) => {
          const res = await s.internalApp.inject({ method, url, headers: { [INTERNAL_TOKEN_HEADER]: INTERNAL, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
          return { status: res.statusCode, body: JSON.parse(res.body) as unknown };
        },
        secret: async () => password,
        readJson: () => null,
        print: (line) => void lines.push(line),
      };
      return { code: await runAdminCli(argv, io), lines };
    };
    expect((await s.internalApp.inject({ method: "POST", url: MESSAGING_SILENT_PATH, headers: { [INTERNAL_TOKEN_HEADER]: INTERNAL }, payload: { silent: true } })).statusCode).toBe(401);
    expect(await cli(["messaging-silent", "on", "--as", "minh"])).toMatchObject({ code: 1, lines: [{ ok: false, reason: "error.staff.admin_only" }] });
    expect(await cli(["messaging-silent", "loud", "--as", "duc"])).toMatchObject({ code: 1, lines: [{ ok: false, reason: "usage" }] });
    expect(await cli(["messaging-silent", "on", "--as", "duc"])).toEqual({ code: 0, lines: [{ ok: true, command: "messaging-silent", silent: true, changed: true }] });
    expect(isSilent(ledger.db)).toBe(true);
    expect(await cli(["messaging-silent", "on", "--as", "duc"])).toEqual({ code: 0, lines: [{ ok: true, command: "messaging-silent", silent: true, changed: false }] });
    clock.advance(HOUR);
    expect(await cli(["messaging-silent", "off", "--as", "duc"])).toMatchObject({ code: 0, lines: [{ silent: false, changed: true }] });
    expect(silentFlag(ledger.db)).toEqual({ silent: false, changedAt: clock.now(), changedBy: "staff:duc" });
    const audit = ledger.sqlite.prepare("SELECT event, entity_id, actor_kind, actor_id, payload FROM audit_entries WHERE event = 'messaging.settings.silent_changed' ORDER BY id").all();
    expect(audit).toEqual([
      { event: "messaging.settings.silent_changed", entity_id: "messaging.silent", actor_kind: "staff", actor_id: "duc", payload: '{"silent":true}' },
      { event: "messaging.settings.silent_changed", entity_id: "messaging.silent", actor_kind: "staff", actor_id: "duc", payload: '{"silent":false}' },
    ]);
  });

  it("the cutover import leaves the new ledger quiet, audited under the cutover actor", () => {
    const run = importOnce(buildLiveCopy());
    const ledger = openLedger(run.targetPath);
    try {
      expect(silentFlag(ledger.db)).toMatchObject({ silent: true, changedBy: "system:cutover" });
      expect(ledger.sqlite.prepare("SELECT actor_id FROM audit_entries WHERE event = 'messaging.settings.silent_changed'").all()).toEqual([{ actor_id: "cutover" }]);
    } finally {
      ledger.close();
    }
  });
});
