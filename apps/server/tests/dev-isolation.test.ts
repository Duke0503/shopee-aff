/**
 * Story 8.1: the dev environment is separated from production in every resource (AD-25, D37,
 * NFR-5). The isolation check is tested on parsed configs; the start script, the server's mode
 * line and the repository scan run for real.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, linkSync, readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock } from "@cashback/core";
import { describe, expect, it } from "vitest";

import { linkJobs } from "../src/links/link-jobs";
import { findLinkRequestOwner, queueLinkRequest } from "../src/modules/linking/index";
import { attribute, type AttributionDirectory } from "../src/modules/orders/index";
import { configFilePath, parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { isolationProblems, isolationWarnings, productionIdentifiers, type IsolationContext } from "../src/platform/config/isolation.config";
import { openLedger } from "../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../src/platform/db/migrations";
import { osProcessProbe } from "../src/platform/lifecycle/dev-process";
import { createLogger } from "../src/platform/log/logger";
import { randomPort, sandbox, SERVER_DIR, startServer, waitFor } from "./helpers/server-process";
import { tempDir } from "./helpers/live-fixture";

const TOKEN = "t".repeat(40);
const HOME = join(tmpdir(), "cashback-isolation-home");
const DEV_GROUP = "8786316503449470342";
const MAIN_GROUP = "2813090100064697955";

const context = (over: Partial<IsolationContext> = {}): IsolationContext => ({ identifiers: productionIdentifiers(REPOSITORY_ROOT, HOME), prodEnv: null, devFileIsProdFile: false, caseInsensitive: process.platform === "win32", ...over });
const dev = (values: Record<string, string> = {}) => parseConfig("dev", { INTERNAL_TOKEN: TOKEN, ...values });
const keysOf = (values: Record<string, string>, ctx: IsolationContext = context()) => isolationProblems(dev(values), ctx).map((p) => `${p.key} ${p.reason}`);

describe("Story 8.1: dev environment separated from production", () => {
  it("AC1: a dev config on dev's own ports, data and fakes passes; each production port, path, group, host, URL or file is refused by key", () => {
    expect(keysOf({})).toEqual([]);
    expect(keysOf({ ZALO_MODE: "account", ZALO_GROUP_IDS: DEV_GROUP, BRIDGE_MODE: "browser", BROWSER_PROFILE_DIR: join(REPOSITORY_ROOT, ".browser-profile", "dev") })).toEqual([]);

    for (const port of ["8080", "8081", "8787", "8891", "8899", "80"]) expect(keysOf({ PUBLIC_PORT: port })).toEqual(["PUBLIC_PORT production_port"]);
    expect(keysOf({ INTERNAL_PORT: "8787" })).toEqual(["INTERNAL_PORT production_port"]);
    expect(keysOf({ DATA_DIR: join(REPOSITORY_ROOT, "data", "prod") })).toEqual(["DATA_DIR production_path"]);
    expect(keysOf({ DATA_DIR: join(REPOSITORY_ROOT, "data") })).toEqual(["DATA_DIR production_path"]);
    expect(keysOf({ DATA_DIR: "C:/Project/mmo/data" })).toEqual(process.platform === "win32" ? ["DATA_DIR production_path"] : []);
    expect(keysOf({ RUN_DIR: join(REPOSITORY_ROOT, "run", "prod") })).toEqual(["RUN_DIR production_path"]);
    expect(keysOf({ BROWSER_PROFILE_DIR: join(REPOSITORY_ROOT, ".browser-profile") })).toEqual(["BROWSER_PROFILE_DIR production_path"]);
    expect(keysOf({ BROWSER_PROFILE_DIR: join(REPOSITORY_ROOT, ".browser-profile", "prod", "Default") })).toEqual(["BROWSER_PROFILE_DIR production_path"]);
    expect(keysOf({ BRIDGE_MODE: "browser" })).toEqual(["BROWSER_PROFILE_DIR required"]);
    expect(keysOf({ ZALO_GROUP_IDS: MAIN_GROUP })).toEqual(["ZALO_GROUP_IDS not_the_dev_group"]);
    expect(keysOf({ ZALO_GROUP_IDS: `${DEV_GROUP}, 123` })).toEqual(["ZALO_GROUP_IDS not_the_dev_group"]);
    expect(keysOf({ ZALO_MODE: "account" })).toEqual(["ZALO_GROUP_IDS required"]);
    expect(keysOf({ PUBLIC_BASE_URL: "https://hoantiendp.com" })).toEqual(["PUBLIC_BASE_URL must_be_empty"]);
    const access = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUDIENCE: "a".repeat(32) };
    expect(keysOf({ ...access, ADMIN_HOST: "admin.hoantiendp.com" })).toEqual(["ADMIN_HOST production_value"]);
    expect(keysOf({ ...access, ADMIN_HOST: "dev.hoantiendp.com" })).toEqual(["ADMIN_HOST production_value"]);
    expect(keysOf({ ...access, ADMIN_HOST: "admin.cashback.localhost" })).toEqual([]);
    expect(keysOf({}, context({ devFileIsProdFile: true }))).toEqual(["ENV_FILE production_env_file"]);
    expect(keysOf({ ASSISTANT_TOKEN: TOKEN })).toEqual(["ASSISTANT_TOKEN same_as_internal_token"]);
  });

  it("AC1: a dev config sharing a secret, a chat, a folder, a port or a group with the production env file on this machine is refused, naming keys only", () => {
    const prodEnv = { INTERNAL_TOKEN: TOKEN, TELEGRAM_BOT_TOKEN: "bot-secret", TELEGRAM_CHAT_ID: "-1001", PUBLIC_PORT: "7080", DATA_DIR: join(tmpdir(), "prod-data"), ZALO_GROUP_IDS: DEV_GROUP, ACCESS_AUDIENCE: "b".repeat(32) };
    const problems = isolationProblems(dev({ TELEGRAM_BOT_TOKEN: "bot-secret", TELEGRAM_CHAT_ID: "-1001", PUBLIC_PORT: "7080", DATA_DIR: join(tmpdir(), "prod-data", "x"), ZALO_GROUP_IDS: DEV_GROUP }), context({ prodEnv }));
    expect(problems.map((p) => `${p.key} ${p.reason}`).sort()).toEqual(["DATA_DIR production_path", "INTERNAL_TOKEN same_as_production", "PUBLIC_PORT production_port", "TELEGRAM_BOT_TOKEN same_as_production", "TELEGRAM_CHAT_ID production_value", "ZALO_GROUP_IDS not_the_dev_group"].sort());
    expect(JSON.stringify(problems)).not.toMatch(/bot-secret|tttt|-1001/);
  });

  it("review 5: a dev FINGERPRINT_KEY or ACCESSTRADE_API_KEY equal to production is refused; the AccessTrade key only with ALLOW_PROD_ACCESSTRADE_KEY=1, as a warning", () => {
    const prodEnv = { FINGERPRINT_KEY: "f".repeat(40), ACCESSTRADE_API_KEY: "at-key" };
    const shared = { FINGERPRINT_KEY: "f".repeat(40), ACCESSTRADE_API_KEY: "at-key" };
    expect(keysOf(shared, context({ prodEnv })).sort()).toEqual(["ACCESSTRADE_API_KEY same_as_production", "FINGERPRINT_KEY same_as_production"]);
    const allowed = dev({ ACCESSTRADE_API_KEY: "at-key", ALLOW_PROD_ACCESSTRADE_KEY: "1" });
    expect(isolationProblems(allowed, context({ prodEnv }))).toEqual([]);
    expect(isolationWarnings(allowed, context({ prodEnv }))).toEqual(["ACCESSTRADE_API_KEY shared_with_production"]);
    expect(isolationWarnings(dev({ ACCESSTRADE_API_KEY: "own-key", ALLOW_PROD_ACCESSTRADE_KEY: "1" }), context({ prodEnv }))).toEqual([]);
    expect(keysOf({ FINGERPRINT_KEY: "g".repeat(40), ACCESSTRADE_API_KEY: "own-key" }, context({ prodEnv }))).toEqual([]);
  });

  it("review 5: LIVE_LEDGER_PATH may name the live copy a rehearsal reads, never the server's own ledger or data folder", () => {
    const dataDir = join(tmpdir(), "cashback-dev-data");
    expect(keysOf({ DATA_DIR: dataDir, LIVE_LEDGER_PATH: join(dataDir, "ledger.sqlite") })).toEqual(["LIVE_LEDGER_PATH own_ledger"]);
    expect(keysOf({ DATA_DIR: dataDir, LIVE_LEDGER_PATH: join(tmpdir(), "live-copy", "cashback.db") })).toEqual([]);
    const prod = parseConfig("prod", { INTERNAL_TOKEN: TOKEN, DATA_DIR: dataDir, LIVE_LEDGER_PATH: join(dataDir, "ledger.sqlite") });
    expect(isolationProblems(prod, context()).map((p) => `${p.key} ${p.reason}`)).toEqual(["LIVE_LEDGER_PATH own_ledger"]);
  });

  it("review 6: a blank value means unset for every new key, and Telegram needs both its token and its chat or neither", () => {
    const blanks = { ASSISTANT_TOKEN: "", BRIDGE_MODE: " ", ZALO_MODE: "", ZALO_GROUP_IDS: "", BROWSER_PROFILE_DIR: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", PUBLIC_BASE_URL: "", RUN_DIR: "", ALLOW_PROD_ACCESSTRADE_KEY: "" };
    expect(dev(blanks)).toMatchObject({ assistantToken: null, bridgeMode: "fake", zaloMode: "fake", zaloGroupIds: [], browserProfileDir: null, telegram: null, publicBaseUrl: null, allowProdAccesstradeKey: false, runDir: join(REPOSITORY_ROOT, "run", "dev") });
    expect(() => dev({ TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "-100123" })).toThrow("config: missing or invalid TELEGRAM_BOT_TOKEN");
    expect(() => dev({ TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "  " })).toThrow("config: missing or invalid TELEGRAM_CHAT_ID");
    expect(dev({ TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "-100123" }).telegram).toEqual({ botToken: "bot", chatId: "-100123" });
    expect(dev({ ZALO_GROUP_IDS: ` ${DEV_GROUP} , ` }).zaloGroupIds).toEqual([DEV_GROUP]);
  });

  it("owner answer: the production Telegram chats are refused for dev", () => {
    for (const chat of ["-1004416753701", "-5232520551"]) expect(keysOf({ TELEGRAM_BOT_TOKEN: "dev-bot", TELEGRAM_CHAT_ID: chat })).toEqual(["TELEGRAM_CHAT_ID production_value"]);
    expect(keysOf({ TELEGRAM_BOT_TOKEN: "dev-bot", TELEGRAM_CHAT_ID: "-100999" })).toEqual([]);
  });

  it("AC1: the dev start script refuses a production port, a production env file and CASHBACK_ENV=prod before anything starts", () => {
    const start = (lines: string[], env: Record<string, string> = {}, linkProd = false) => {
      const box = sandbox([`INTERNAL_TOKEN=${TOKEN}`, ...lines, `RUN_DIR=${join(tempDir("cashback-run-"), "dev").replaceAll("\\", "/")}`]);
      if (linkProd) linkSync(configFilePath("dev", box.home), configFilePath("prod", box.home));
      // eslint-disable-next-line no-restricted-properties -- the child needs the test's PATH and system variables
      const run = spawnSync(process.execPath, ["--import", "tsx", join(SERVER_DIR, "src", "dev-start.ts")], { cwd: SERVER_DIR, env: { ...process.env, HOME: box.home, USERPROFILE: box.home, CASHBACK_ENV: "dev", ...env }, encoding: "utf8" });
      return { code: run.status, line: JSON.parse(run.stdout.trim()) as Record<string, string> };
    };
    const port = start(["PUBLIC_PORT=8080"]);
    expect(port).toMatchObject({ code: 1, line: { event: "platform.dev.refused", reason: "config" } });
    expect(port.line.message).toContain("PUBLIC_PORT (production_port)");
    expect(start([], {}, true).line.message).toContain("ENV_FILE (production_env_file)");
    expect(start([], { CASHBACK_ENV: "prod" })).toMatchObject({ code: 1, line: { reason: "not_dev" } });
  }, 60_000);

  it("AC1: the dev start script starts the server on dev's ports and data folder with dev.env and records its PID; the stop script stops it", async () => {
    const [publicPort, internalPort] = [randomPort(), randomPort()];
    const runDir = join(tempDir("cashback-run-"), "dev");
    const box = sandbox([`INTERNAL_TOKEN=${TOKEN}`, `PUBLIC_PORT=${publicPort}`, `INTERNAL_PORT=${internalPort}`, `RUN_DIR=${runDir.replaceAll("\\", "/")}`]);
    // eslint-disable-next-line no-restricted-properties -- the child needs the test's PATH and system variables
    const env = { ...process.env, HOME: box.home, USERPROFILE: box.home, CASHBACK_ENV: "dev" };
    const script = (name: string) => JSON.parse(spawnSync(process.execPath, ["--import", "tsx", join(SERVER_DIR, "src", name)], { cwd: SERVER_DIR, env, encoding: "utf8" }).stdout.trim()) as Record<string, unknown>;
    const started = script("dev-start.ts");
    expect(started).toMatchObject({ event: "platform.dev.started", publicPort, internalPort, bridge: "fake", zalo: "fake" });
    try {
      const ping = async (): Promise<number> => (await fetch(`http://127.0.0.1:${internalPort}/internal/ping`, { headers: { "x-internal-token": TOKEN } })).status;
      for (let i = 0; i < 200; i++) {
        if (await ping().catch(() => 0) === 200) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await ping()).toBe(200);
      expect(existsSync(join(box.dataDir, "ledger.sqlite"))).toBe(true);
      expect(readFileSync(join(box.dataDir, "logs", "server.log"), "utf8")).toContain("platform.server.started");
      expect(script("dev-start.ts")).toMatchObject({ event: "platform.dev.refused", reason: "already_running", pid: started.pid });
    } finally {
      // Review item 7: the server stops itself in order through its shutdown route, not by a kill.
      expect(script("dev-stop.ts")).toEqual({ event: "platform.dev.stopped", pid: started.pid });
    }
    expect(readFileSync(join(box.dataDir, "logs", "server.log"), "utf8")).toContain('"reason":"shutdown_route","msg":"platform.server.stopped"');
    expect(script("dev-stop.ts")).toEqual({ event: "platform.dev.nothing_recorded", pid: null });
    for (let i = 0; i < 50 && osProcessProbe.isAlive(Number(started.pid)); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(osProcessProbe.isAlive(Number(started.pid))).toBe(false);
  }, 90_000);

  it("review 8: the start script reports failed with the reason, and records no PID, when the server exits before it is healthy", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const taken = (blocker.address() as AddressInfo).port;
    const runDir = join(tempDir("cashback-run-"), "dev");
    const box = sandbox([`INTERNAL_TOKEN=${TOKEN}`, `PUBLIC_PORT=${taken}`, `INTERNAL_PORT=${randomPort()}`, `RUN_DIR=${runDir.replaceAll("\\", "/")}`]);
    try {
      // eslint-disable-next-line no-restricted-properties -- the child needs the test's PATH and system variables
      const env = { ...process.env, HOME: box.home, USERPROFILE: box.home, CASHBACK_ENV: "dev" };
      const run = spawnSync(process.execPath, ["--import", "tsx", join(SERVER_DIR, "src", "dev-start.ts")], { cwd: SERVER_DIR, env, encoding: "utf8" });
      expect(run.status).toBe(1);
      const line = JSON.parse(run.stdout.trim()) as { event: string; reason: string };
      expect(line.event).toBe("platform.dev.failed");
      expect(line.reason).toMatch(/^exited with code 1/);
      expect(existsSync(join(runDir, "server.pid"))).toBe(false);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  }, 90_000);

  it("AC3: a dev link's sub_id1 carries DEV, and production attribution makes the order a review case even when the request id exists there", async () => {
    const ledger = openLedger(join(tempDir("cashback-dev-link-"), "ledger.sqlite"));
    const clock = fixedClock("2026-11-01T03:00:00.000Z");
    runMigrations(ledger, readMigrations(MIGRATIONS_DIR), clock);
    ledger.sqlite.exec("INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('1000000000000000001', 'DP00001', 'USER', 'ACTIVE')");
    const requestId = ledger.tx((db) => queueLinkRequest(db, { customer: "DP00001", url: "https://shopee.vn/p-i.1.2", channel: "zalo" }, clock)).requestId;
    const [job] = linkJobs({ config: dev(), ledger, clock, logger: createLogger({ level: "fatal" }) });
    await job?.run(new AbortController().signal);
    const { sub_id1, sub_id2 } = ledger.sqlite.prepare("SELECT sub_id1, sub_id2 FROM bridge_jobs").get() as { sub_id1: string; sub_id2: string };
    expect(sub_id1).toBe("DEV1000000000000000001");
    // The same request id and customer exist in production: the DEV guard still wins (Story 2.7 rule).
    const production: AttributionDirectory = {
      resolveCustomer: (key) => (key === "1000000000000000001" ? { customerId: key, guest: false } : null),
      requestOwner: (id) => findLinkRequestOwner(ledger.db, id)?.customerId ?? null,
    };
    expect(attribute({ subIds: [sub_id1, sub_id2] }, production, true)).toEqual({ kind: "review", reason: "dev_link_in_production", candidates: [] });
    expect(sub_id2).toBe(requestId);
    // A DEV request id alone (sub_id1 empty) is also refused in production (owner answer, Sprint 20 review).
    expect(attribute({ subIds: ["", "DEV26110100001"] }, production, true)).toEqual({ kind: "review", reason: "dev_link_in_production", candidates: [] });
    ledger.close();
  });

  it("AC3: dev attribution credits only DEV links (prefix dropped) and makes a production link a review case", () => {
    const directory: AttributionDirectory = {
      resolveCustomer: (key) => (key === "1000000000000000001" ? { customerId: key, guest: false } : null),
      requestOwner: (id) => (id === "DEV26110100001" || id === "26110100001" ? "1000000000000000001" : null),
    };
    expect(attribute({ subIds: ["DEV1000000000000000001", "DEV26110100001"] }, directory, false, { devOnly: true })).toMatchObject({ kind: "customer", customerId: "1000000000000000001", source: "both" });
    for (const subIds of [["1000000000000000001", "DEV26110100001"], ["DEV1000000000000000001", "26110100001"], ["", "26110100001"]]) {
      expect(attribute({ subIds }, directory, false, { devOnly: true })).toEqual({ kind: "review", reason: "production_link_in_dev", candidates: [] });
    }
  });

  it("AC4: the dev server's startup log line names the fake bridge and the fake Zalo client; production refuses either fake", async () => {
    const server = startServer(sandbox([`INTERNAL_TOKEN=${TOKEN}`, `PUBLIC_PORT=${randomPort()}`, `INTERNAL_PORT=${randomPort()}`]));
    try {
      await waitFor(server, "platform.server.started");
      const line = server.output().split("\n").find((l) => l.includes("platform.environment.mode"));
      expect(JSON.parse(line ?? "{}")).toMatchObject({ msg: "platform.environment.mode", env: "dev", bridge: "fake", zalo: "fake", subIdPrefix: "DEV", tunnel: false });
    } finally {
      server.child.kill();
      await server.exited;
    }
    const prod = (values: Record<string, string>) => isolationProblems(parseConfig("prod", { INTERNAL_TOKEN: TOKEN, ...values }), context()).map((p) => `${p.key} ${p.reason}`);
    expect(prod({})).toEqual([]);
    expect(prod({ BRIDGE_MODE: "fake", ZALO_MODE: "fake" })).toEqual(["BRIDGE_MODE fake_in_production", "ZALO_MODE fake_in_production"]);
  }, 60_000);

  it("AC5: no env file and no credential value is committed, and the env files live outside the repository", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    expect(tracked.filter((f) => /(^|\/)(dev|prod)\.env$|(^|\/)\.env(\.[^/]*)?$/.test(f) && !f.endsWith(".example"))).toEqual([]);
    const secretKeys = "INTERNAL_TOKEN|ASSISTANT_TOKEN|BRIDGE_TOKEN|TELEGRAM_BOT_TOKEN|FINGERPRINT_KEY|ACCESSTRADE_API_KEY|ACCESS_AUDIENCE";
    const assigned = spawnSync("git", ["grep", "--untracked", "-n", "-E", `^\\s*(${secretKeys})=[^$<\\s]`, "--", "apps", "packages", "docs/operations"], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
    expect(assigned.stdout).toBe("");
    expect(configFilePath("dev").startsWith(REPOSITORY_ROOT)).toBe(false);
    expect(execFileSync("git", ["check-ignore", "run/dev/.probe", "data/dev/ledger.sqlite"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim().split(/\r?\n/)).toEqual(["run/dev/.probe", "data/dev/ledger.sqlite"]);
  });
});
