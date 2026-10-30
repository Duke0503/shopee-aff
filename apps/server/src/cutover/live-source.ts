/**
 * Opening the live copy (AD-2, AD-24): the import reads only a copy of the live SQLite, opened
 * read-only, and never the production file itself. Both refusals happen before any row is
 * read. better-sqlite3 has no `file:` URI support, so the copy is opened with
 * SQLITE_OPEN_READONLY (`readonly: true`, the same as `?mode=ro`) and `query_only` on top.
 */
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

import { CutoverRefusedError } from "./live-time";

export type SourceOpener = (path: string) => Database.Database;

export const openReadOnly: SourceOpener = (path) => new Database(path, { readonly: true, fileMustExist: true });

/** One path form for comparison: resolved, symlinks followed, case folded on Windows. */
function canonical(path: string): string {
  const full = existsSync(path) ? realpathSync.native(path) : resolve(path);
  return process.platform === "win32" ? full.toLowerCase() : full;
}

export function samePath(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

export interface LiveCopyOptions {
  /** The configured live production ledger; the copy must not be it. */
  liveLedgerPath: string | null;
  open?: SourceOpener;
}

export function openLiveCopy(path: string, options: LiveCopyOptions): Database.Database {
  if (!existsSync(path)) throw new CutoverRefusedError("source_missing", `live copy not found: ${path}`);
  if (options.liveLedgerPath !== null && samePath(path, options.liveLedgerPath)) {
    throw new CutoverRefusedError("live_production_file", `refusing the live production ledger itself; import a copy: ${path}`);
  }
  const source = (options.open ?? openReadOnly)(path);
  if (!source.readonly) {
    source.close();
    throw new CutoverRefusedError("source_writable", `the live copy must be opened read-only: ${path}`);
  }
  source.pragma("query_only = ON");
  return source;
}
