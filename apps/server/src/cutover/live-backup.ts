/**
 * The final backup of the live ledger at cutover (AD-24, AD-26; Story 8.8), taken after the live
 * server stopped. The live file and its `-wal` and `-shm` are first copied as they are into
 * `raw/` (the live folder is never opened by SQLite, so nothing there changes, not even a
 * checkpoint); the staged copy is then opened and written to one self-contained file with the
 * SQLite backup API, which carries every committed page of the WAL. The result is checked with
 * `PRAGMA integrity_check` and hashed with SHA-256. A second run with the same output folder finds
 * the finished backup and returns it (idempotent). Paths and hashes only, never row content.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";

export const FINAL_FILE = "live-final.db";
export const MANIFEST_FILE = "live-final.json";

export interface LiveBackup {
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly integrity: "ok";
  /** Which of `-wal` and `-shm` existed beside the live file and were staged. */
  readonly staged: readonly string[];
  readonly reused: boolean;
}

export class LiveBackupError extends Error {
  constructor(
    readonly code: "live_missing" | "integrity_failed",
    message: string,
  ) {
    super(message);
    this.name = "LiveBackupError";
  }
}

export const sha256Of = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

function reusable(outDir: string): LiveBackup | null {
  const manifest = join(outDir, MANIFEST_FILE);
  const file = join(outDir, FINAL_FILE);
  if (!existsSync(manifest) || !existsSync(file)) return null;
  const saved = JSON.parse(readFileSync(manifest, "utf8")) as Omit<LiveBackup, "reused">;
  return saved.sha256 === sha256Of(file) ? { ...saved, file, reused: true } : null;
}

/** Copies the live ledger into `outDir` and returns the checked, hashed backup. */
export async function backupLiveLedger(livePath: string, outDir: string): Promise<LiveBackup> {
  const done = reusable(outDir);
  if (done !== null) return done;
  if (!existsSync(livePath)) throw new LiveBackupError("live_missing", `the live ledger does not exist: ${livePath}`);
  const raw = join(outDir, "raw");
  mkdirSync(raw, { recursive: true });
  const stagedDb = join(raw, basename(livePath));
  copyFileSync(livePath, stagedDb);
  const staged: string[] = [];
  for (const suffix of ["-wal", "-shm"]) {
    const side = `${livePath}${suffix}`;
    rmSync(`${stagedDb}${suffix}`, { force: true });
    if (existsSync(side)) {
      copyFileSync(side, `${stagedDb}${suffix}`);
      staged.push(suffix);
    }
  }
  // Opened from a copy of the copy, so `raw/` keeps the files exactly as they were in the live folder.
  const work = join(outDir, "work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const workDb = join(work, basename(livePath));
  copyFileSync(stagedDb, workDb);
  for (const suffix of staged) copyFileSync(`${stagedDb}${suffix}`, `${workDb}${suffix}`);
  const partial = join(outDir, `${FINAL_FILE}.partial`);
  rmSync(partial, { force: true });
  const db = new Database(workDb);
  try {
    await db.backup(partial);
  } finally {
    db.close();
  }
  const check = new Database(partial, { readonly: true });
  const integrity = (check.pragma("integrity_check", { simple: true }) as string) === "ok";
  check.close();
  if (!integrity) throw new LiveBackupError("integrity_failed", "the backup failed PRAGMA integrity_check");
  const file = join(outDir, FINAL_FILE);
  renameSync(partial, file);
  rmSync(work, { recursive: true, force: true });
  const backup = { file, sha256: sha256Of(file), bytes: statSync(file).size, integrity: "ok" as const, staged };
  writeFileSync(join(outDir, MANIFEST_FILE), `${JSON.stringify(backup, null, 2)}\n`);
  return { ...backup, reused: false };
}
