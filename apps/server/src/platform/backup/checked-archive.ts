/**
 * One checked local backup archive (AD-26, Story 8.2): the ledger copied with the online backup
 * API, its `integrity_check`, then a tar of that copy and `data/<env>/files/` (the proof images),
 * then the restore check: the archive is extracted into a temporary folder beside it, every entry
 * must come back with the same size and SHA-256, the restored ledger must pass `integrity_check`,
 * and its row counts must equal the live ledger's when the copy was taken.
 *
 * The secrets file and the cloudflared credentials are never in the archive: only the ledger and
 * the files folder go in, and inside that folder any env file, certificate or credentials file is
 * left out. A file whose name the archive cannot hold safely (the server names every proof image
 * `<32 hex>.jpg|png`, so only a file put there by hand) is skipped and counted, never a reason to
 * fail the backup.
 *
 * The archive is written and checked inside a work folder and renamed to its final name only after
 * the restore check passed, so a run killed half way never leaves a truncated archive under an
 * archive's name. Work folders stay inside the backups folder, never in the system temp folder.
 * An archive that fails its check is kept aside as `.corrupt`, so the folder only holds good
 * archives under the plain name.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { toMs, type Clock, type Instant } from "@cashback/core";

import { checkIntegrity, rowCountMismatches, snapshotLedger } from "../db/backup";
import type { Ledger } from "../db/ledger";
import { extractArchive, isSafeEntryName, writeArchive, type ArchiveEntry, type ArchiveSource } from "./backup-archive";
import { archiveName } from "./backup-retention";

export const LEDGER_ENTRY = "ledger.sqlite";
export const FILES_ENTRY = "files";
/** The archive's name inside the work folder until the restore check passed. */
const ARCHIVE_IN_WORK = "archive.tar.partial";
/** Work folders are `<dir>/.work-XXXXXX`; the daily job removes old ones a stopped run left. */
export const WORK_PREFIX = ".work-";

/** A file name that is a secret, never backed up: env files, certificates, tunnel credentials. */
const SECRET_FILE = /(^\.env($|\.)|\.env$|\.pem$|\.key$|credential|cloudflared|^cert\.)/i;

export const isSecretFile = (relativePath: string): boolean => relativePath.split(/[\\/]/).some((part) => SECRET_FILE.test(part));

export interface FileSources {
  readonly sources: readonly ArchiveSource[];
  /** Files left out because the archive cannot hold their name safely. */
  readonly skipped: number;
}

/** Every regular file under `filesDir` as an archive source, secrets left out, unsafe names skipped, in name order. */
export function fileSources(filesDir: string): FileSources {
  if (!existsSync(filesDir)) return { sources: [], skipped: 0 };
  const sources: ArchiveSource[] = [];
  let skipped = 0;
  for (const entry of readdirSync(filesDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const rel = relative(filesDir, path);
    if (isSecretFile(rel)) continue;
    const name = `${FILES_ENTRY}/${rel.split(sep).join("/")}`;
    if (isSafeEntryName(name)) sources.push({ name, path });
    else skipped++;
  }
  return { sources: sources.sort((a, b) => (a.name < b.name ? -1 : 1)), skipped };
}

export type ArchiveStep = "snapshot" | "integrity" | "archive" | "restore_check";

export type CheckedArchive =
  | { readonly ok: true; readonly archive: string; readonly at: Instant; readonly entries: readonly ArchiveEntry[]; readonly skippedFiles: number }
  | { readonly ok: false; readonly step: ArchiveStep; readonly problems: readonly string[] };

export interface CheckedArchiveOptions {
  readonly ledger: Ledger;
  readonly filesDir: string;
  /** Where the archives live (`data/<env>/backups/daily`). */
  readonly dir: string;
  readonly clock: Clock;
  /** Writes the ledger copy; tests replace it to produce a copy whose restore check fails. */
  readonly writeCopy?: (ledger: Ledger, target: string) => Promise<void>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What the restore of `archive` into `work` gives back, compared with what was written. */
async function restoreProblems(archive: string, work: string, written: readonly ArchiveEntry[], counts: Readonly<Record<string, number>>): Promise<string[]> {
  const into = join(work, "restore");
  mkdirSync(into);
  const restored = await extractArchive(archive, into);
  const key = (e: ArchiveEntry) => `${e.name} ${e.size} ${e.sha256}`;
  const back = new Set(restored.map(key));
  const problems = written.filter((e) => !back.has(key(e))).map((e) => `${e.name}: not restored intact`);
  if (restored.length !== written.length) problems.push(`${restored.length} entries restored, ${written.length} written`);
  if (problems.length > 0) return problems;
  const ledger = join(into, LEDGER_ENTRY);
  const integrity = checkIntegrity(ledger);
  if (!integrity.ok) return integrity.problems.slice(0, 10);
  return rowCountMismatches(ledger, counts);
}

async function build(options: CheckedArchiveOptions, work: string, target: string): Promise<CheckedArchive> {
  const building = join(work, ARCHIVE_IN_WORK);
  const at = options.clock.now();
  const copy = join(work, LEDGER_ENTRY);
  let counts: Readonly<Record<string, number>>;
  try {
    counts = await snapshotLedger(options.ledger, copy, options.writeCopy);
  } catch (error) {
    return { ok: false, step: "snapshot", problems: [messageOf(error)] };
  }
  const integrity = checkIntegrity(copy);
  if (!integrity.ok) return { ok: false, step: "integrity", problems: integrity.problems.slice(0, 10) };
  let entries: ArchiveEntry[];
  const files = fileSources(options.filesDir);
  try {
    entries = await writeArchive(building, [{ name: LEDGER_ENTRY, path: copy }, ...files.sources], Math.floor(toMs(at) / 1000));
  } catch (error) {
    return { ok: false, step: "archive", problems: [messageOf(error)] };
  }
  let problems: string[];
  try {
    problems = await restoreProblems(building, work, entries, counts);
  } catch (error) {
    problems = [messageOf(error)];
  }
  if (problems.length > 0) {
    renameSync(building, `${target}.corrupt`);
    return { ok: false, step: "restore_check", problems: problems.slice(0, 10) };
  }
  // Only a checked archive ever carries an archive's name.
  renameSync(building, target);
  return { ok: true, archive: target, at, entries, skippedFiles: files.skipped };
}

/** Best effort: a file Windows still holds stays behind, and the next run uses a new folder. */
function removeWorkFolder(work: string): void {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // Left for the owner to delete; it holds only a copy of what the backups folder holds anyway.
  }
}

export async function writeCheckedArchive(options: CheckedArchiveOptions): Promise<CheckedArchive> {
  mkdirSync(options.dir, { recursive: true });
  const target = join(options.dir, archiveName(options.clock.now()));
  if (existsSync(target)) return { ok: false, step: "archive", problems: [`archive exists already: ${target}`] };
  const work = mkdtempSync(join(options.dir, WORK_PREFIX));
  try {
    return await build(options, work, target);
  } finally {
    removeWorkFolder(work);
  }
}
