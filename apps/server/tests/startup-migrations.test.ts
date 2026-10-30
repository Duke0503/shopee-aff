/**
 * Story 1.7 through the real entry points: the server start runs the migration gate, and
 * the rehearse command runs on a backup file without a config or a live ledger.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import { MIGRATIONS_DIR, readMigrations } from "../src/platform/db/migrations";
import { randomPort, sandbox, SERVER_DIR, startServer, waitFor, type RunningServer } from "./helpers/server-process";

const TOKEN = "t".repeat(40);

describe("Story 1.7 at server start", () => {
  const running: RunningServer[] = [];
  afterAll(() => {
    for (const server of running) if (server.child.exitCode === null) server.child.kill("SIGKILL");
  });

  it("AC3: with no pending migration the server starts and takes no backup", async () => {
    const box = sandbox([`INTERNAL_TOKEN=${TOKEN}`, `PUBLIC_PORT=${randomPort()}`, `INTERNAL_PORT=${randomPort()}`]);
    // The first start applies the server's migrations behind a backup.
    const first = startServer(box);
    running.push(first);
    await waitFor(first, "platform.server.started");
    expect(first.output()).toContain("platform.migration.applied");
    first.child.kill("SIGTERM");
    await new Promise((done) => first.child.once("exit", done));
    const backups = readdirSync(join(box.dataDir, "backups"));
    // The second start finds nothing pending: no new backup.
    const second = startServer(box);
    running.push(second);
    await waitFor(second, "platform.server.started");
    expect(existsSync(join(box.dataDir, "ledger.sqlite"))).toBe(true);
    expect(readdirSync(join(box.dataDir, "backups"))).toEqual(backups);
    expect(second.output()).not.toContain("platform.backup.written");
  }, 60_000);
});

describe("Story 1.7 AC5: the rehearse command", () => {
  it("AC5: reports the result as JSON and leaves the backup file unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "cashback-rehearse-cli-"));
    const backupFile = join(dir, "backup.sqlite");
    const db = new Database(backupFile);
    db.exec("CREATE TABLE things (id INTEGER PRIMARY KEY)");
    db.close();
    const before = readFileSync(backupFile);
    const out = execFileSync(process.execPath, ["--import", "tsx", join(SERVER_DIR, "src", "rehearse-migration.ts"), backupFile], { cwd: SERVER_DIR, encoding: "utf8" });
    expect(JSON.parse(out.trim())).toEqual({ ok: true, applied: readMigrations(MIGRATIONS_DIR).map((m) => m.name) });
    expect(readFileSync(backupFile).equals(before)).toBe(true);
  }, 60_000);
});

describe("Story 1.7 review 9: the rehearse command fails as one JSON line with a non-zero exit", () => {
  function runCli(args: string[]): { status: number; lines: string[] } {
    try {
      const out = execFileSync(process.execPath, ["--import", "tsx", join(SERVER_DIR, "src", "rehearse-migration.ts"), ...args], { cwd: SERVER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return { status: 0, lines: out.trim().split("\n") };
    } catch (error) {
      const failed = error as { status: number; stdout: string };
      return { status: failed.status, lines: failed.stdout.trim().split("\n") };
    }
  }

  it("a missing backup file exits 1 with reason backup_missing", () => {
    const result = runCli([join(tmpdir(), "cashback-no-such-backup.sqlite")]);
    expect(result.status).toBe(1);
    expect(result.lines).toHaveLength(1);
    expect(JSON.parse(result.lines[0] ?? "")).toMatchObject({ ok: false, reason: "backup_missing" });
  }, 60_000);

  it("no argument exits 2 with reason usage", () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    expect(result.lines).toHaveLength(1);
    expect(JSON.parse(result.lines[0] ?? "")).toMatchObject({ ok: false, reason: "usage" });
  }, 60_000);
});
