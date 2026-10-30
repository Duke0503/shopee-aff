/**
 * `pnpm rehearse:migration <backup-file>`: runs the server's pending migrations against a
 * temporary copy of a production backup before a deploy (AD-2, AD-26). It never opens the
 * live ledger and never changes the backup. It always prints exactly one JSON line: exit 0
 * on success, 1 when the rehearsal fails (the line gives the reason), 2 on a usage error.
 */
import { resolve } from "node:path";
import { systemClock } from "@cashback/core";

import { MIGRATIONS_DIR } from "./platform/db/migrations";
import { rehearseMigrations, type RehearsalResult } from "./platform/db/rehearsal";

function run(args: readonly string[]): { result: RehearsalResult; code: number } {
  const backupFile = args[0];
  if (!backupFile || args.length > 1) {
    return { result: { ok: false, reason: "usage", failedMigration: null, error: "usage: pnpm rehearse:migration <backup-file>" }, code: 2 };
  }
  const result = rehearseMigrations({ backupFile: resolve(backupFile), migrationsDir: MIGRATIONS_DIR, clock: systemClock });
  return { result, code: result.ok ? 0 : 1 };
}

const { result, code } = run(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = code;
