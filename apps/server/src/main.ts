/**
 * Composition root: config, logger, the single-instance lock, the ledger (migrated behind a
 * checked local backup, AD-26), then the two listeners. A config error names the keys and exits before anything else runs; a held
 * lock exits before the ledger is opened, so a second instance never touches the data.
 * Any failure after the lock is taken is logged, and whatever was started is closed and
 * the lock released before the process exits.
 */
import { join } from "node:path";
import { systemClock } from "@cashback/core";

import { ConfigError, loadConfig, type ServerConfig } from "./platform/config/env.config";
import { LEDGER_FILE, type Ledger } from "./platform/db/ledger";
import { openMigratedLedger } from "./platform/db/migration-gate";
import { MIGRATIONS_DIR } from "./platform/db/migrations";
import { buildServers, close, listen, type Servers } from "./platform/http/servers";
import { stopServer, type RunningParts } from "./platform/lifecycle/shutdown";
import { acquireServerLock, lockFilePath, type ServerLock } from "./platform/lock/server-lock";
import { createLogger, type Logger } from "./platform/log/logger";

function readConfig(): ServerConfig | null {
  try {
    return loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return null;
  }
}

async function start(config: ServerConfig, logger: Logger, lock: ServerLock): Promise<RunningParts | null> {
  let ledger: Ledger | null = null;
  let servers: Servers | null = null;
  const parts = (): RunningParts => ({ closeServers: async () => (servers ? close(servers) : undefined), ledger, lock, logger });
  try {
    ledger = await openMigratedLedger({
      ledgerPath: join(config.dataDir, LEDGER_FILE),
      migrationsDir: MIGRATIONS_DIR,
      backupsDir: join(config.dataDir, "backups"),
      clock: systemClock,
      logger,
    });
    servers = buildServers({ clock: systemClock, internalToken: config.internalToken, logger });
    await listen(servers, { public: config.publicPort, internal: config.internalPort });
    logger.info({ env: config.env, publicPort: config.publicPort, internalPort: config.internalPort }, "platform.server.started");
    return parts();
  } catch (error) {
    logger.error({ err: error }, "platform.server.start_failed");
    await stopServer(parts(), "start_failed");
    return null;
  }
}

async function main(): Promise<number> {
  const config = readConfig();
  if (!config) return 1;
  const logger = createLogger({ level: config.logLevel });

  const lockFile = lockFilePath(config.dataDir);
  const lock = acquireServerLock(lockFile);
  if (!lock) {
    logger.error({ lockFile }, "platform.server.lock_held");
    return 1;
  }

  const running = await start(config, logger, lock);
  if (!running) return 1;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stopServer(running, signal)
        .catch(() => 1)
        .then((code) => process.exit(code));
    });
  }
  return 0;
}

process.exitCode = await main();
