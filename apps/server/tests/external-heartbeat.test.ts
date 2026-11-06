/**
 * Story 8.4: the external heartbeat. The server pings the heartbeat URL from config every 5
 * minutes while the one health model is green; the checker outside the VPS alerts on Telegram
 * after 15 minutes of silence. The HTTP call is always a fake here: no test reaches the network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Instant } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { heartbeatJob, ownerJobs } from "../src/health/owner-jobs";
import { assistantHeartbeats, heartbeatPinger, isGreen, readHealthModel, type HealthEntry, type PingFetch } from "../src/modules/operations/index";
import { pauseShopeeQueue } from "../src/modules/linking/index";
import { lastDrillOf } from "../src/platform/backup/restore-drill";
import { parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { isolationProblems, productionIdentifiers } from "../src/platform/config/isolation.config";
import { JOB_SCHEDULES } from "../src/platform/jobs/job-schedules";
import { createScheduler } from "../src/platform/jobs/scheduler";
import { memoryLogger } from "./helpers/link-ledger";
import { fakeTime } from "./helpers/fake-time";
import { tempDir } from "./helpers/live-fixture";
import { closeLedgers, freshLedger, movingClock } from "./helpers/order-ledger";

afterEach(closeLedgers);

/** A made-up check id, never a real one. */
const HEARTBEAT_URL = "https://hc-ping.com/00000000-0000-4000-8000-000000000000";
const START = "2026-11-02T01:00:00.000Z";
const TOKEN = "i".repeat(40);

function fakePing(answer: { ok: boolean; status: number } | Error = { ok: true, status: 200 }) {
  const calls: { url: string; method: string }[] = [];
  const fetch: PingFetch = async (url, init) => {
    calls.push({ url, method: init.method });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, calls };
}

const entry = (component: HealthEntry["component"], state: HealthEntry["state"]): HealthEntry => ({ component, state, at: null, alert: state === "down" ? { kind: `${component}_down`, severity: "high" } : null });

describe("Story 8.4: external heartbeat", () => {
  it("AC1: given a green health model, when 5 minutes pass, then one ping reaches the heartbeat URL from config", async () => {
    const ledger = freshLedger();
    const time = fakeTime(START);
    const { logger } = memoryLogger();
    const ping = fakePing();
    const dataDir = tempDir("cashback-heartbeat-");
    const config = { env: "prod" as const, dataDir, telegram: null, backupOffsite: null, assistantToken: null, heartbeatUrl: parseConfig("prod", { INTERNAL_TOKEN: TOKEN, HEARTBEAT_URL: HEARTBEAT_URL }).heartbeatUrl };
    const job = heartbeatJob({ config, ledger, clock: time.clock, logger, heartbeats: assistantHeartbeats(START as Instant), health: {}, ping: ping.fetch });
    expect(job).not.toBeNull();
    expect(JOB_SCHEDULES.heartbeat.schedule).toEqual({ kind: "every", delayMs: 5 * 60_000 });
    const scheduler = createScheduler([job!], { ...time, logger });
    scheduler.start();
    await time.advance(5 * 60_000 - 1);
    expect(ping.calls).toEqual([]);
    await time.advance(1);
    expect(ping.calls).toEqual([{ url: HEARTBEAT_URL, method: "GET" }]);
    await time.advance(5 * 60_000);
    expect(ping.calls).toHaveLength(2);
    await scheduler.stop(1_000);
  });

  it("AC2: given a red health model, when the ping is due, then no ping is sent, so the checker alerts", async () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const { logger, lines } = memoryLogger();
    const ping = fakePing();
    const pinger = heartbeatPinger({ url: HEARTBEAT_URL, model: () => readHealthModel(ledger, clock, {}), logger, fetch: ping.fetch });
    expect(await pinger.run()).toBe("sent");
    ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", clock.now()));
    expect(await pinger.run()).toBe("skipped_red");
    expect(ping.calls).toHaveLength(1);
    expect(lines.some((l) => l.includes("operations.heartbeat.skipped_red") && l.includes('"down":["bridge"]'))).toBe(true);
  });

  it("green means no part down: a part not known yet counts as green, and a due restore drill is a reminder, not an outage", () => {
    expect(isGreen([entry("bridge", "unknown"), entry("assistant", "up"), entry("queue", "up")])).toBe(true);
    expect(isGreen([entry("assistant", "up"), entry("drill", "due")])).toBe(true);
    expect(isGreen([entry("backup", "down"), entry("drill", "up")])).toBe(false);
  });

  it("a due drill alone still pings, through the same health sources the server builds", async () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const dataDir = tempDir("cashback-heartbeat-");
    const ping = fakePing();
    const { logger } = memoryLogger();
    const config = { env: "prod" as const, dataDir, telegram: null, backupOffsite: null, assistantToken: null, heartbeatUrl: HEARTBEAT_URL };
    // No drill was ever recorded: the drill part is due.
    const health = { drill: lastDrillOf(dataDir) };
    expect(readHealthModel(ledger, clock, health).find((e) => e.component === "drill")?.state).toBe("due");
    const job = heartbeatJob({ config, ledger, clock, logger, heartbeats: assistantHeartbeats(START as Instant), health, ping: ping.fetch });
    await job!.run(new AbortController().signal);
    expect(ping.calls).toHaveLength(1);
  });

  it("the URL is never logged: a failed or refused ping logs its status only, and the next run tries again", async () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const { logger, lines } = memoryLogger();
    const failing = fakePing(new Error(`connect ECONNREFUSED ${HEARTBEAT_URL}`));
    expect(await heartbeatPinger({ url: HEARTBEAT_URL, model: () => readHealthModel(ledger, clock, {}), logger, fetch: failing.fetch }).run()).toBe("failed");
    const refused = fakePing({ ok: false, status: 404 });
    expect(await heartbeatPinger({ url: HEARTBEAT_URL, model: () => readHealthModel(ledger, clock, {}), logger, fetch: refused.fetch }).run()).toBe("failed");
    expect(lines.filter((l) => l.includes("operations.heartbeat.failed"))).toHaveLength(2);
    expect(lines.join("\n")).not.toContain("hc-ping.com");
    expect(lines.join("\n")).not.toContain("00000000-0000-4000");
  });

  it("HEARTBEAT_URL comes from the env file, https only; without it no heartbeat job runs and production logs an error", () => {
    expect(parseConfig("prod", { INTERNAL_TOKEN: TOKEN, HEARTBEAT_URL }).heartbeatUrl).toBe(HEARTBEAT_URL);
    expect(parseConfig("dev", { INTERNAL_TOKEN: TOKEN }).heartbeatUrl).toBeNull();
    expect(() => parseConfig("prod", { INTERNAL_TOKEN: TOKEN, HEARTBEAT_URL: "http://hc-ping.com/abc" })).toThrow("HEARTBEAT_URL");
    const ledger = freshLedger();
    const clock = movingClock(START);
    const { logger, lines } = memoryLogger();
    const base = { env: "prod" as const, dataDir: tempDir("cashback-heartbeat-"), telegram: null, backupOffsite: null, assistantToken: null };
    const deps = { ledger, clock, logger, heartbeats: assistantHeartbeats(START as Instant), health: {} };
    expect(ownerJobs({ config: base, ...deps }).map((j) => j.name)).toEqual(["backup", "health", "linkRequestStuck"]);
    expect(lines.some((l) => l.includes('"level":50') && l.includes("operations.heartbeat.url_absent"))).toBe(true);
    expect(ownerJobs({ config: { ...base, heartbeatUrl: HEARTBEAT_URL }, ...deps }).map((j) => j.name)).toEqual(["backup", "health", "linkRequestStuck", "heartbeat"]);
  });

  it("a dev config that points at the production heartbeat is refused", () => {
    const ids = productionIdentifiers(REPOSITORY_ROOT, tempDir("cashback-home-"));
    const dev = parseConfig("dev", { INTERNAL_TOKEN: TOKEN, HEARTBEAT_URL: `${HEARTBEAT_URL}/` });
    const context = { identifiers: ids, prodEnv: { HEARTBEAT_URL: HEARTBEAT_URL.replace("hc-ping.com", "HC-PING.com") }, devFileIsProdFile: false, caseInsensitive: true };
    expect(isolationProblems(dev, context)).toContainEqual({ key: "HEARTBEAT_URL", reason: "same_as_production" });
    const own = parseConfig("dev", { INTERNAL_TOKEN: TOKEN, HEARTBEAT_URL: "https://hc-ping.com/11111111-1111-4111-8111-111111111111" });
    expect(isolationProblems(own, context)).toEqual([]);
  });
});

describe("Story 8.4: the runbook", () => {
  const runbook = (): string => readFileSync(join(REPOSITORY_ROOT, "docs", "operations", "production-host-runbook.md"), "utf8");

  it("AC3: the 15-minute silence test is written as a recorded manual test with its log", () => {
    const text = runbook();
    expect(text).toMatch(/## \d+\. Heartbeat silence test \(recorded manual test\)/);
    expect(text).toContain("| Date | Stopped at | Telegram alert at | Minutes | Result | By |");
  });

  it("AC4: the runbook has the auto-logon and Windows Update settings and the after-reboot checks", () => {
    const text = runbook();
    for (const heading of ["Windows auto-logon", "Windows Update active hours and restart window", "After-reboot checklist"]) expect(text).toContain(heading);
    // The auto-logon password is kept in LSA secrets, never in a file or the registry's plain value.
    expect(text).toContain("Sysinternals Autologon");
    expect(text).toMatch(/LSA secret/);
    for (const check of ["CashbackV2Server", "CashbackV2Assistant", "CashbackV2Browser", "cloudflared", "signed in"]) expect(text).toContain(check);
  });
});
