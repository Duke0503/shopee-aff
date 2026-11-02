/**
 * Story 8.2: daily and off-site encrypted backups that check their own restore. The ledger and the
 * proof images go into one tar archive, checked by a restore into a temporary folder (integrity,
 * entries, row counts), encrypted with age and copied to Google Drive with rclone. age and rclone
 * are fakes here (a runner that never starts a program, except the one test of the real runner,
 * which starts only Node itself), so no test reaches Google Drive.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addVnDays, instantFromMs, parseInstant, toMs, vnDayStart, type Instant, type VnDate } from "@cashback/core";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { overviewOf } from "../src/admin/overview.query";
import { lastBackupOf } from "../src/health/owner-jobs";
import { ledgerAlerts } from "../src/modules/operations/index";
import { fileProofStore } from "../src/modules/payouts/index";
import { extractArchive, isSafeEntryName } from "../src/platform/backup/backup-archive";
import { archiveName, retainedArchives } from "../src/platform/backup/backup-retention";
import { backupStatusPath, readBackupStatus, writeBackupStatus, NO_BACKUP_YET } from "../src/platform/backup/backup-status";
import { isSecretFile } from "../src/platform/backup/checked-archive";
import { dailyBackupDir, runDailyBackup, type DailyBackupDeps } from "../src/platform/backup/daily-backup.job";
import { offsiteStore, spawnExecutable, type OffsiteConfig, type RunExecutable } from "../src/platform/backup/offsite.adapter";
import { parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { isolationProblems, productionIdentifiers } from "../src/platform/config/isolation.config";
import { backupLedger, checkIntegrity, rowCountMismatches, tableRowCounts } from "../src/platform/db/backup";
import type { Ledger } from "../src/platform/db/ledger";
import { MigrationGateError, openMigratedLedger } from "../src/platform/db/migration-gate";
import type { AlertPort, AlertSeverity } from "../src/platform/ports/alert.port";
import { alertRows, memoryLogger } from "./helpers/link-ledger";
import { tempDir } from "./helpers/live-fixture";
import { closeLedgers, freshLedger, movingClock } from "./helpers/order-ledger";

afterEach(closeLedgers);

const RECIPIENT = `age1${"q".repeat(58)}`;
const OFFSITE: OffsiteConfig = { agePath: "C:/tools/age/age.exe", ageRecipient: RECIPIENT, rclonePath: "C:/tools/rclone/rclone.exe", rcloneRemote: "gdrive:cashback-backups/dev", rcloneConfig: null };
const AGE_HEADER = "age-encryption.org/v1\n";
const PROOF = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
/** 03:00 on 2026-11-02 in Vietnam. */
const RUN_AT = "2026-11-01T20:00:00.000Z";

/** age and rclone as fakes over a folder standing for Google Drive; the fake age is reversible so a test can restore. */
function fakeTools(drive: string, fail: { readonly age?: boolean; readonly upload?: boolean } = {}) {
  const calls: string[][] = [];
  const run: RunExecutable = async (file, args) => {
    calls.push([file, ...args]);
    if (file === OFFSITE.agePath) {
      if (fail.age) return { code: 1, stdout: "" };
      writeFileSync(args[args.indexOf("--output") + 1] as string, AGE_HEADER + readFileSync(args[args.length - 1] as string).toString("base64"));
      return { code: 0, stdout: "" };
    }
    const [command, first, second] = args;
    const name = (remote: string) => remote.split("/").pop() as string;
    if (command === "copyto") {
      if (fail.upload) return { code: 7, stdout: "" };
      copyFileSync(first as string, join(drive, name(second as string)));
    }
    if (command === "lsf") return { code: 0, stdout: readdirSync(drive).map((f) => `${f}\n`).join("") };
    if (command === "deletefile") rmSync(join(drive, name(first as string)));
    return { code: 0, stdout: "" };
  };
  return { run, calls };
}

const decrypt = (path: string): Buffer => {
  const text = readFileSync(path, "utf8");
  expect(text.startsWith(AGE_HEADER)).toBe(true);
  return Buffer.from(text.slice(AGE_HEADER.length), "base64");
};

interface Setup {
  readonly dataDir: string;
  readonly drive: string;
  readonly ledger: Ledger;
  readonly clock: ReturnType<typeof movingClock>;
  readonly tools: ReturnType<typeof fakeTools>;
  readonly lines: string[];
  readonly deps: DailyBackupDeps;
}

function setup(options: { fail?: Parameters<typeof fakeTools>[1]; offsite?: boolean; production?: boolean } = {}): Setup {
  const dataDir = tempDir("cashback-backup-");
  const drive = tempDir("cashback-drive-");
  const ledger = freshLedger(join(dataDir, "ledger.sqlite"));
  mkdirSync(join(dataDir, "files", "proofs"), { recursive: true });
  writeFileSync(join(dataDir, "files", "proofs", "0a1b2c3d.jpg"), PROOF);
  const clock = movingClock(RUN_AT);
  const tools = fakeTools(drive, options.fail);
  const { logger, lines } = memoryLogger();
  const deps: DailyBackupDeps = { ledger, dataDir, clock, logger, alerts: ledgerAlerts(ledger, clock), offsite: options.offsite === false ? null : offsiteStore(OFFSITE, tools.run), offsiteRequired: options.production ?? false };
  return { dataDir, drive, ledger, clock, tools, lines, deps };
}

/** The Drive copy decrypted and extracted into a new temporary folder. */
async function restoreFromDrive(s: Setup): Promise<{ dir: string; names: string[] }> {
  const [copy] = readdirSync(s.drive);
  const tar = join(tempDir("cashback-restore-tar-"), "backup.tar");
  writeFileSync(tar, decrypt(join(s.drive, copy as string)));
  const dir = tempDir("cashback-restored-");
  return { dir, names: (await extractArchive(tar, dir)).map((e) => e.name) };
}

const backupHealthOf = (s: Setup) => overviewOf(s.ledger.db, { period: "today" }, s.clock, { backup: lastBackupOf(s.dataDir) }).health.find((h) => h.component === "backup");

describe("Story 8.2: daily and off-site encrypted backups that check their own restore", () => {
  it("AC1: given the daily run, when it finishes, then a local copy exists that passed integrity_check, its restored row counts equal the live counts, and the encrypted file is on Google Drive", async () => {
    const s = setup();
    const run = await runDailyBackup(s.deps);
    expect(run.outcome).toBe("ok");
    const name = archiveName(RUN_AT as Instant);
    expect(readdirSync(dailyBackupDir(s.dataDir))).toEqual([name]);
    const restored = tempDir("cashback-local-restore-");
    await extractArchive(join(dailyBackupDir(s.dataDir), name), restored);
    expect(checkIntegrity(join(restored, "ledger.sqlite")).ok).toBe(true);
    expect(rowCountMismatches(join(restored, "ledger.sqlite"), tableRowCounts(s.ledger.sqlite))).toEqual([]);
    expect(readdirSync(s.drive)).toEqual([`${name}.age`]);
    expect(readBackupStatus(backupStatusPath(s.dataDir))).toMatchObject({ lastGoodAt: RUN_AT, lastOffsiteAt: RUN_AT, lastOutcome: "ok", failedStep: null });
    expect(backupHealthOf(s)).toEqual({ component: "backup", state: "up", at: RUN_AT });
    expect(alertRows(s.ledger)).toEqual([]);
  });

  it("AC2: given an rclone failure, when the run ends, then the local copy is kept, a high alert is raised and the Overview health line shows the last good backup time", async () => {
    const s = setup({ fail: { upload: true } });
    const run = await runDailyBackup(s.deps);
    expect(run.outcome).toBe("offsite_failed");
    expect(readdirSync(dailyBackupDir(s.dataDir))).toEqual([archiveName(RUN_AT as Instant)]);
    expect(readdirSync(s.drive)).toEqual([]);
    expect(alertRows(s.ledger)).toEqual([{ kind: "backup_offsite_failed", severity: "high", suppressed: 0 }]);
    expect(backupHealthOf(s)).toEqual({ component: "backup", state: "down", at: RUN_AT });
    const failed = s.lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l["msg"] === "platform.backup.offsite_failed");
    expect(failed).toMatchObject({ step: "upload", code: 7 });
    expect(JSON.stringify(s.lines)).not.toContain("gdrive:");
  });

  it("AC3: given 40 daily copies, when retention runs, then 30 daily and the monthly copies remain", () => {
    const days = Array.from({ length: 40 }, (_, i) => addVnDays("2026-09-24" as VnDate, i));
    const names = days.map((day) => archiveName(instantFromMs(toMs(vnDayStart(day)) + 3 * 3_600_000)));
    const { keep, drop } = retainedArchives(names);
    const kept = (day: string) => keep.includes(archiveName(instantFromMs(toMs(vnDayStart(day as VnDate)) + 3 * 3_600_000)));
    expect(keep).toHaveLength(32);
    expect(drop).toHaveLength(8);
    expect(days.slice(-30).every(kept)).toBe(true);
    // The first copy of each older Vietnam month is the monthly copy.
    expect(kept("2026-09-24") && kept("2026-10-01")).toBe(true);
    expect(kept("2026-09-25") || kept("2026-10-02")).toBe(false);
    // A file that is not an archive is never dropped.
    expect(retainedArchives([...names, "notes.txt", "x.tar.corrupt"]).drop).toEqual(drop);
  });

  it("AC3: retention keeps exactly 30 daily and 12 monthly copies, locally and on Google Drive", async () => {
    const names = Array.from({ length: 400 }, (_, i) => archiveName(instantFromMs(toMs(parseInstant(RUN_AT)) - (i + 1) * 86_400_000)));
    const { keep } = retainedArchives(names);
    expect(keep).toHaveLength(42);
    const s = setup();
    for (const name of names.slice(0, 60)) {
      writeFileSync(join(s.drive, `${name}.age`), AGE_HEADER);
      mkdirSync(dailyBackupDir(s.dataDir), { recursive: true });
      writeFileSync(join(dailyBackupDir(s.dataDir), name), "");
    }
    const run = await runDailyBackup(s.deps);
    expect(run.outcome).toBe("ok");
    const expected = retainedArchives([archiveName(RUN_AT as Instant), ...names.slice(0, 60)]).keep;
    expect(expected).toHaveLength(30 + 2);
    expect(readdirSync(dailyBackupDir(s.dataDir)).sort()).toEqual([...expected].sort());
    expect(readdirSync(s.drive).sort()).toEqual(expected.map((n) => `${n}.age`).sort());
  });

  it("AC4: given the backup file, when it is inspected, then it is age-encrypted and contains no env file or cloudflared credentials", async () => {
    const s = setup();
    writeFileSync(join(s.dataDir, "dev.env"), "INTERNAL_TOKEN=secret");
    for (const secret of [".env", "dev.env", "cloudflared/credentials.json", "cloudflared/cert.pem", "proofs/tunnel.key"]) {
      mkdirSync(join(s.dataDir, "files", secret, ".."), { recursive: true });
      writeFileSync(join(s.dataDir, "files", secret), "secret");
    }
    await runDailyBackup(s.deps);
    const [copy] = readdirSync(s.drive);
    const bytes = readFileSync(join(s.drive, copy as string));
    expect(bytes.subarray(0, AGE_HEADER.length).toString()).toBe(AGE_HEADER);
    expect(bytes.includes("SQLite format 3")).toBe(false);
    expect(s.tools.calls[0]).toEqual([OFFSITE.agePath, "--encrypt", "--recipient", RECIPIENT, "--output", expect.stringMatching(/\.tar\.age$/), expect.stringMatching(/\.tar$/)]);
    const { names } = await restoreFromDrive(s);
    expect(names).toEqual(["ledger.sqlite", "files/proofs/0a1b2c3d.jpg"]);
    expect(isSecretFile("cloudflared\\0a.json") && isSecretFile("prod.env") && isSecretFile(".env.local") && !isSecretFile("proofs/0a1b.png")).toBe(true);
  });

  it("AC5: given the proof images directory, when a backup is restored to a temporary location, then the images are present", async () => {
    const s = setup();
    await runDailyBackup(s.deps);
    const { dir } = await restoreFromDrive(s);
    expect(readFileSync(join(dir, "files", "proofs", "0a1b2c3d.jpg"))).toEqual(PROOF);
    const restored = new Database(join(dir, "ledger.sqlite"), { readonly: true });
    try {
      expect(restored.prepare("SELECT customer_id FROM customers ORDER BY customer_id").all()).toEqual(s.ledger.sqlite.prepare("SELECT customer_id FROM customers ORDER BY customer_id").all());
    } finally {
      restored.close();
    }
  });

  it("a daily copy whose restore check fails raises the high backup_failed alert, is kept aside and is never uploaded", async () => {
    const s = setup();
    const tampered = async (ledger: Ledger, target: string) => {
      await backupLedger(ledger, target);
      const copy = new Database(target);
      try {
        copy.pragma("foreign_keys = OFF");
        copy.exec("DELETE FROM customers WHERE customer_id = 'C2'");
      } finally {
        copy.close();
      }
    };
    const run = await runDailyBackup({ ...s.deps, writeCopy: tampered });
    expect(run.outcome).toBe("local_failed");
    expect(readdirSync(dailyBackupDir(s.dataDir))).toEqual([`${archiveName(RUN_AT as Instant)}.corrupt`]);
    expect(readdirSync(s.drive)).toEqual([]);
    expect(s.tools.calls).toEqual([]);
    expect(alertRows(s.ledger)).toEqual([{ kind: "backup_failed", severity: "high", suppressed: 0 }]);
    expect(readBackupStatus(backupStatusPath(s.dataDir))).toMatchObject({ lastOutcome: "local_failed", failedStep: "restore_check", lastGoodAt: null });
    expect(backupHealthOf(s)?.state).toBe("down");
  });

  it("without an off-site configuration dev keeps the local copy only, while production reports the off-site copy as failed", async () => {
    const dev = setup({ offsite: false });
    expect((await runDailyBackup(dev.deps)).outcome).toBe("offsite_skipped");
    expect(alertRows(dev.ledger)).toEqual([]);
    expect(backupHealthOf(dev)?.state).toBe("up");
    const prod = setup({ offsite: false, production: true });
    expect((await runDailyBackup(prod.deps)).outcome).toBe("offsite_failed");
    expect(alertRows(prod.ledger)).toEqual([{ kind: "backup_offsite_failed", severity: "high", suppressed: 0 }]);
  });

  it("a good copy older than 26 hours counts as a missed daily run: the health line goes down", async () => {
    const s = setup();
    await runDailyBackup(s.deps);
    s.clock.advance(26 * 3_600_000 + 1);
    expect(backupHealthOf(s)).toEqual({ component: "backup", state: "down", at: RUN_AT });
    writeBackupStatus(backupStatusPath(s.dataDir), NO_BACKUP_YET);
    expect(backupHealthOf(s)).toEqual({ component: "backup", state: "unknown", at: null });
  });
});

describe("Story 8.2 review: backups that never lose a copy or fill the disk", () => {
  /** Sets a file's modification time `ms` before the test clock's now. */
  const age = (path: string, s: Setup, ms: number) => {
    const seconds = (toMs(s.clock.now()) - ms) / 1000;
    utimesSync(path, seconds, seconds);
  };

  it("review 1: an archive carries an archive's name only after its restore check passed; a stopped run's partial archive is never taken for a backup", async () => {
    const s = setup();
    const dir = dailyBackupDir(s.dataDir);
    // What a run killed while writing leaves: a truncated tar inside its work folder.
    mkdirSync(join(dir, ".work-killed"), { recursive: true });
    writeFileSync(join(dir, ".work-killed", "archive.tar.partial"), "trunc");
    age(join(dir, ".work-killed"), s, 2 * 86_400_000);
    const run = await runDailyBackup(s.deps);
    expect(run.outcome).toBe("ok");
    expect(readdirSync(dir)).toEqual([archiveName(RUN_AT as Instant)]);
    expect(retainedArchives(["archive.tar.partial", ".work-killed"]).keep).toEqual([]);
    // A restore check that fails leaves only `.corrupt`, never the plain name, and no work folder.
    s.clock.advance(60_000);
    const tampered = async (ledger: Ledger, target: string) => {
      await backupLedger(ledger, target);
      const copy = new Database(target);
      try {
        copy.exec("DELETE FROM campaigns");
      } finally {
        copy.close();
      }
    };
    expect((await runDailyBackup({ ...s.deps, writeCopy: tampered })).outcome).toBe("local_failed");
    expect(readdirSync(dir).sort()).toEqual([archiveName(RUN_AT as Instant), `${archiveName(s.clock.now())}.corrupt`].sort());
  });

  it("review 3: a local retention error is logged and the off-site copy still runs", async () => {
    const s = setup();
    const dir = dailyBackupDir(s.dataDir);
    const old = Array.from({ length: 31 }, (_, i) => archiveName(instantFromMs(toMs(parseInstant(RUN_AT)) - (i + 1) * 86_400_000)));
    mkdirSync(dir, { recursive: true });
    for (const name of old) writeFileSync(join(dir, name), "");
    // The archive retention drops cannot be deleted as a file: it is a folder with content.
    // The 30th old copy is dropped (the 31st is kept as October's monthly copy).
    const stuck = old[29] as string;
    expect(retainedArchives([archiveName(RUN_AT as Instant), ...old]).drop).toEqual([stuck]);
    rmSync(join(dir, stuck));
    mkdirSync(join(dir, stuck, "inside"), { recursive: true });
    const run = await runDailyBackup(s.deps);
    expect(run.outcome).toBe("ok");
    expect(readdirSync(s.drive)).toEqual([`${archiveName(RUN_AT as Instant)}.age`]);
    expect(s.lines.some((l) => l.includes("platform.backup.retention_failed"))).toBe(true);
    expect(alertRows(s.ledger)).toEqual([]);
  });

  it("review 5: an unsafe file name under files/ is skipped and counted, never failing the backup", async () => {
    const s = setup();
    writeFileSync(join(s.dataDir, "files", "proofs", "scan (copy) 1.jpg"), "x");
    writeFileSync(join(s.dataDir, "files", "proofs", "\u00e1nh.jpg"), "x");
    const run = await runDailyBackup(s.deps);
    expect(run.outcome).toBe("ok");
    const { names } = await restoreFromDrive(s);
    expect(names).toEqual(["ledger.sqlite", "files/proofs/0a1b2c3d.jpg"]);
    expect(readBackupStatus(backupStatusPath(s.dataDir))).toMatchObject({ lastOutcome: "ok", skippedFiles: 2 });
    expect(s.lines.filter((l) => l.includes("platform.backup.files_skipped"))).toHaveLength(1);
    expect(alertRows(s.ledger)).toEqual([]);
  });

  it("review 5: every proof file the system writes has a name the archive holds safely", () => {
    const store = fileProofStore(join(tempDir("cashback-proof-names-"), "files", "proofs"));
    for (let i = 0; i < 20; i++) {
      for (const type of ["image/jpeg", "image/png"] as const) expect(isSafeEntryName(`files/proofs/${store.write(PROOF, type)}`)).toBe(true);
    }
  });

  it("review 7: keeps the 3 newest .corrupt archives and removes work folders and .age files a stopped run left over a day ago", async () => {
    const s = setup();
    const dir = dailyBackupDir(s.dataDir);
    mkdirSync(dir, { recursive: true });
    const corrupt = [1, 2, 3, 4, 5].map((d) => `${archiveName(instantFromMs(toMs(parseInstant(RUN_AT)) - d * 86_400_000))}.corrupt`);
    for (const name of corrupt) writeFileSync(join(dir, name), "");
    for (const name of [".work-old", ".work-fresh"]) mkdirSync(join(dir, name, "restore"), { recursive: true });
    age(join(dir, ".work-old"), s, 86_400_000 + 60_000);
    const leftover = `${archiveName(instantFromMs(toMs(parseInstant(RUN_AT)) - 2 * 86_400_000))}.age`;
    writeFileSync(join(dir, leftover), AGE_HEADER);
    age(join(dir, leftover), s, 2 * 86_400_000);
    await runDailyBackup(s.deps);
    const left = readdirSync(dir);
    expect(left.filter((n) => n.endsWith(".corrupt")).sort()).toEqual(corrupt.slice(0, 3).sort());
    expect(left).toContain(".work-fresh");
    expect(left).not.toContain(".work-old");
    expect(left).not.toContain(leftover);
  });
});

describe("Story 8.2: the backup before a migration", () => {
  const FIRST = "CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT);\nINSERT INTO things (id, name) VALUES (1, 'kept'), (2, 'also');";
  const SECOND = "INSERT INTO things (id, name) VALUES (3, 'third');";

  function migrationBox() {
    const root = tempDir("cashback-gate-82-");
    const dataDir = join(root, "data", "dev");
    const migrationsDir = join(root, "migrations");
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(join(migrationsDir, "0001_things.sql"), FIRST);
    const raised: [string, AlertSeverity][] = [];
    const alerts: AlertPort = { alert: (kind, severity) => void raised.push([kind, severity]) };
    const { logger } = memoryLogger();
    const clock = movingClock(RUN_AT);
    const open = (extra: Partial<Parameters<typeof openMigratedLedger>[0]> = {}) => openMigratedLedger({ ledgerPath: join(dataDir, "ledger.sqlite"), migrationsDir, backupsDir: join(dataDir, "backups"), clock, logger, alerts, ...extra });
    return { dataDir, migrationsDir, raised, alerts, logger, clock, open };
  }

  it("a backup whose restore check fails raises the alert and blocks the migration", async () => {
    const b = migrationBox();
    (await b.open()).close();
    writeFileSync(join(b.migrationsDir, "0002_more.sql"), SECOND);
    const tampered = async (ledger: Ledger, target: string) => {
      await backupLedger(ledger, target);
      const copy = new Database(target);
      copy.exec("DELETE FROM things WHERE id = 2");
      copy.close();
    };
    const error = await b.open({ backup: tampered }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationGateError);
    expect((error as MigrationGateError).code).toBe("restore_check_failed");
    expect(b.raised).toEqual([["backup_failed", "high"]]);
    const ledger = new Database(join(b.dataDir, "ledger.sqlite"), { readonly: true });
    try {
      expect(ledger.prepare("SELECT id FROM things ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
      expect(ledger.prepare("SELECT name FROM schema_migrations").all()).toEqual([{ name: "0001_things.sql" }]);
    } finally {
      ledger.close();
    }
    expect(readdirSync(join(b.dataDir, "backups")).some((f) => f.endsWith(".sqlite.corrupt"))).toBe(true);
  });

  it("the off-site copy failing does not block startup but alerts", async () => {
    const b = migrationBox();
    (await b.open()).close();
    writeFileSync(join(b.migrationsDir, "0002_more.sql"), SECOND);
    let migrated = false;
    const ledger = await b.open({ onMigrated: () => void (migrated = true) });
    try {
      expect(migrated).toBe(true);
      const drive = tempDir("cashback-drive-");
      const run = await runDailyBackup({ ledger, dataDir: b.dataDir, clock: b.clock, logger: b.logger, alerts: b.alerts, offsite: offsiteStore(OFFSITE, fakeTools(drive, { upload: true }).run), offsiteRequired: true });
      expect(run.outcome).toBe("offsite_failed");
      expect(b.raised).toEqual([["backup_offsite_failed", "high"]]);
      expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM things").get()).toEqual({ n: 3 });
      expect(existsSync(run.archive as string)).toBe(true);
    } finally {
      ledger.close();
    }
  });
});

describe("Story 8.2: age and rclone as configured executables", () => {
  it("builds the age and rclone command lines from the config, with rclone's own config file when set", async () => {
    const calls: string[][] = [];
    const store = offsiteStore({ ...OFFSITE, rcloneConfig: "C:/Users/owner/rclone.conf" }, async (file, args) => {
      calls.push([file, ...args]);
      return { code: 0, stdout: "a.tar.age\r\nb.tar.age\r\n" };
    });
    await store.encrypt("in.tar", "in.tar.age");
    await store.upload("in.tar.age", "x.tar.age");
    expect(await store.list()).toEqual(["a.tar.age", "b.tar.age"]);
    await store.remove("a.tar.age");
    expect(calls).toEqual([
      [OFFSITE.agePath, "--encrypt", "--recipient", RECIPIENT, "--output", "in.tar.age", "in.tar"],
      [OFFSITE.rclonePath, "copyto", "in.tar.age", "gdrive:cashback-backups/dev/x.tar.age", "--config", "C:/Users/owner/rclone.conf"],
      [OFFSITE.rclonePath, "lsf", "--files-only", "gdrive:cashback-backups/dev", "--config", "C:/Users/owner/rclone.conf"],
      [OFFSITE.rclonePath, "deletefile", "gdrive:cashback-backups/dev/a.tar.age", "--config", "C:/Users/owner/rclone.conf"],
    ]);
  });

  it("the real runner starts a program without a shell and reports its exit code and output", async () => {
    expect(await spawnExecutable(process.execPath, ["-e", "process.stdout.write('one\\ntwo'); process.exit(3)"], { timeoutMs: 20_000 })).toEqual({ code: 3, stdout: "one\ntwo" });
    expect((await spawnExecutable(join(tmpdir(), "no-such-tool-8-2.exe"), [], { timeoutMs: 5_000 })).code).toBeNull();
  });

  it("the off-site keys come all four or none, the recipient is a public key, and dev never writes into production's Drive folder", () => {
    const TOKEN = "t".repeat(40);
    const keys = { BACKUP_AGE_PATH: join(tmpdir(), "age.exe"), BACKUP_AGE_RECIPIENT: RECIPIENT, BACKUP_RCLONE_PATH: join(tmpdir(), "rclone.exe"), BACKUP_RCLONE_REMOTE: "gdrive:cashback-backups/dev" };
    expect(parseConfig("dev", { INTERNAL_TOKEN: TOKEN }).backupOffsite).toBeNull();
    expect(parseConfig("dev", { INTERNAL_TOKEN: TOKEN, ...keys }).backupOffsite).toEqual({ agePath: keys.BACKUP_AGE_PATH, ageRecipient: RECIPIENT, rclonePath: keys.BACKUP_RCLONE_PATH, rcloneRemote: keys.BACKUP_RCLONE_REMOTE, rcloneConfig: null });
    expect(() => parseConfig("dev", { INTERNAL_TOKEN: TOKEN, BACKUP_AGE_PATH: keys.BACKUP_AGE_PATH })).toThrow("config: missing or invalid BACKUP_AGE_RECIPIENT, BACKUP_RCLONE_PATH, BACKUP_RCLONE_REMOTE");
    expect(() => parseConfig("dev", { INTERNAL_TOKEN: TOKEN, ...keys, BACKUP_AGE_RECIPIENT: `AGE-SECRET-KEY-1${"Q".repeat(58)}` })).toThrow(/BACKUP_AGE_RECIPIENT/);
    const context = { identifiers: productionIdentifiers(REPOSITORY_ROOT, join(tmpdir(), "cashback-isolation-home")), prodEnv: { BACKUP_RCLONE_REMOTE: "gdrive:cashback-backups/dev/" }, devFileIsProdFile: false, caseInsensitive: process.platform === "win32" };
    expect(isolationProblems(parseConfig("dev", { INTERNAL_TOKEN: TOKEN, ...keys }), context).map((p) => `${p.key} ${p.reason}`)).toEqual(["BACKUP_RCLONE_REMOTE same_as_production"]);
    expect(isolationProblems(parseConfig("dev", { INTERNAL_TOKEN: TOKEN, ...keys, BACKUP_RCLONE_REMOTE: "gdrive:cashback-backups/dev-own" }), context)).toEqual([]);
  });
});
