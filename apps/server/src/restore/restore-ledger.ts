/**
 * The restore of a daily archive (AD-26, FR-32, D36, Story 8.6), in the order the restore runbook
 * (docs/operations/restore-runbook.md) gives, with every check it names done by the command:
 *
 * 1. the server must be stopped: the command takes the server lock itself (AD-13), so a running
 *    server refuses the restore and no server can start while it runs;
 * 2. no `-wal`, `-shm` or `-journal` file may sit beside the ledger: newer WAL frames would replay
 *    over the restored file, so the command refuses and the runbook has the owner delete them;
 * 3. an existing ledger is replaced only when asked (`--replace`), and is moved aside, never deleted;
 * 4. the archive (already decrypted with age by the owner) is extracted into a work folder inside
 *    the data folder and must hold its manifest; the ledger's SHA-256, `integrity_check`, the row
 *    counts and the balance totals must all equal what the manifest recorded at backup time;
 * 5. only then the ledger and the proof images are moved into place, and `integrity_check` runs
 *    once more on the file the server will open. If that check (or a move) fails, everything is
 *    swapped back at once: the previous ledger and files return from their `.before-restore-<time>`
 *    names, the restored ones are kept as `.failed-restore-<time>` for inspection, and the result
 *    names both, so the server can be started again on exactly what it had before.
 *
 * The balance totals come from the payouts module (`balanceTotals`), passed in by the command, so
 * the money is checked with the same arithmetic every screen uses. Secrets and the cloudflared
 * credentials are never in an archive; the runbook rebuilds them from the password manager.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { Clock } from "@cashback/core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { extractArchive } from "../platform/backup/backup-archive";
import { figureMismatches, MANIFEST_ENTRY, parseManifest, sha256OfFile, type BackupManifest } from "../platform/backup/backup-manifest";
import { FILES_ENTRY, LEDGER_ENTRY } from "../platform/backup/checked-archive";
import { checkIntegrity, rowCountMismatches, sideFiles, type IntegrityResult } from "../platform/db/backup";
import { LEDGER_FILE, type LedgerDb } from "../platform/db/ledger";
import { acquireServerLock, lockFilePath, type ServerLock } from "../platform/lock/server-lock";

export type RestoreRefusal =
  | "server_running"
  | "side_files_present"
  | "ledger_exists"
  | "archive_unreadable"
  | "no_manifest"
  | "ledger_hash_differs"
  | "integrity_failed"
  | "row_counts_differ"
  | "balances_unreadable"
  | "balances_differ"
  | "place_failed";

export type RestoreResult =
  | {
      readonly ok: true;
      readonly ledger: string;
      readonly files: number;
      readonly totals: Readonly<Record<string, number>>;
      /** The ledger and files folder that were there before, moved aside. */
      readonly movedAside: readonly string[];
      readonly backupCreatedAt: string;
    }
  | { readonly ok: false; readonly refusal: RestoreRefusal; readonly problems: readonly string[]; readonly rolledBack?: RolledBack };

/** What a failed swap put back, and where the restored copies it took out are kept. */
export interface RolledBack {
  /** True when every previous ledger and folder is back under its own name. */
  readonly complete: boolean;
  /** The paths the previous ledger and files are back at. */
  readonly putBack: readonly string[];
  /** The restored ledger and files that failed, kept for inspection. */
  readonly failed: readonly string[];
  /** Moves that could not be undone, `from -> to`, for the owner to do by hand. */
  readonly stuck: readonly string[];
}

export interface RestoreOptions {
  /** The decrypted archive (`<name>.tar`). */
  readonly archive: string;
  readonly dataDir: string;
  readonly clock: Clock;
  /** Replace an existing ledger (moved aside first). */
  readonly replace: boolean;
  /** The balance totals of a ledger, the same function the backup recorded them with. */
  readonly totals: (db: LedgerDb) => Readonly<Record<string, number>>;
  /** Tests replace the server lock. */
  readonly lock?: (path: string) => ServerLock | null;
  /** The check of the ledger once in place; tests replace it to make it fail. */
  readonly checkPlaced?: (path: string) => IntegrityResult;
}

const refuse = (refusal: RestoreRefusal, problems: readonly string[] = []): RestoreResult => ({ ok: false, refusal, problems });

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The balance totals of the database at `path`, opened read-only so no side file appears. */
function totalsOf(path: string, totals: RestoreOptions["totals"]): Readonly<Record<string, number>> {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return totals(drizzle({ client: sqlite }));
  } finally {
    sqlite.close();
  }
}

/** Step 4: what the extracted archive in `work` must prove before anything is moved. */
async function checkExtracted(work: string, options: RestoreOptions): Promise<RestoreResult | BackupManifest> {
  const manifestPath = join(work, MANIFEST_ENTRY);
  if (!existsSync(manifestPath)) return refuse("no_manifest", [`${MANIFEST_ENTRY} is not in the archive`]);
  let manifest: BackupManifest;
  try {
    manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return refuse("no_manifest", [messageOf(error)]);
  }
  const ledger = join(work, LEDGER_ENTRY);
  if (!existsSync(ledger)) return refuse("archive_unreadable", [`${LEDGER_ENTRY} is not in the archive`]);
  if ((await sha256OfFile(ledger)) !== manifest.ledgerSha256) return refuse("ledger_hash_differs", ["the ledger is not the file the manifest describes"]);
  const integrity = checkIntegrity(ledger);
  if (!integrity.ok) return refuse("integrity_failed", integrity.problems.slice(0, 10));
  const rows = rowCountMismatches(ledger, manifest.rowCounts);
  if (rows.length > 0) return refuse("row_counts_differ", rows.slice(0, 10));
  let totals: Readonly<Record<string, number>>;
  try {
    totals = totalsOf(ledger, options.totals);
  } catch (error) {
    return refuse("balances_unreadable", [messageOf(error)]);
  }
  const money = figureMismatches(manifest.totals, totals, "balance");
  if (money.length > 0) return refuse("balances_differ", money);
  return manifest;
}

const countFiles = (dir: string): number => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length : 0);

/** One move of the swap: a previous ledger or folder set aside, or a restored one put in place. */
type Move = { readonly kind: "aside"; readonly path: string; readonly aside: string } | { readonly kind: "placed"; readonly path: string };

/** Steps 3 and 5: the old ledger and files moved aside, the restored ones moved in; each move is recorded as it happens. */
function putInPlace(work: string, options: RestoreOptions, ledgerPath: string, stamp: string, moves: Move[]): void {
  const swap = (restored: string, path: string): void => {
    if (existsSync(path)) {
      const aside = `${path}.before-restore-${stamp}`;
      renameSync(path, aside);
      moves.push({ kind: "aside", path, aside });
    }
    renameSync(restored, path);
    moves.push({ kind: "placed", path });
  };
  swap(join(work, LEDGER_ENTRY), ledgerPath);
  const restoredFiles = join(work, FILES_ENTRY);
  if (existsSync(restoredFiles)) swap(restoredFiles, join(options.dataDir, FILES_ENTRY));
}

/** Undoes the recorded moves, newest first: restored ones out to `.failed-restore-<time>`, previous ones back. */
function rollBack(moves: readonly Move[], stamp: string): RolledBack {
  const putBack: string[] = [];
  const failed: string[] = [];
  const stuck: string[] = [];
  const move = (from: string, to: string, done: string[]): void => {
    try {
      renameSync(from, to);
      done.push(to);
    } catch {
      stuck.push(`${from} -> ${to}`);
    }
  };
  for (const m of [...moves].reverse()) {
    if (m.kind === "placed") move(m.path, `${m.path}.failed-restore-${stamp}`, failed);
    else move(m.aside, m.path, putBack);
  }
  return { complete: stuck.length === 0, putBack, failed, stuck };
}

async function restoreLocked(options: RestoreOptions, ledgerPath: string): Promise<RestoreResult> {
  const present = sideFiles(ledgerPath).filter((file) => existsSync(file));
  if (present.length > 0) return refuse("side_files_present", present.map((file) => basename(file)));
  if (existsSync(ledgerPath) && !options.replace) return refuse("ledger_exists", [basename(ledgerPath)]);
  const backups = join(options.dataDir, "backups");
  mkdirSync(backups, { recursive: true });
  const work = mkdtempSync(join(backups, ".restore-"));
  try {
    try {
      await extractArchive(options.archive, work);
    } catch (error) {
      return refuse("archive_unreadable", [messageOf(error)]);
    }
    const checked = await checkExtracted(work, options);
    if ("ok" in checked) return checked;
    const stamp = options.clock.now().replaceAll(":", "-");
    const moves: Move[] = [];
    try {
      putInPlace(work, options, ledgerPath, stamp, moves);
    } catch (error) {
      return { ok: false, refusal: "place_failed", problems: [messageOf(error)], rolledBack: rollBack(moves, stamp) };
    }
    const placed = (options.checkPlaced ?? checkIntegrity)(ledgerPath);
    if (!placed.ok) return { ok: false, refusal: "integrity_failed", problems: placed.problems.slice(0, 10), rolledBack: rollBack(moves, stamp) };
    const movedAside = moves.flatMap((m) => (m.kind === "aside" ? [basename(m.aside)] : []));
    return { ok: true, ledger: ledgerPath, files: countFiles(join(options.dataDir, FILES_ENTRY)), totals: checked.totals, movedAside, backupCreatedAt: checked.createdAt };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function restoreLedger(options: RestoreOptions): Promise<RestoreResult> {
  const lock = (options.lock ?? acquireServerLock)(lockFilePath(options.dataDir));
  if (lock === null) return refuse("server_running", ["the server lock is held: stop the server first"]);
  try {
    return await restoreLocked(options, join(options.dataDir, LEDGER_FILE));
  } finally {
    lock.release();
  }
}
