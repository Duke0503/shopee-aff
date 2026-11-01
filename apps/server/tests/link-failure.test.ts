/**
 * Story 5.5: captcha, page errors and a lost login pause or fail requests safely (AD-14, AD-27,
 * D8). A captcha or a page error is retried uncounted and holds the Shopee queue with one owner
 * alert; three counted failures fail the request and tell its customer (never a guest); a login
 * redirect pauses the queue with a critical alert until the owner resumes it by command.
 */
import { fixedClock, instantFromMs, parseInstant, toMs } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { runAdminCli, type CliIo } from "../src/admin/admin-cli";
import { adminCommandRoutes } from "../src/admin/admin-command.routes";
import { linkQueueRoutes } from "../src/admin/link-queue.routes";
import { linkEffectsFor } from "../src/links/link-jobs";
import { CAPTCHA_HOLD_MS, claimLinkJob, fakeAccessTradeLinks, handlingOf, holdShopeeQueue, LINK_MAX_ATTEMPTS, PAGE_ERROR_FAIL_AFTER_MS, PAGE_ERROR_HOLD_MS, recordLinkResult, resumeShopeeQueue, retryDelayMs, shopeeQueueGate, shopeeQueueState } from "../src/modules/linking/index";
import { commandAudit } from "../src/modules/operations/index";
import type { Ledger } from "../src/platform/db/ledger";
import { buildServers, type Servers } from "../src/platform/http/servers";
import { INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import type { BridgeLinkResult } from "../src/platform/ports/bridge.port";
import { alertRows, answeringBridge, bridgeJobCount, C1, LINK_START, linkLedger, linkRow, memoryLogger, movingClock, outboxRows, queueLink, runLinks } from "./helpers/link-ledger";
import { addStaff, generatedPassword } from "./helpers/staff-desk";

const ledgers: Ledger[] = [];
const servers: Servers[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await Promise.all([s.publicApp.close(), s.internalApp.close()]);
  for (const l of ledgers.splice(0)) l.close();
});

const INTERNAL = "i".repeat(40);
const failed = (reason: string) => (): BridgeLinkResult => ({ outcome: "failed", reason });
const fakeLink = (job: { subId1: string; subId2: string }): BridgeLinkResult => ({ outcome: "link", url: `https://fake-bridge.invalid/l/${job.subId2}?sub_id1=${job.subId1}&sub_id2=${job.subId2}` });

describe("Story 5.5: captcha, page errors and a lost login pause or fail requests safely", () => {
  it("AC1: a captcha result retries the job uncounted, holds the queue and raises one bridge_captcha alert within the cooldown", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const first = queueLink(ledger, "DP00001");
    const second = queueLink(ledger, "DP00002", "https://shopee.vn/Quan-i.11001.22002");
    const bridge = answeringBridge(failed("captcha"));
    // The run stops at the captcha: the request behind it is not sent into the same page.
    expect(await runLinks(ledger, bridge, { clock })).toEqual({ issued: 0, failed: 0, interrupted: false });
    expect(bridge.jobs.map((j) => j.requestId)).toEqual([first]);
    expect(linkRow(ledger, first)).toMatchObject({ status: "QUEUED", attempts: 0, next_attempt_at: null });
    expect(shopeeQueueGate(ledger.db, clock.now())).toBe("held");

    // Held: nothing more is handed to the bridge until the hold ends.
    clock.advance(CAPTCHA_HOLD_MS - 1);
    expect(await runLinks(ledger, bridge, { clock })).toEqual({ issued: 0, failed: 0, interrupted: false });
    expect(bridge.jobs).toHaveLength(1);
    clock.advance(1);
    await runLinks(ledger, bridge, { clock });
    expect(bridge.jobs.map((j) => j.requestId)).toEqual([first, first]);
    expect(linkRow(ledger, first).attempts).toBe(0);
    expect(alertRows(ledger)).toEqual([{ kind: "bridge_captcha", severity: "high", suppressed: 1 }]);

    clock.advance(CAPTCHA_HOLD_MS);
    expect(await runLinks(ledger, answeringBridge(fakeLink, "fake"), { clock })).toEqual({ issued: 2, failed: 0, interrupted: false });
    expect(linkRow(ledger, second).status).toBe("ISSUED");
  });

  it("AC1: a first page error is retried uncounted with a shorter hold and a warning alert", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const requestId = queueLink(ledger, "DP00001");
    expect(await runLinks(ledger, answeringBridge(failed("page_not_ready")), { clock })).toEqual({ issued: 0, failed: 0, interrupted: false });
    expect(shopeeQueueState(ledger.db)).toMatchObject({ heldReason: "page_error", pausedAt: null, lastPageErrorRequest: requestId });
    expect(shopeeQueueGate(ledger.db, clock.now())).toBe("held");
    clock.advance(PAGE_ERROR_HOLD_MS);
    expect(shopeeQueueGate(ledger.db, clock.now())).toBe("open");
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "QUEUED", attempts: 0, page_errors: 1 });
    expect(alertRows(ledger)).toEqual([{ kind: "bridge_page_error", severity: "warning", suppressed: 0 }]);
    expect(handlingOf("form_missing")).toEqual({ kind: "counted" });
    expect(handlingOf("link_sub_ids_mismatch")).toEqual({ kind: "counted" });
  });

  it("AC2: three counted failures fail the request and enqueue one link failed message for its customer", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const requestId = queueLink(ledger, "DP00001");
    const bridge = answeringBridge(failed("shopee_refused"));
    for (let attempt = 1; attempt <= LINK_MAX_ATTEMPTS; attempt++) {
      expect(await runLinks(ledger, bridge, { clock })).toEqual({ issued: 0, failed: 1, interrupted: false });
      expect(linkRow(ledger, requestId)).toMatchObject({ status: attempt < LINK_MAX_ATTEMPTS ? "QUEUED" : "FAILED", attempts: attempt });
      expect(outboxRows(ledger)).toHaveLength(attempt < LINK_MAX_ATTEMPTS ? 0 : 1);
      clock.advance(retryDelayMs(attempt));
    }
    expect(outboxRows(ledger)).toEqual([{ dedup_key: `link_request:${requestId}:failed`, customer_id: C1, message_key: "link_failed" }]);
    expect(linkRow(ledger, requestId).next_attempt_at).toBeNull();
    // A FAILED request is never served again.
    expect(await runLinks(ledger, bridge, { clock })).toEqual({ issued: 0, failed: 0, interrupted: false });
    expect(bridge.jobs).toHaveLength(LINK_MAX_ATTEMPTS);
  });

  it("AC2: the guest account's request fails after three counted failures with no message", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const requestId = queueLink(ledger, "HOUSE");
    for (let attempt = 1; attempt <= LINK_MAX_ATTEMPTS; attempt++) {
      await runLinks(ledger, answeringBridge(failed("no_link")), { clock });
      clock.advance(retryDelayMs(attempt));
    }
    expect(linkRow(ledger, requestId).status).toBe("FAILED");
    expect(outboxRows(ledger)).toEqual([]);
  });

  it("AC3: a login redirect pauses the queue with a critical alert pointing to the runbook, and no bridge job is handed out until it is resumed", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const requestId = queueLink(ledger, "DP00001");
    const { logger, lines } = memoryLogger();
    expect(await runLinks(ledger, answeringBridge(failed("login_redirect")), { clock, logger })).toEqual({ issued: 0, failed: 0, interrupted: false });
    expect(shopeeQueueState(ledger.db)).toMatchObject({ pausedReason: "login_redirect", pausedAt: LINK_START });
    expect(alertRows(ledger)).toEqual([{ kind: "bridge_login_lost", severity: "critical", suppressed: 0 }]);
    expect(lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l["msg"] === "linking.link_queue.paused")).toMatchObject({ requestId, runbook: "docs/operations/bridge-runbook.md#sign-in-again" });
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "QUEUED", attempts: 0 });

    // A day later, still paused: no job is created and the bridge is never called.
    clock.advance(24 * 60 * 60_000);
    const jobs = bridgeJobCount(ledger);
    const bridge = answeringBridge(fakeLink, "fake");
    expect(await runLinks(ledger, bridge, { clock })).toEqual({ issued: 0, failed: 0, interrupted: false });
    expect(bridge.jobs).toEqual([]);
    expect(bridgeJobCount(ledger)).toBe(jobs);
    expect(ledger.tx((db) => claimLinkJob(db, clock, { subIdPrefix: "", guestIds: ["HOUSE"] }))).toBeNull();
    expect(alertRows(ledger)).toHaveLength(1);
  });

  it("AC4: the owner resumes the paused queue by command and work restarts with the oldest request first", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const oldest = queueLink(ledger, "DP00001", "https://shopee.vn/A-i.11001.22001", fixedClock("2026-11-01T01:00:00.000Z"));
    const newer = queueLink(ledger, "DP00002", "https://shopee.vn/B-i.11001.22002", fixedClock("2026-11-01T02:00:00.000Z"));
    await runLinks(ledger, answeringBridge(failed("login_redirect")), { clock });
    const later = queueLink(ledger, "DP00002", "https://shopee.vn/C-i.11001.22003", clock);

    const password = generatedPassword();
    await addStaff(ledger, "duc", "ADMIN", password, { root: true });
    await addStaff(ledger, "minh", "EMPLOYEE", password);
    const s = buildServers({ clock, internalToken: INTERNAL, internal: [adminCommandRoutes({ ledger, clock }), linkQueueRoutes({ ledger, clock })] });
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
    // Without an admin's sign-in nothing resumes; an employee is refused.
    expect((await s.internalApp.inject({ method: "POST", url: "/internal/admin/link-queue/resume", headers: { [INTERNAL_TOKEN_HEADER]: INTERNAL }, payload: {} })).statusCode).toBe(401);
    expect(await cli(["link-queue", "resume", "--as", "minh"])).toMatchObject({ code: 1, lines: [{ ok: false, reason: "error.staff.admin_only" }] });
    expect(shopeeQueueGate(ledger.db, clock.now())).toBe("paused");
    expect(await cli(["link-queue", "resume", "--as", "duc"])).toEqual({ code: 0, lines: [{ ok: true, command: "link-queue", resumed: true, pausedReason: "login_redirect" }] });
    expect(shopeeQueueGate(ledger.db, clock.now())).toBe("open");
    const audit = ledger.sqlite.prepare("SELECT event, entity_id, actor_id FROM audit_entries WHERE event = 'linking.link_queue.resumed'").all();
    expect(audit).toEqual([{ event: "linking.link_queue.resumed", entity_id: "shopee", actor_id: "duc" }]);

    const bridge = answeringBridge(fakeLink, "fake");
    expect(await runLinks(ledger, bridge, { clock })).toEqual({ issued: 3, failed: 0, interrupted: false });
    expect(bridge.jobs.map((j) => j.requestId)).toEqual([oldest, newer, later]);
    // Resuming an open queue changes nothing and records nothing.
    expect(ledger.tx((db) => resumeShopeeQueue(db, commandAudit(db, clock, { kind: "system", id: "test" }), clock.now()))).toEqual({ resumed: false, pausedReason: null });
  });

  it("review 1: the same request meeting a page error again backs off alone, uncounted, and the requests behind it go first", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const broken = queueLink(ledger, "DP00001", "https://shopee.vn/A-i.11001.22001", fixedClock("2026-11-01T01:00:00.000Z"));
    const fine = queueLink(ledger, "DP00002", "https://shopee.vn/B-i.11001.22002", fixedClock("2026-11-01T02:00:00.000Z"));
    const bridge = answeringBridge((job) => (job.requestId === broken ? { outcome: "failed", reason: "script_error" } : fakeLink(job)), "fake");
    // First page error: a hold, nothing else goes in this run.
    expect(await runLinks(ledger, bridge, { clock })).toEqual({ issued: 0, failed: 0, interrupted: false });
    clock.advance(PAGE_ERROR_HOLD_MS);
    // The same request again: it backs off alone and the next request is served in the same run.
    expect(await runLinks(ledger, bridge, { clock })).toEqual({ issued: 1, failed: 0, interrupted: false });
    expect(bridge.jobs.map((j) => j.requestId)).toEqual([broken, broken, fine]);
    expect(linkRow(ledger, fine).status).toBe("ISSUED");
    expect(linkRow(ledger, broken)).toMatchObject({ status: "QUEUED", attempts: 0, page_errors: 2, next_attempt_at: instantFromMs(toMs(clock.now()) + retryDelayMs(2)) });
    expect(shopeeQueueGate(ledger.db, clock.now())).toBe("open");
    expect(alertRows(ledger)).toEqual([{ kind: "bridge_page_error", severity: "warning", suppressed: 0 }]);
  });

  it("review 1: page errors on consecutive different requests are the session's problem and hold the queue", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const first = queueLink(ledger, "DP00001", "https://shopee.vn/A-i.11001.22001", fixedClock("2026-11-01T01:00:00.000Z"));
    const second = queueLink(ledger, "DP00002", "https://shopee.vn/B-i.11001.22002", fixedClock("2026-11-01T02:00:00.000Z"));
    ledger.sqlite.prepare("UPDATE link_requests SET next_attempt_at = ? WHERE request_id = ?").run(instantFromMs(toMs(clock.now()) + 1), first);
    const bridge = answeringBridge(failed("page_not_ready"));
    await runLinks(ledger, bridge, { clock });
    expect(bridge.jobs.map((j) => j.requestId)).toEqual([second]);
    clock.advance(PAGE_ERROR_HOLD_MS);
    await runLinks(ledger, bridge, { clock });
    expect(bridge.jobs.map((j) => j.requestId)).toEqual([second, first]);
    expect(shopeeQueueState(ledger.db)).toMatchObject({ heldReason: "page_error", lastPageErrorRequest: first });
    expect(shopeeQueueGate(ledger.db, clock.now())).toBe("held");
    expect(linkRow(ledger, first)).toMatchObject({ attempts: 0, page_errors: 1 });
  });

  it("review 1: a request still meeting page errors 30 minutes after its first fails and its customer is told", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const requestId = queueLink(ledger, "DP00001");
    const bridge = answeringBridge(failed("script_error"));
    for (let n = 0; linkRow(ledger, requestId).status === "QUEUED" && n < 100; n++) {
      await runLinks(ledger, bridge, { clock });
      clock.advance(60_000);
    }
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "FAILED", attempts: 0 });
    expect(toMs(clock.now()) - toMs(parseInstant(LINK_START))).toBeGreaterThanOrEqual(PAGE_ERROR_FAIL_AFTER_MS);
    expect(toMs(clock.now()) - toMs(parseInstant(LINK_START))).toBeLessThan(PAGE_ERROR_FAIL_AFTER_MS + 16 * 60_000);
    expect(outboxRows(ledger)).toEqual([{ dedup_key: `link_request:${requestId}:failed`, customer_id: C1, message_key: "link_failed" }]);
  });

  it("review 5: while the Shopee queue is held, the same run goes on to serve TikTok Shop requests", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const shopee = queueLink(ledger, "DP00001", "https://shopee.vn/A-i.11001.22001", fixedClock("2026-11-01T01:00:00.000Z"));
    const tiktok = queueLink(ledger, "DP00002", "https://vt.tiktok.com/ZSBKCcJrf/", fixedClock("2026-11-01T02:00:00.000Z"));
    const bridge = answeringBridge(failed("captcha"));
    expect(await runLinks(ledger, bridge, { clock, accessTrade: fakeAccessTradeLinks() })).toEqual({ issued: 1, failed: 0, interrupted: false });
    expect(bridge.jobs.map((j) => j.requestId)).toEqual([shopee]);
    expect(linkRow(ledger, tiktok).status).toBe("ISSUED");
    expect(linkRow(ledger, shopee).status).toBe("QUEUED");
  });

  it("review 7: resuming a queue whose hold has already ended answers resumed false and writes no audit entry", () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    ledger.tx((db) => holdShopeeQueue(db, "captcha", instantFromMs(toMs(clock.now()) + CAPTCHA_HOLD_MS)));
    clock.advance(CAPTCHA_HOLD_MS);
    const by = (db: Parameters<typeof commandAudit>[0]) => commandAudit(db, clock, { kind: "system", id: "test" });
    expect(ledger.tx((db) => resumeShopeeQueue(db, by(db), clock.now()))).toEqual({ resumed: false, pausedReason: null });
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM audit_entries WHERE event = 'linking.link_queue.resumed'").get()).toEqual({ n: 0 });
    // A hold still running is cleared and audited.
    ledger.tx((db) => holdShopeeQueue(db, "captcha", instantFromMs(toMs(clock.now()) + CAPTCHA_HOLD_MS)));
    expect(ledger.tx((db) => resumeShopeeQueue(db, by(db), clock.now()))).toEqual({ resumed: true, pausedReason: null });
    expect(shopeeQueueGate(ledger.db, clock.now())).toBe("open");
  });

  it("a silent bridge's second silence and a stale answer still follow the counted rule", () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const requestId = queueLink(ledger, "DP00001");
    const effects = linkEffectsFor(clock);
    for (let attempt = 1; attempt <= LINK_MAX_ATTEMPTS; attempt++) {
      const job = ledger.tx((db) => claimLinkJob(db, clock, { subIdPrefix: "", guestIds: [] }));
      if (job === null) throw new Error("expected a job");
      const recorded = ledger.tx((db) => recordLinkResult(db, job, { outcome: "failed", reason: "submit_failed" }, clock, { acceptFakeHost: false, effects }));
      expect(recorded.requestFailed).toBe(attempt === LINK_MAX_ATTEMPTS);
      clock.advance(retryDelayMs(attempt));
    }
    expect(linkRow(ledger, requestId).status).toBe("FAILED");
  });
});
