/**
 * The single-instance lock (AD-13, AD-25, D52, INV-12). At startup the server takes an
 * exclusive OS lock on `data/<env>/server.lock` and refuses to start if it is held.
 * The lock is SQLite's own file lock (fcntl on macOS, LockFileEx on Windows) held by a
 * connection in exclusive locking mode, so the OS drops it when the process dies: a lock
 * file left behind by a crash never blocks a restart, and no PID is ever trusted.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

import { isBusy } from "../db/transaction";

export const LOCK_FILE = "server.lock";

export interface ServerLock {
  readonly path: string;
  release(): void;
}

export function lockFilePath(dataDir: string): string {
  return join(dataDir, LOCK_FILE);
}

/** Takes the lock, or returns null when another process holds it. */
export function acquireServerLock(path: string): ServerLock | null {
  mkdirSync(dirname(path), { recursive: true });
  const holder = new Database(path, { timeout: 0 });
  try {
    holder.pragma("locking_mode = EXCLUSIVE");
    holder.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    holder.close();
    if (isBusy(error)) return null;
    throw error;
  }
  return {
    path,
    release: () => {
      if (holder.open) holder.close();
    },
  };
}
