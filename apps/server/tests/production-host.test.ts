/**
 * Story 8.5: production host services on the Windows VPS behind the tunnel. The PowerShell
 * scripts in ops/windows/ are thin: every start and stop goes through `pnpm host`
 * (src/host/run-host.ts), whose rules are tested here with fake processes, never a real one. The
 * scripts themselves are checked as text (and parsed by PowerShell on Windows), never run: no test
 * touches Task Scheduler, the VPS, Cloudflare or a live process.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { AFFILIATE_START_URL, edgeArgs, findEdge, HostLaunchError, launchSpec, pidFileOf, READY_WAIT_MS, recordedState, runRecorded, STARTING_WAIT_MS, startRecorded, waitForServer, type Launched, type LaunchSpec, type StartDeps } from "../src/host/host-process";
import { productionGaps } from "../src/host/production-readiness";
import { blobsOf, existingRef, gitIn, keysFoundIn, keysSharedWith, searchedSecrets, splitBatch } from "../src/host/secrets-check";
import { checkTunnelConfig } from "../src/host/tunnel-config";
import { configFilePath, parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { ACCESS_JWT_HEADER } from "../src/platform/http/access-jwt.guard";
import { buildServers, close, listen, LOOPBACK, type Servers } from "../src/platform/http/servers";
import { readPidRecord, writePidRecord, type ProcessProbe } from "../src/platform/lifecycle/dev-process";
import { phaseFilePath, readServerPhase, writeServerPhase } from "../src/platform/lifecycle/server-phase";
import { memoryLogger } from "./helpers/link-ledger";
import { tempDir } from "./helpers/live-fixture";
import { closeLedgers, freshLedger, movingClock } from "./helpers/order-ledger";
import { accessJwt, ADMIN_HOST, deskServers } from "./helpers/staff-desk";

let servers: Servers | null = null;
afterEach(async () => {
  if (servers) await close(servers);
  servers = null;
  closeLedgers();
});

const NOW = "2026-11-02T03:00:00.000Z";
const SCRIPTS = join(REPOSITORY_ROOT, "ops", "windows");
const RUNBOOK = join(REPOSITORY_ROOT, "docs", "operations", "production-host-runbook.md");
const script = (name: string): string => readFileSync(join(SCRIPTS, name), "utf8");
const scripts = (): string[] => readdirSync(SCRIPTS).filter((n) => n.endsWith(".ps1"));

/** A fake OS: processes by PID with their age in seconds; kill removes them. */
function fakeOs(clock: Clock, processes: Record<number, number> = {}) {
  const alive = new Map(Object.entries(processes).map(([pid, age]) => [Number(pid), age]));
  const killed: number[] = [];
  const probe: ProcessProbe = { isAlive: (pid) => alive.has(pid), elapsedSeconds: (pid) => alive.get(pid) ?? null, kill: (pid) => void (killed.push(pid), alive.delete(pid)) };
  const launches: LaunchSpec[] = [];
  let next = 4100;
  const launch = (behaviour: "stays" | "exits") => (spec: LaunchSpec): Launched => {
    launches.push(spec);
    const pid = next++;
    let exited = behaviour === "exits";
    let finish: (code: number) => void = () => undefined;
    const ended = new Promise<number | null>((resolve) => (finish = resolve));
    if (exited) finish(1);
    else alive.set(pid, 0);
    return { pid, exited: () => exited, exitCode: () => ended, kill: () => ((exited = true), alive.delete(pid), finish(1)) };
  };
  return { probe, alive, killed, launches, launch, clock };
}

const PATHS = { repositoryRoot: "C:\\cashback", node: "C:\\node\\node.exe", edge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" };
const CONFIG = { dataDir: "C:\\cashback\\data\\prod", browserProfileDir: "C:\\cashback\\.browser-profile\\prod" };
const BUILT = (path: string): boolean => path.replaceAll("\\", "/").endsWith("apps/bridge/dist/manifest.json");

describe("Story 8.5: production host services on the Windows VPS", () => {
  it("AC1: the server and assistant tasks start at boot and the affiliate Edge at the operator's log-on, each running `pnpm host run <role> --env prod`", () => {
    const install = script("install-tasks.ps1");
    expect(install).toMatch(/Register-OwnTask \$OwnTasks\.server \(New-OwnAction "server"\) \(New-BootTriggers\) \$background/);
    expect(install).toMatch(/Register-OwnTask \$OwnTasks\.assistant \(New-OwnAction "assistant"\) \(New-BootTriggers\) \$background/);
    expect(install).toMatch(/Register-OwnTask \$OwnTasks\.browser \(New-OwnAction "browser"\) @\(\$logon\) \$desktop/);
    expect(install).toContain("New-ScheduledTaskTrigger -AtStartup");
    expect(install).toContain("New-ScheduledTaskTrigger -AtLogOn -User $user");
    // Server and assistant run whether the operator is signed in or not, with no stored password; Edge in the desktop session.
    expect(install).toContain("-LogonType S4U");
    expect(install).toContain("-LogonType Interactive");
    expect(install).toContain('@("run", $Role, "--env", $Environment)');
    expect(script("common.ps1")).toMatch(/server\s+= "CashbackV2Server"[\s\S]*assistant = "CashbackV2Assistant"[\s\S]*browser\s+= "CashbackV2Browser"/);
  });

  it("AC1: each role's launch: the server and assistant under Node, Edge with its own profile, the new extension and no background throttling", () => {
    const server = launchSpec("server", CONFIG, PATHS, BUILT);
    expect(server).toMatchObject({ command: PATHS.node, ready: "health", log: join(CONFIG.dataDir, "logs", "server.log") });
    expect(server.args).toEqual(["--import", "tsx", join(PATHS.repositoryRoot, "apps", "server", "src", "main.ts")]);
    expect(launchSpec("assistant", CONFIG, PATHS, BUILT)).toMatchObject({ args: ["--import", "tsx", join(PATHS.repositoryRoot, "apps", "assistant", "src", "main.ts")], ready: "alive" });
    const edge = launchSpec("browser", CONFIG, PATHS, BUILT);
    const extension = join(PATHS.repositoryRoot, "apps", "bridge", "dist");
    expect(edge.command).toBe(PATHS.edge);
    expect(edge.args).toEqual(edgeArgs(CONFIG.browserProfileDir, extension));
    expect(edge.args).toContain(`--user-data-dir=${CONFIG.browserProfileDir}`);
    expect(edge.args).toContain(`--load-extension=${extension}`);
    expect(edge.args).toContain("--disable-background-timer-throttling");
    expect(edge.args.at(-1)).toBe(AFFILIATE_START_URL);
    expect(() => launchSpec("browser", CONFIG, PATHS, () => false)).toThrow(new HostLaunchError("extension_not_built"));
    expect(() => launchSpec("browser", { ...CONFIG, browserProfileDir: null }, PATHS, BUILT)).toThrow(new HostLaunchError("no_browser_profile"));
    expect(() => launchSpec("browser", CONFIG, { ...PATHS, edge: null }, BUILT)).toThrow(new HostLaunchError("edge_not_found"));
    expect(findEdge(["C:\\a\\msedge.exe", "C:\\b\\msedge.exe"], (p) => p.startsWith("C:\\b"))).toBe("C:\\b\\msedge.exe");
  });

  it("AC1: a start records the PID only once the process is ready, and the task's repeat trigger starts nothing while it runs", async () => {
    const clock = movingClock(NOW);
    const os = fakeOs(clock);
    const pidFile = pidFileOf(tempDir("cashback-run-"), "assistant");
    const deps: StartDeps = { pidFile, probe: os.probe, clock, launch: os.launch("stays"), ready: async () => null };
    const spec = launchSpec("assistant", CONFIG, PATHS, BUILT);
    expect(await startRecorded(spec, deps)).toEqual({ outcome: "started", pid: 4100 });
    expect(readPidRecord(pidFile)).toEqual({ pid: 4100, startedAt: NOW });
    expect(await startRecorded(spec, deps)).toEqual({ outcome: "already_running", pid: 4100 });
    expect(os.launches).toHaveLength(1);
    // A process that dies before it is ready is reported and leaves no record.
    const other = pidFileOf(tempDir("cashback-run-"), "browser");
    expect(await startRecorded(launchSpec("browser", CONFIG, PATHS, BUILT), { ...deps, pidFile: other, launch: os.launch("exits"), ready: async (_s, child) => (child.exited() ? { reason: "exited (see its log)", kill: false } : null) })).toEqual({ outcome: "failed", reason: "exited (see its log)" });
    expect(readPidRecord(other)).toBeNull();
  });

  it("AC1: `host run` stays as long as its process, passes its exit code on and clears its record", async () => {
    const clock = movingClock(NOW);
    const os = fakeOs(clock);
    const pidFile = pidFileOf(tempDir("cashback-run-"), "server");
    let child: Launched | null = null;
    const launch = (spec: LaunchSpec): Launched => (child = os.launch("stays")(spec));
    const running = runRecorded(launchSpec("server", CONFIG, PATHS, BUILT), { pidFile, probe: os.probe, clock, launch, ready: async () => null });
    await new Promise((resolve) => setImmediate(resolve));
    expect(readPidRecord(pidFile)?.pid).toBe(4100);
    (child as Launched | null)?.kill();
    expect(await running).toEqual({ outcome: "exited", pid: 4100, code: 1 });
    expect(readPidRecord(pidFile)).toBeNull();
  });

  it("review 7: the start waits as long as the server reports `starting` (backup, migrations), up to 30 minutes, and never kills it then", async () => {
    // A fake clock moved by the wait's own pauses; the server answers health only when the test says.
    const run = async (script: { startingUntil: number; healthyAt: number | null }) => {
      let now = 0;
      const result = await waitForServer({
        healthy: async () => script.healthyAt !== null && now >= script.healthyAt,
        starting: () => now < script.startingUntil,
        exited: () => false,
        now: () => now,
        pause: async (ms) => void (now += ms),
        pollMs: 1_000,
      });
      return { result, at: now };
    };
    // A 20-minute migration, then health answers: ready, never cut short.
    expect(await run({ startingUntil: 20 * 60_000, healthyAt: 20 * 60_000 + 5_000 })).toMatchObject({ result: null, at: 20 * 60_000 + 5_000 });
    // Still starting after 30 minutes: reported, not to be killed.
    expect((await run({ startingUntil: Number.MAX_SAFE_INTEGER, healthyAt: null })).result).toEqual({ reason: "still_starting", kill: false });
    expect((await run({ startingUntil: Number.MAX_SAFE_INTEGER, healthyAt: null })).at).toBe(STARTING_WAIT_MS);
    // Not starting and no health: 60 seconds after it last reported starting, it may be killed.
    // Last seen starting at the poll of 9:59.
    expect(await run({ startingUntil: 10 * 60_000, healthyAt: null })).toMatchObject({ result: { reason: "not_healthy", kill: true }, at: 10 * 60_000 - 1_000 + READY_WAIT_MS });
    expect(await run({ startingUntil: 0, healthyAt: null })).toMatchObject({ result: { reason: "not_healthy", kill: true }, at: READY_WAIT_MS });
  });

  it("review 7: a server still starting past the bound is recorded with `pending`, never killed; one that is not healthy is killed and not recorded", async () => {
    const clock = movingClock(NOW);
    const os = fakeOs(clock);
    const pidFile = pidFileOf(tempDir("cashback-run-"), "server");
    const spec = launchSpec("server", CONFIG, PATHS, BUILT);
    expect(await startRecorded(spec, { pidFile, probe: os.probe, clock, launch: os.launch("stays"), ready: async () => ({ reason: "still_starting", kill: false }) })).toEqual({ outcome: "started", pid: 4100, pending: "still_starting" });
    expect(readPidRecord(pidFile)?.pid).toBe(4100);
    expect(os.alive.has(4100)).toBe(true);
    const other = pidFileOf(tempDir("cashback-run-"), "server");
    expect(await startRecorded(spec, { pidFile: other, probe: os.probe, clock, launch: os.launch("stays"), ready: async () => ({ reason: "not_healthy", kill: true }) })).toEqual({ outcome: "failed", reason: "not_healthy" });
    expect(os.alive.has(4101)).toBe(false);
    expect(readPidRecord(other)).toBeNull();
  });

  it("review 7: the server reports its phase in run/<env>/server.phase.json with its own PID", () => {
    const path = phaseFilePath(tempDir("cashback-run-"));
    expect(readServerPhase(path)).toBeNull();
    expect(writeServerPhase(path, { pid: 4242, phase: "starting", at: NOW })).toBe(true);
    expect(readServerPhase(path)).toEqual({ pid: 4242, phase: "starting", at: NOW });
    const main = readFileSync(join(REPOSITORY_ROOT, "apps", "server", "src", "main.ts"), "utf8");
    const starting = main.indexOf('phase: "starting"');
    expect(starting).toBeGreaterThan(main.indexOf("acquireServerLock(lockFile)"));
    expect(starting).toBeLessThan(main.indexOf("parts = await start("));
    expect(main.indexOf('phase: "ready"')).toBeGreaterThan(main.indexOf("parts = await start("));
  });

  it("start and stop act only on recorded PIDs: a PID the OS gave to another process is 'not ours' and is started over, never stopped", async () => {
    const clock = movingClock(NOW);
    // PID 7000 is alive but started an hour after the record says: another process.
    const os = fakeOs(clock, { 7000: 60 });
    const pidFile = pidFileOf(tempDir("cashback-run-"), "server");
    writePidRecord(pidFile, { pid: 7000, startedAt: "2026-11-02T02:00:00.000Z" });
    expect(recordedState(pidFile, os.probe, clock)).toMatchObject({ state: "not_ours", pid: 7000 });
    expect(await startRecorded(launchSpec("server", CONFIG, PATHS, BUILT), { pidFile, probe: os.probe, clock, launch: os.launch("stays"), ready: async () => null })).toEqual({ outcome: "started", pid: 4100 });
    expect(os.killed).toEqual([]);
    expect(os.alive.has(7000)).toBe(true);
  });

  it("AC2: given the tunnel config, when it is inspected, then only 127.0.0.1:8080 is exposed", () => {
    const good = [
      "tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef",
      "credentials-file: C:\\Users\\op\\.cloudflared\\6ff42ae2.json",
      "ingress:",
      "  - hostname: hoantiendp.com",
      "    service: http://127.0.0.1:8080",
      "  - hostname: admin.hoantiendp.com",
      "    service: http://localhost:8080",
      "    originRequest:",
      "      connectTimeout: 10s",
      "  - service: http_status:404",
    ].join("\n");
    expect(checkTunnelConfig(good, 8080)).toMatchObject({ ok: true, problems: [] });
    const internal = good.replace("http://localhost:8080", "http://127.0.0.1:8081");
    expect(checkTunnelConfig(internal, 8080).problems).toEqual(["service http://127.0.0.1:8081 is not the public listener 127.0.0.1:8080"]);
    // The live system's ports, another origin, and a missing catch-all are refused.
    expect(checkTunnelConfig(good.replace("http://127.0.0.1:8080", "http://localhost:8899"), 8080).ok).toBe(false);
    expect(checkTunnelConfig(good.replace("http://127.0.0.1:8080", "http://192.168.1.5:8080"), 8080).ok).toBe(false);
    expect(checkTunnelConfig(good.replace("  - service: http_status:404", ""), 8080).problems).toContain("the last ingress rule must be the catch-all http_status:404");
    expect(checkTunnelConfig(`url: http://127.0.0.1:8081\n${good}`, 8080).ok).toBe(false);
    // What the check cannot read is a failure, never a pass.
    expect(checkTunnelConfig(good.replace("    service: http://127.0.0.1:8080", "    service: { url: http://127.0.0.1:8081 }"), 8080).ok).toBe(false);
  });

  it("AC2: both listeners bind 127.0.0.1 only, so the internal port cannot be reached from outside the VPS", async () => {
    const { logger } = memoryLogger();
    servers = buildServers({ clock: movingClock(NOW), internalToken: "t".repeat(40), assistantToken: null, bridgeToken: null, logger, internal: [], public: [] });
    await listen(servers, { public: 0, internal: 0 });
    for (const app of [servers.publicApp, servers.internalApp]) expect(app.server.address()).toMatchObject({ address: LOOPBACK });
  });

  it("AC3: on the admin host, a request that passed Access but has no staff session gets 401; without the Access JWT it gets 401 too", async () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T02:00:00.000Z");
    servers = deskServers(ledger, clock);
    const withJwt = await servers.publicApp.inject({ method: "GET", url: "/api/admin/payouts", headers: { host: ADMIN_HOST, [ACCESS_JWT_HEADER]: accessJwt(clock) } });
    expect(withJwt.statusCode).toBe(401);
    const withoutJwt = await servers.publicApp.inject({ method: "GET", url: "/api/admin/payouts", headers: { host: ADMIN_HOST } });
    expect(withoutJwt.statusCode).toBe(401);
  });

  it("AC4: the Cloudflare rate-limit and WAF rules for /api/session and the link endpoints are written as exact owner steps", () => {
    const runbook = readFileSync(RUNBOOK, "utf8");
    expect(runbook).toContain('(http.host eq "hoantiendp.com" and http.request.uri.path eq "/api/session" and http.request.method eq "POST")');
    expect(runbook).toMatch(/starts_with\(http\.request\.uri\.path, "\/api\/links"\)/);
    expect(runbook).toContain("Cloudflare Access");
    expect(runbook).toMatch(/## \d+\. Rate-limit burst test \(recorded manual test\)/);
  });

  it("AC5: given the secrets, they live only in the production env file outside the repository, and a value committed on main is found by key", () => {
    const file = configFilePath("prod", "C:\\Users\\operator");
    expect(file).toBe(join("C:\\Users\\operator", ".config", "cashback", "prod.env"));
    expect(file.startsWith(REPOSITORY_ROOT)).toBe(false);
    const secrets = searchedSecrets({ INTERNAL_TOKEN: "n".repeat(40), BRIDGE_TOKEN: "b".repeat(40), TELEGRAM_BOT_TOKEN: "111:short", PUBLIC_PORT: "8080" });
    expect([...secrets.keys()]).toEqual(["INTERNAL_TOKEN", "BRIDGE_TOKEN"]);
    expect(keysFoundIn(secrets, [`BACKEND_TOKEN=${"b".repeat(40)}\n`, Buffer.from("nothing")])).toEqual(["BRIDGE_TOKEN"]);
    expect(keysSharedWith(secrets, { OLD_TOKEN: "n".repeat(40) })).toEqual(["INTERNAL_TOKEN"]);
  });

  it("AC5: the rotation check reads every blob in main's history, a value removed later included", () => {
    const repo = tempDir("cashback-git-");
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: ["ignore", "pipe", "ignore"] });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    const exposed = "e".repeat(48);
    writeFileSync(join(repo, "config.js"), `export const TOKEN = "${exposed}";\n`);
    git("add", ".");
    git("commit", "-q", "-m", "exposed");
    writeFileSync(join(repo, "config.js"), "export const TOKEN = process.env.TOKEN;\n");
    git("commit", "-q", "-am", "removed");
    const run = gitIn(repo);
    expect(existingRef(run, ["nope", "main"])).toBe("main");
    expect(keysFoundIn(searchedSecrets({ ASSISTANT_TOKEN: exposed, INTERNAL_TOKEN: "r".repeat(40) }), blobsOf(run, "main"))).toEqual(["ASSISTANT_TOKEN"]);
    expect([...splitBatch(Buffer.from("abc blob 3\nxyz\ndef blob 0\n\n"))].map((b) => b.toString())).toEqual(["xyz", ""]);
  });

  it("the go-live preflight names every production setting still missing", () => {
    const empty = parseConfig("prod", { INTERNAL_TOKEN: "i".repeat(40) });
    expect(productionGaps(empty)).toEqual([
      "PUBLIC_BASE_URL",
      "ADMIN_HOST, ACCESS_TEAM_DOMAIN, ACCESS_AUDIENCE",
      "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID",
      "HEARTBEAT_URL",
      "BACKUP_AGE_PATH, BACKUP_AGE_RECIPIENT, BACKUP_RCLONE_PATH, BACKUP_RCLONE_REMOTE",
      "ASSISTANT_TOKEN",
      "BRIDGE_TOKEN",
      "BROWSER_PROFILE_DIR",
      "FINGERPRINT_KEY",
    ]);
  });
});

describe("Story 8.5: the PowerShell scripts never touch the live system", () => {
  it("the scripts know only their own three tasks, refuse the live ones, and never find or stop a process by name", () => {
    expect(scripts().sort()).toEqual(["common.ps1", "install-tasks.ps1", "start.ps1", "status.ps1", "stop.ps1", "uninstall-tasks.ps1"]);
    for (const name of scripts()) {
      const text = script(name);
      expect(text, name).not.toMatch(/Stop-Process|taskkill|Get-Process|kill\s/i);
      expect(text, name).not.toMatch(/Stop-ScheduledTask/);
      // A live task name appears only in the guard's list in common.ps1.
      if (name !== "common.ps1") expect(text, name).not.toMatch(/"CashbackBackend"|"CashbackAssistant"/);
      // Every task cmdlet goes through a name checked by Assert-OwnTask in the same loop or function.
      for (const match of text.matchAll(/(Register|Unregister|Enable|Disable|Start)-ScheduledTask -TaskName (\S+)/g)) expect(text, `${name}: ${match[0]}`).toContain(`Assert-OwnTask ${match[2]}`);
    }
    expect(script("common.ps1")).toContain('$script:LiveTasks = @("CashbackBackend", "CashbackAssistant")');
  });

  it("the scripts are plain ASCII (no Vietnamese, no emoji) and hold no secret", () => {
    for (const name of scripts()) {
      const text = script(name);
      expect([...text].every((c) => c.charCodeAt(0) < 128), name).toBe(true);
      expect(text, name).not.toMatch(/TOKEN\s*=|password\s*=|ConvertTo-SecureString/i);
    }
  });

  it.runIf(process.platform === "win32")(
    "review 1: Invoke-Host shows node's output and returns only its exit code, as an int",
    () => {
      const dir = tempDir("cashback-ps-");
      const fake = join(dir, "fake-node.cmd");
      writeFileSync(fake, "@echo fake-node-output %*\r\n@exit /b 3\r\n");
      const driver = join(dir, "driver.ps1");
      const quote = (text: string): string => `'${text.replaceAll("'", "''")}'`;
      writeFileSync(
        driver,
        [`. ${quote(join(SCRIPTS, "common.ps1"))}`, `function Get-NodePath { return ${quote(fake)} }`, `$code = Invoke-Host ${quote(REPOSITORY_ROOT)} @("status", "--env", "prod")`, `"TYPE=$($code.GetType().FullName)"`, `"CODE=$code"`, "if ($code -ne 0) { exit 7 }"].join("\r\n"),
      );
      let out: string;
      let status = 0;
      try {
        out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", driver], { encoding: "utf8" });
      } catch (error) {
        const failed = error as { stdout: string; status: number };
        out = failed.stdout;
        status = failed.status;
      }
      expect(out).toContain("fake-node-output");
      expect(out).toContain("status --env prod");
      expect(out).toContain("TYPE=System.Int32");
      expect(out).toContain("CODE=3");
      expect(status).toBe(7);
    },
    60_000,
  );

  it.runIf(process.platform === "win32")(
    "each script parses in Windows PowerShell without running it",
    () => {
      const files = scripts().map((name) => `'${join(SCRIPTS, name).replaceAll("'", "''")}'`);
      const command = `foreach ($f in @(${files.join(",")})) { $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$e); "$([System.IO.Path]::GetFileName($f)):$($e.Count)" }`;
      const lines = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" }).trim().split(/\r?\n/);
      expect(lines).toEqual(scripts().map((name) => `${name}:0`));
    },
    60_000,
  );
});
