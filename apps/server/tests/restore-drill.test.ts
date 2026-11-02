/**
 * Story 8.6: the restore drill procedure. A daily archive carries its manifest (the ledger's
 * SHA-256, row counts and balance totals at backup time); the restore command refuses while the
 * server runs or a -wal/-shm file is beside the ledger, checks everything against the manifest
 * before moving anything, and the drill record feeds the Overview's health line. The archive is
 * the local one (its age round trip is Story 8.2's test); no test reaches Google Drive.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { instantFromMs, toMs, type Instant } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { overviewOf } from "../src/admin/overview.query";
import { dailyBackupDeps, healthSourcesFor } from "../src/health/owner-jobs";
import { assistantHeartbeats, healthCheck, ledgerAlerts, readHealthModel } from "../src/modules/operations/index";
import { balanceTotals, getBalances } from "../src/modules/payouts/index";
import { extractArchive, writeArchive } from "../src/platform/backup/backup-archive";
import { MANIFEST_ENTRY, manifestText, parseManifest, sha256OfFile } from "../src/platform/backup/backup-manifest";
import { dailyBackupDir, runDailyBackup } from "../src/platform/backup/daily-backup.job";
import { DRILL_DUE_AFTER_MS, drillHealth, drillRecordPath, lastDrillOf, readDrillRecord, writeDrillRecord } from "../src/platform/backup/restore-drill";
import { REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { backupLedger, tableRowCounts } from "../src/platform/db/backup";
import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { acquireServerLock, lockFilePath } from "../src/platform/lock/server-lock";
import { restoreLedger, type RestoreOptions } from "../src/restore/restore-ledger";
import { alertRows, memoryLogger } from "./helpers/link-ledger";
import { tempDir } from "./helpers/live-fixture";
import { closeLedgers, freshLedger, movingClock } from "./helpers/order-ledger";

afterEach(closeLedgers);

const RUN_AT = "2026-11-01T20:00:00.000Z";
const PROOF = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);

/** Two customers with approved, waiting and paid money (made-up rows). */
function seed(ledger: Ledger): void {
  const order = ledger.sqlite.prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, estimated_commission, approved_commission, cashback, paid_at, origin) VALUES (?, 'shopee', 'shopee', ?, ?, ?, ?, ?, ?, 'CUTOVER')");
  order.run("261001APPR0001", "C1", "APPROVED", null, 100000, 79216, null);
  order.run("261001APPR0002", "C2", "APPROVED", null, 100000, 36000, null);
  order.run("261001WAIT0001", "C1", "AWAITING_APPROVAL", 50000, null, null, null);
  ledger.sqlite.prepare("INSERT INTO payouts (customer_id, status, transfer_amount, origin) VALUES ('C2', 'RECORDED', 12000, 'CUTOVER')").run();
}

/** The production ledger with its daily archive, taken with the server's own backup deps. */
async function backedUp() {
  const dataDir = tempDir("cashback-prod-");
  const ledger = freshLedger(join(dataDir, "ledger.sqlite"));
  seed(ledger);
  mkdirSync(join(dataDir, "files", "proofs"), { recursive: true });
  writeFileSync(join(dataDir, "files", "proofs", "0a1b2c3d.jpg"), PROOF);
  const clock = movingClock(RUN_AT);
  const { logger } = memoryLogger();
  const config = { env: "dev" as const, dataDir, telegram: null, backupOffsite: null, assistantToken: null };
  const deps = dailyBackupDeps({ config, ledger, clock, logger, heartbeats: assistantHeartbeats(RUN_AT as Instant), health: {} }, ledgerAlerts(ledger, clock));
  const run = await runDailyBackup(deps);
  expect(run.outcome).toBe("offsite_skipped");
  return { ledger, dataDir, archive: run.archive as string, totals: balanceTotals(ledger.db), balances: getBalances(ledger.db, ["C1", "C2"]), clock };
}

const options = (archive: string, dataDir: string, extra: Partial<RestoreOptions> = {}): RestoreOptions => ({ archive, dataDir, clock: movingClock("2026-11-05T02:00:00.000Z"), replace: false, totals: balanceTotals, ...extra });

/** A clean machine's empty data folder. */
const cleanMachine = (): string => tempDir("cashback-clean-");

/** An archive like the daily one, with its manifest changed by `edit`. */
async function tampered(source: Awaited<ReturnType<typeof backedUp>>, edit: (manifest: ReturnType<typeof parseManifest>) => object | null): Promise<string> {
  const work = tempDir("cashback-tamper-");
  const copy = join(work, "ledger.sqlite");
  await backupLedger(source.ledger, copy);
  const manifest = { format: 1 as const, createdAt: RUN_AT, ledgerSha256: await sha256OfFile(copy), rowCounts: tableRowCounts(source.ledger.sqlite), totals: { ...source.totals } };
  const edited = edit(manifest);
  const sources = [{ name: "ledger.sqlite", path: copy }];
  if (edited !== null) {
    writeFileSync(join(work, MANIFEST_ENTRY), manifestText(edited as typeof manifest));
    sources.push({ name: MANIFEST_ENTRY, path: join(work, MANIFEST_ENTRY) });
  }
  const archive = join(work, "archive.tar");
  await writeArchive(archive, sources, 0);
  return archive;
}

describe("Story 8.6: restore drill procedure", () => {
  it("AC1: given a backup archive, when the restore steps are followed on a clean machine, then the server starts on the restored ledger and the balances equal those at backup time", async () => {
    const prod = await backedUp();
    expect(prod.archive.startsWith(dailyBackupDir(prod.dataDir))).toBe(true);
    const opened = tempDir("cashback-opened-");
    expect((await extractArchive(prod.archive, opened)).map((e) => e.name)).toEqual(["ledger.sqlite", MANIFEST_ENTRY, "files/proofs/0a1b2c3d.jpg"]);
    const manifest = parseManifest(readFileSync(join(opened, MANIFEST_ENTRY), "utf8"));
    expect(manifest.totals).toEqual(prod.totals);
    expect(prod.totals).toEqual({ customers: 2, gross: 115216, payable: 115216, waiting: expect.any(Number), paid: 12000, deductedNext: 0 });
    const target = cleanMachine();
    const result = await restoreLedger(options(prod.archive, target));
    expect(result).toMatchObject({ ok: true, files: 1, totals: prod.totals, backupCreatedAt: RUN_AT, movedAside: [] });
    // The server opens the restored ledger and reads the same balances.
    const restored = openLedger(join(target, "ledger.sqlite"));
    try {
      expect(getBalances(restored.db, ["C1", "C2"])).toEqual(prod.balances);
      expect(balanceTotals(restored.db)).toEqual(prod.totals);
    } finally {
      restored.close();
    }
    expect(readFileSync(join(target, "files", "proofs", "0a1b2c3d.jpg"))).toEqual(PROOF);
    expect(readdirSync(join(target, "backups")).filter((n) => n.startsWith(".restore-"))).toEqual([]);
  });

  it("AC2: given a restore without deleting -wal and -shm, when it is run, then it is refused before anything changes", async () => {
    const prod = await backedUp();
    const target = cleanMachine();
    writeFileSync(join(target, "ledger.sqlite-wal"), "newer frames");
    writeFileSync(join(target, "ledger.sqlite-shm"), "index");
    const result = await restoreLedger(options(prod.archive, target));
    expect(result).toEqual({ ok: false, refusal: "side_files_present", problems: ["ledger.sqlite-wal", "ledger.sqlite-shm"] });
    expect(existsSync(join(target, "ledger.sqlite"))).toBe(false);
  });

  it("AC2: the runbook checks for -wal and -shm before the restored file is put in place", () => {
    const runbook = readFileSync(join(REPOSITORY_ROOT, "docs", "operations", "restore-runbook.md"), "utf8");
    const stop = runbook.indexOf("Stop the server");
    const sideFiles = runbook.indexOf("Delete the `-wal` and `-shm` files");
    const restore = runbook.indexOf("pnpm --filter @cashback/server restore:ledger");
    const start = runbook.indexOf("Start the server");
    expect([stop, sideFiles, restore, start].every((i) => i > 0)).toBe(true);
    expect(stop < sideFiles && sideFiles < restore && restore < start).toBe(true);
    expect(runbook).toContain("password manager");
  });

  it("a running server (its lock held) refuses the restore", async () => {
    const prod = await backedUp();
    const target = cleanMachine();
    const lock = acquireServerLock(lockFilePath(target));
    try {
      expect(await restoreLedger(options(prod.archive, target))).toMatchObject({ ok: false, refusal: "server_running" });
    } finally {
      lock?.release();
    }
  });

  it("an existing ledger is replaced only when asked, and is moved aside, never deleted", async () => {
    const prod = await backedUp();
    const target = cleanMachine();
    writeFileSync(join(target, "ledger.sqlite"), "old ledger");
    expect(await restoreLedger(options(prod.archive, target))).toMatchObject({ ok: false, refusal: "ledger_exists" });
    const result = await restoreLedger(options(prod.archive, target, { replace: true }));
    expect(result).toMatchObject({ ok: true, movedAside: ["ledger.sqlite.before-restore-2026-11-05T02-00-00.000Z"] });
    expect(readFileSync(join(target, "ledger.sqlite.before-restore-2026-11-05T02-00-00.000Z"), "utf8")).toBe("old ledger");
  });

  it("review 3: when the check of the ledger in place fails, the previous ledger and files are swapped back and both paths are reported", async () => {
    const prod = await backedUp();
    const target = cleanMachine();
    writeFileSync(join(target, "ledger.sqlite"), "old ledger");
    mkdirSync(join(target, "files", "proofs"), { recursive: true });
    writeFileSync(join(target, "files", "proofs", "old.jpg"), "old proof");
    const stamp = "2026-11-05T02-00-00.000Z";
    const result = await restoreLedger(options(prod.archive, target, { replace: true, checkPlaced: () => ({ ok: false, problems: ["*** in database main ***"] }) }));
    expect(result).toEqual({
      ok: false,
      refusal: "integrity_failed",
      problems: ["*** in database main ***"],
      rolledBack: {
        complete: true,
        putBack: [join(target, "files"), join(target, "ledger.sqlite")],
        failed: [join(target, `files.failed-restore-${stamp}`), join(target, `ledger.sqlite.failed-restore-${stamp}`)],
        stuck: [],
      },
    });
    expect(readFileSync(join(target, "ledger.sqlite"), "utf8")).toBe("old ledger");
    expect(readFileSync(join(target, "files", "proofs", "old.jpg"), "utf8")).toBe("old proof");
    expect(readFileSync(join(target, `files.failed-restore-${stamp}`, "proofs", "0a1b2c3d.jpg"))).toEqual(PROOF);
    expect(existsSync(join(target, `ledger.sqlite.before-restore-${stamp}`))).toBe(false);
  });

  it("the restored balances are verified against the backup's recorded totals; a mismatch, a missing manifest or a different ledger is refused and nothing is moved", async () => {
    const prod = await backedUp();
    const cases: [Parameters<typeof tampered>[1], string][] = [
      [(m) => ({ ...m, totals: { ...m.totals, payable: m.totals["payable"]! + 1 } }), "balances_differ"],
      [() => null, "no_manifest"],
      [(m) => ({ ...m, ledgerSha256: "0".repeat(64) }), "ledger_hash_differs"],
      [(m) => ({ ...m, rowCounts: { ...m.rowCounts, orders: 99 } }), "row_counts_differ"],
    ];
    for (const [edit, refusal] of cases) {
      const target = cleanMachine();
      const result = await restoreLedger(options(await tampered(prod, edit), target));
      expect(result).toMatchObject({ ok: false, refusal });
      expect(existsSync(join(target, "ledger.sqlite"))).toBe(false);
    }
    const money = await restoreLedger(options(await tampered(prod, (m) => ({ ...m, totals: { ...m.totals, payable: 1 } })), cleanMachine()));
    expect(money).toEqual({ ok: false, refusal: "balances_differ", problems: ["balance payable: 115216 restored, 1 at backup"] });
  });

  it("AC3: given the drill, when it is done, then its date, duration and result are recorded (the record file and the runbook log)", () => {
    const dataDir = tempDir("cashback-drill-");
    writeDrillRecord(drillRecordPath(dataDir), { at: "2026-11-05T02:00:00.000Z" as Instant, durationMinutes: 47, result: "pass", archive: "2026-11-04-daily.tar" });
    expect(readDrillRecord(drillRecordPath(dataDir))).toEqual({ at: "2026-11-05T02:00:00.000Z", durationMinutes: 47, result: "pass", archive: "2026-11-04-daily.tar" });
    const runbook = readFileSync(join(REPOSITORY_ROOT, "docs", "operations", "restore-runbook.md"), "utf8");
    expect(runbook).toMatch(/## \d+\. Drill log/);
    expect(runbook).toContain("| Date | Duration | Result | Archive | Machine and notes |");
    expect(runbook).toContain("pnpm --filter @cashback/server restore:drill-record");
  });

  it("AC4: given the quarterly schedule, when a quarter passes without a drill, then the Overview health line shows the drill as due", () => {
    const ledger = freshLedger();
    const dataDir = tempDir("cashback-drill-");
    const at = "2026-11-05T02:00:00.000Z" as Instant;
    const clock = movingClock(at);
    const drill = lastDrillOf(dataDir);
    const line = () => overviewOf(ledger.db, { period: "today" }, clock, { drill }).health.find((h) => h.component === "drill");
    // Never drilled: due.
    expect(line()).toEqual({ component: "drill", state: "due", at: null });
    writeDrillRecord(drillRecordPath(dataDir), { at, durationMinutes: 40, result: "pass", archive: null });
    expect(line()).toEqual({ component: "drill", state: "up", at });
    clock.advance(DRILL_DUE_AFTER_MS);
    expect(line()?.state).toBe("up");
    clock.advance(60_000);
    expect(line()).toEqual({ component: "drill", state: "due", at });
    // The health check raises the warning once, as the same model the Overview shows.
    const sources = healthSourcesFor({ env: "prod", dataDir, telegram: null, backupOffsite: null, assistantToken: null }, assistantHeartbeats(at));
    const check = healthCheck({ model: () => readHealthModel(ledger, clock, sources), alerts: ledgerAlerts(ledger, clock), clock });
    expect(check.run().raised.map((a) => a?.kind)).toEqual(["restore_drill_due"]);
    expect(check.run().raised).toEqual([]);
    expect(alertRows(ledger)).toEqual([{ kind: "restore_drill_due", severity: "warning", suppressed: 0 }]);
  });

  it("a failed last drill is due again at once; an unreadable record counts as no drill", () => {
    const now = "2026-11-05T02:00:00.000Z" as Instant;
    expect(drillHealth({ at: now, durationMinutes: 30, result: "fail", archive: null }, now).state).toBe("due");
    expect(drillHealth({ at: instantFromMs(toMs(now) - DRILL_DUE_AFTER_MS), durationMinutes: 30, result: "pass", archive: null }, now).state).toBe("up");
    const dataDir = tempDir("cashback-drill-");
    mkdirSync(join(dataDir, "backups"), { recursive: true });
    writeFileSync(drillRecordPath(dataDir), "{ not json");
    expect(readDrillRecord(drillRecordPath(dataDir))).toBeNull();
    expect(lastDrillOf(dataDir)(now).state).toBe("due");
  });
});
