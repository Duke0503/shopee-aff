import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock } from "@cashback/core";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { checkIntegrity, restoreLedgerFile } from "../src/platform/db/backup";
import { openLedger } from "../src/platform/db/ledger";
import { MigrationGateError, openMigratedLedger } from "../src/platform/db/migration-gate";
import { pendingMigrations, readMigrations, runMigrations } from "../src/platform/db/migrations";
import { rehearseMigrations } from "../src/platform/db/rehearsal";
import { createLogger } from "../src/platform/log/logger";

const clock = fixedClock("2026-10-30T12:00:00.000Z");

const FIRST = { "0001_things.sql": "CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT);\nINSERT INTO things (id, name) VALUES (1, 'kept');" };
const SECOND_OK = { "0002_add_more.sql": "INSERT INTO things (id, name) VALUES (2, 'second');" };
/** Applies its first statement, then fails: a later migration of the same run already committed. */
const BROKEN = {
  "0002_add_more.sql": SECOND_OK["0002_add_more.sql"],
  "0003_broken.sql": "INSERT INTO things (id, name) VALUES (3, 'half');\nINSERT INTO nowhere VALUES (1);",
};

interface Box {
  root: string;
  dataDir: string;
  ledgerPath: string;
  backupsDir: string;
  migrationsDir: string;
  lines: string[];
}

function box(): Box {
  const root = mkdtempSync(join(tmpdir(), "cashback-gate-"));
  const dataDir = join(root, "data", "dev");
  const migrationsDir = join(root, "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  return { root, dataDir, ledgerPath: join(dataDir, "ledger.sqlite"), backupsDir: join(dataDir, "backups"), migrationsDir, lines: [] };
}

function addMigrations(b: Box, files: Record<string, string>): void {
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(b.migrationsDir, name), sql);
}

function gate(b: Box, extra: Partial<Parameters<typeof openMigratedLedger>[0]> = {}) {
  const logger = createLogger({ destination: { write: (line: string) => void b.lines.push(line) } });
  return openMigratedLedger({ ledgerPath: b.ledgerPath, migrationsDir: b.migrationsDir, backupsDir: b.backupsDir, clock, logger, ...extra });
}

const events = (b: Box) => b.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
const backups = (b: Box) => (existsSync(b.backupsDir) ? readdirSync(b.backupsDir) : []);

/** A ledger already at migration 0001, closed. */
async function seeded(b: Box): Promise<void> {
  addMigrations(b, FIRST);
  (await gate(b)).close();
  b.lines.length = 0;
}

function rows(path: string): unknown[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare("SELECT id, name FROM things ORDER BY id").all();
  } finally {
    db.close();
  }
}

/** A copy of a real database with one table page overwritten, so integrity_check fails. */
function corruptCopy(source: string, target: string): void {
  const bytes = readFileSync(source);
  const pageSize = bytes.readUInt16BE(16) || 65_536;
  bytes.fill(0x5a, pageSize + 8, pageSize * 2);
  writeFileSync(target, bytes);
}

describe("Story 1.7: migrations run only after a checked local backup (AD-26)", () => {
  it("AC1: a pending migration is applied only after a backup under data/<env>/backups/ passed integrity_check", async () => {
    const b = box();
    await seeded(b);
    const before = backups(b);
    addMigrations(b, SECOND_OK);
    const ledger = await gate(b);
    ledger.close();

    const written = backups(b).filter((name) => !before.includes(name));
    expect(written).toHaveLength(1);
    const backup = join(b.backupsDir, written[0] ?? "");
    expect(checkIntegrity(backup)).toEqual({ ok: true, problems: [] });
    expect(rows(backup)).toEqual([{ id: 1, name: "kept" }]);
    expect(rows(b.ledgerPath)).toEqual([{ id: 1, name: "kept" }, { id: 2, name: "second" }]);
    const order = events(b).map((e) => e["msg"]);
    expect(order).toEqual(["platform.backup.written", "platform.backup.checked", "platform.migration.applied"]);
    expect(events(b)[2]).toMatchObject({ migrations: ["0002_add_more.sql"] });
  });

  it("AC1: the first migration of an empty data directory is gated too", async () => {
    const b = box();
    addMigrations(b, FIRST);
    (await gate(b)).close();
    expect(backups(b)).toHaveLength(1);
    expect(backups(b)[0]).toMatch(/^2026-10-30T12-00-00\.000Z-pre-migration\.sqlite$/);
  });

  it("AC2: a migration that throws halfway restores the pre-migration copy, refuses to start and logs its name", async () => {
    const b = box();
    await seeded(b);
    addMigrations(b, BROKEN);
    const failure = await gate(b).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(MigrationGateError);
    expect(failure).toMatchObject({ code: "migration_failed", migration: "0003_broken.sql" });

    // 0002 had committed before 0003 failed; the restore takes the ledger back before both.
    expect(rows(b.ledgerPath)).toEqual([{ id: 1, name: "kept" }]);
    const reopened = openLedger(b.ledgerPath);
    expect(reopened.sqlite.prepare("SELECT id FROM schema_migrations").all()).toEqual([{ id: 1 }]);
    expect(reopened.sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    reopened.close();
    expect(events(b).find((e) => e["msg"] === "platform.migration.failed")).toMatchObject({ level: 50, migration: "0003_broken.sql" });
  });

  it("AC3: with no pending migration no backup is taken", async () => {
    const b = box();
    await seeded(b);
    const before = backups(b);
    (await gate(b)).close();
    expect(backups(b)).toEqual(before);
    expect(events(b).map((e) => e["msg"])).not.toContain("platform.backup.written");
  });

  it("AC3: an empty migrations folder on an empty data directory takes no backup", async () => {
    const b = box();
    (await gate(b)).close();
    expect(existsSync(b.backupsDir)).toBe(false);
  });

  it("AC4: a backup copy that fails integrity_check applies no migration and refuses to start", async () => {
    const b = box();
    await seeded(b);
    addMigrations(b, SECOND_OK);
    const corruptBackup = async (_ledger: unknown, target: string) => corruptCopy(b.ledgerPath, target);
    const failure = await gate(b, { backup: corruptBackup }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: "backup_check_failed" });
    expect(rows(b.ledgerPath)).toEqual([{ id: 1, name: "kept" }]);
    const reopened = openLedger(b.ledgerPath);
    expect(reopened.sqlite.prepare("SELECT id FROM schema_migrations").all()).toEqual([{ id: 1 }]);
    reopened.close();
    expect(events(b).map((e) => e["msg"])).toContain("platform.backup.check_failed");
    expect(events(b).map((e) => e["msg"])).not.toContain("platform.migration.applied");
  });

  it("checkIntegrity reports a damaged file, and a file that is not a database, as not ok", () => {
    const b = box();
    const good = join(b.root, "good.sqlite");
    const db = new Database(good);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); CREATE INDEX t_v ON t (v);");
    const insert = db.prepare("INSERT INTO t (v) VALUES (?)");
    for (let i = 0; i < 500; i++) insert.run(`value-${i}`);
    db.close();
    expect(checkIntegrity(good).ok).toBe(true);
    corruptCopy(good, join(b.root, "bad.sqlite"));
    expect(checkIntegrity(join(b.root, "bad.sqlite")).ok).toBe(false);
    writeFileSync(join(b.root, "text.sqlite"), "not a database at all, just text that is long enough".repeat(20));
    expect(checkIntegrity(join(b.root, "text.sqlite")).ok).toBe(false);
    expect(checkIntegrity(join(b.root, "missing.sqlite")).ok).toBe(false);
  });
});

describe("Story 1.7 AC5: rehearse migration on a copy of a backup", () => {
  function liveWithBackup(b: Box): { backupFile: string; liveBytes: Buffer; backupBytes: Buffer } {
    const live = openLedger(b.ledgerPath);
    addMigrations(b, FIRST);
    runMigrations(live, readMigrations(b.migrationsDir), clock);
    live.close();
    const backupFile = join(b.root, "prod-backup.sqlite");
    writeFileSync(backupFile, readFileSync(b.ledgerPath));
    return { backupFile, liveBytes: readFileSync(b.ledgerPath), backupBytes: readFileSync(backupFile) };
  }

  it("AC5: applies pending migrations to a temporary copy and reports success without touching the live ledger", () => {
    const b = box();
    const { backupFile, liveBytes, backupBytes } = liveWithBackup(b);
    addMigrations(b, SECOND_OK);
    expect(rehearseMigrations({ backupFile, migrationsDir: b.migrationsDir, clock })).toEqual({ ok: true, applied: ["0002_add_more.sql"] });
    expect(readFileSync(b.ledgerPath).equals(liveBytes)).toBe(true);
    expect(readFileSync(backupFile).equals(backupBytes)).toBe(true);
  });

  it("AC5: reports the failing migration, and still touches neither the live ledger nor the backup", () => {
    const b = box();
    const { backupFile, liveBytes, backupBytes } = liveWithBackup(b);
    addMigrations(b, BROKEN);
    const result = rehearseMigrations({ backupFile, migrationsDir: b.migrationsDir, clock });
    expect(result).toMatchObject({ ok: false, failedMigration: "0003_broken.sql" });
    expect(readFileSync(b.ledgerPath).equals(liveBytes)).toBe(true);
    expect(readFileSync(backupFile).equals(backupBytes)).toBe(true);
  });

  it("AC5: a backup that fails integrity_check is reported before any migration runs", () => {
    const b = box();
    const { backupFile } = liveWithBackup(b);
    const bad = join(b.root, "bad-backup.sqlite");
    corruptCopy(backupFile, bad);
    addMigrations(b, SECOND_OK);
    expect(rehearseMigrations({ backupFile: bad, migrationsDir: b.migrationsDir, clock })).toMatchObject({ ok: false, failedMigration: null });
  });
});

describe("Story 1.7 review: failures around the backup and the restore", () => {
  it("review 8: a backup that fails integrity_check is quarantined as .corrupt and fails with backup_check_failed", async () => {
    const b = box();
    await seeded(b);
    const before = backups(b);
    addMigrations(b, SECOND_OK);
    const corruptBackup = async (_ledger: unknown, target: string) => corruptCopy(b.ledgerPath, target);
    const failure = await gate(b, { backup: corruptBackup }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(MigrationGateError);
    expect(failure).toMatchObject({ code: "backup_check_failed" });
    const added = backups(b).filter((name) => !before.includes(name));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/\.sqlite\.corrupt$/);
  });

  it("review 8: a backup write that throws removes the partial file and fails with backup_failed", async () => {
    const b = box();
    await seeded(b);
    const before = backups(b);
    addMigrations(b, SECOND_OK);
    const failingBackup = async (_ledger: unknown, target: string) => {
      writeFileSync(target, "partial");
      throw new Error("disk full");
    };
    const failure = await gate(b, { backup: failingBackup }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(MigrationGateError);
    expect(failure).toMatchObject({ code: "backup_failed" });
    expect(backups(b)).toEqual(before);
    expect(rows(b.ledgerPath)).toEqual([{ id: 1, name: "kept" }]);
    expect(events(b).map((e) => e["msg"])).toContain("platform.backup.failed");
  });

  it("review 7: a restore that fails logs both errors and throws one error carrying both and the backup path", async () => {
    const b = box();
    await seeded(b);
    addMigrations(b, BROKEN);
    const failingRestore = () => {
      throw new Error("restore copy failed");
    };
    const failure = (await gate(b, { restore: failingRestore }).then(
      () => null,
      (error: unknown) => error,
    )) as MigrationGateError | null;
    expect(failure).toBeInstanceOf(MigrationGateError);
    expect(failure).toMatchObject({ code: "restore_failed", migration: "0003_broken.sql" });
    expect(failure?.backup).toMatch(/pre-migration(-\d+)?\.sqlite$/);
    expect(failure?.cause).toBeInstanceOf(AggregateError);
    const messages = ((failure?.cause as AggregateError).errors as Error[]).map((e) => e.message);
    expect(messages.some((m) => m.includes("0003_broken.sql"))).toBe(true);
    expect(messages).toContain("restore copy failed");
    const logged = events(b);
    expect(logged.find((e) => e["msg"] === "platform.migration.failed")).toMatchObject({ migration: "0003_broken.sql", backup: failure?.backup });
    expect(logged.find((e) => e["msg"] === "platform.migration.restore_failed")).toMatchObject({ level: 60, backup: failure?.backup });
  });

  it("review 7: restoreLedgerFile copies to a temporary file and renames, so a failed copy leaves the ledger whole", () => {
    const b = box();
    mkdirSync(b.dataDir, { recursive: true });
    writeFileSync(b.ledgerPath, "current ledger bytes");
    expect(() => restoreLedgerFile(join(b.root, "no-such-backup.sqlite"), b.ledgerPath)).toThrow();
    expect(readFileSync(b.ledgerPath, "utf8")).toBe("current ledger bytes");
    expect(readdirSync(b.dataDir)).toEqual(["ledger.sqlite"]);
    const backup = join(b.root, "backup.sqlite");
    writeFileSync(backup, "restored bytes");
    restoreLedgerFile(backup, b.ledgerPath);
    expect(readFileSync(b.ledgerPath, "utf8")).toBe("restored bytes");
    expect(readdirSync(b.dataDir)).toEqual(["ledger.sqlite"]);
  });
});

describe("Story 1.7 review 10: pending migrations are computed once", () => {
  it("runMigrations applies exactly the pending list it is given", () => {
    const b = box();
    addMigrations(b, { ...FIRST, ...SECOND_OK });
    const ledger = openLedger(b.ledgerPath);
    const all = readMigrations(b.migrationsDir);
    expect(runMigrations(ledger, all, clock, all.slice(0, 1))).toEqual(["0001_things.sql"]);
    expect(pendingMigrations(ledger, all).map((m) => m.name)).toEqual(["0002_add_more.sql"]);
    ledger.close();
  });

  it("runMigrations refuses a pending list holding a migration already applied", () => {
    const b = box();
    addMigrations(b, FIRST);
    const ledger = openLedger(b.ledgerPath);
    const all = readMigrations(b.migrationsDir);
    runMigrations(ledger, all, clock);
    expect(() => runMigrations(ledger, all, clock, all)).toThrow(/already applied/);
    ledger.close();
  });
});

describe("Story 1.7 review 9: every rehearsal failure is a result with a reason", () => {
  it("a missing backup file", () => {
    const b = box();
    expect(rehearseMigrations({ backupFile: join(b.root, "missing.sqlite"), migrationsDir: b.migrationsDir, clock })).toMatchObject({ ok: false, reason: "backup_missing", failedMigration: null });
  });

  it("a migrations folder with a bad file name", () => {
    const b = box();
    const backupFile = join(b.root, "backup.sqlite");
    new Database(backupFile).close();
    addMigrations(b, { "add_things.sql": "SELECT 1;" });
    expect(rehearseMigrations({ backupFile, migrationsDir: b.migrationsDir, clock })).toMatchObject({ ok: false, reason: "migrations_invalid", failedMigration: null });
  });

  it("a missing migrations folder", () => {
    const b = box();
    const backupFile = join(b.root, "backup.sqlite");
    new Database(backupFile).close();
    expect(rehearseMigrations({ backupFile, migrationsDir: join(b.root, "nowhere"), clock })).toMatchObject({ ok: false, reason: "migrations_invalid" });
  });

  it("a failing migration and a damaged backup carry their reasons", () => {
    const b = box();
    const backupFile = join(b.root, "backup.sqlite");
    new Database(backupFile).close();
    addMigrations(b, { ...FIRST, "0002_broken.sql": "INSERT INTO nowhere VALUES (1);" });
    expect(rehearseMigrations({ backupFile, migrationsDir: b.migrationsDir, clock })).toMatchObject({ ok: false, reason: "migration_failed", failedMigration: "0002_broken.sql" });
    writeFileSync(join(b.root, "text.sqlite"), "not a database".repeat(50));
    expect(rehearseMigrations({ backupFile: join(b.root, "text.sqlite"), migrationsDir: b.migrationsDir, clock })).toMatchObject({ ok: false, reason: "backup_check_failed" });
  });
});
