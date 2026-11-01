/**
 * Composition root: config, logger, the single-instance lock, the ledger (migrated behind a
 * checked local backup, AD-26), then the two listeners (the public one with the receipt page, the share page (Story 5.8) and
 * the customer's proof image, Story 4.9) (the internal one with the admin commands
 * of the internal CLI, Story 4.20; the public one with the admin desk's staff routes when
 * the config names the admin host and its Cloudflare Access settings), then the job scheduler (AD-13; each
 * module adds its job with its story, timed by platform/jobs/job-schedules.ts). A config error names the keys and exits before anything else runs; a held
 * lock exits before the ledger is opened, so a second instance never touches the data.
 * Any failure after the lock is taken is logged, and whatever was started is closed and
 * the lock released before the process exits.
 */
import { join } from "node:path";
import { systemClock } from "@cashback/core";

import { adminCommandRoutes } from "./admin/admin-command.routes";
import { linkQueueRoutes } from "./admin/link-queue.routes";
import { adminDesk } from "./admin/admin-desk";
import { environmentModes, linkBridge, linkJobs, linkRoutes, type LinkBridge } from "./links/link-jobs";
import { assistantHeartbeatRoutes, assistantHeartbeats, commandAudit } from "./modules/operations/index";
import { customerProofRoutes, fileProofStore, networkPayoutInternalRoutes, proofFilesDir, runClaimExpiry } from "./modules/payouts/index";
import { receiptPageRoutes } from "./pages/receipt.page";
import { sharePageRoutes } from "./pages/share.page";
import { ConfigError, loadConfig, type ServerConfig } from "./platform/config/env.config";
import { LEDGER_FILE, type Ledger } from "./platform/db/ledger";
import { openMigratedLedger } from "./platform/db/migration-gate";
import { MIGRATIONS_DIR } from "./platform/db/migrations";
import { buildServers, close, listen, type Servers } from "./platform/http/servers";
import { JOB_SCHEDULES } from "./platform/jobs/job-schedules";
import { createScheduler, systemTimer, type Job, type Scheduler } from "./platform/jobs/scheduler";
import { stopServer, type RunningParts } from "./platform/lifecycle/shutdown";
import { shutdownRoutes } from "./platform/lifecycle/shutdown.routes";
import { acquireServerLock, lockFilePath, type ServerLock } from "./platform/lock/server-lock";
import { createLogger, type Logger } from "./platform/log/logger";
import { reconcileJobs } from "./reconcile/reconcile-jobs";

function readConfig(): ServerConfig | null {
  try {
    return loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return null;
  }
}

/** The module jobs; Stories 8.2 and 8.3 add theirs here. */
function jobsFor(config: ServerConfig, ledger: Ledger, logger: Logger, bridge: LinkBridge): Job[] {
  const claimExpiry: Job = { name: "claimExpiry", ...JOB_SCHEDULES.claimExpiry, run: () => void runClaimExpiry({ ledger, clock: systemClock, audit: (db, actor) => commandAudit(db, systemClock, actor) }) };
  return [...reconcileJobs({ config, ledger, clock: systemClock, timer: systemTimer, logger, bridge: bridge.port }), claimExpiry, ...linkJobs({ config, ledger, clock: systemClock, logger }, bridge)];
}

/** The one stop of this process, whichever asks first: a signal, or the dev shutdown route. */
interface Stopper {
  stop(reason: string): void;
}

async function start(config: ServerConfig, logger: Logger, lock: ServerLock, stopper: Stopper): Promise<RunningParts | null> {
  let ledger: Ledger | null = null;
  let servers: Servers | null = null;
  let jobs: Scheduler | null = null;
  const parts = (): RunningParts => ({ jobs, closeServers: async () => (servers ? close(servers) : undefined), ledger, lock, logger });
  try {
    ledger = await openMigratedLedger({
      ledgerPath: join(config.dataDir, LEDGER_FILE),
      migrationsDir: MIGRATIONS_DIR,
      backupsDir: join(config.dataDir, "backups"),
      clock: systemClock,
      logger,
    });
    const proofs = fileProofStore(proofFilesDir(config.dataDir));
    // One bridge for the link job and, for the real one, its long-poll routes (Story 5.3).
    const bridge = linkBridge(config);
    // One heartbeat store: the assistant's route writes it, the Overview's health reads it (Story 6.1).
    const heartbeats = assistantHeartbeats();
    const staff = config.staffAccess ? adminDesk({ access: config.staffAccess, ledger, clock: systemClock, production: config.env === "prod", logger, proofs, heartbeats }) : undefined;
    if (!staff) logger.warn({ env: config.env }, "platform.staff.routes_absent");
    const internal = [adminCommandRoutes({ ledger, clock: systemClock }), linkQueueRoutes({ ledger, clock: systemClock }), networkPayoutInternalRoutes({ ledger, clock: systemClock, audit: (db, actor) => commandAudit(db, systemClock, actor) }), ...linkRoutes({ config, ledger, clock: systemClock, logger }, bridge)];
    // dev:stop asks for an ordered stop here; production stops by its service manager (Story 8.1).
    if (config.env === "dev") internal.push(shutdownRoutes(() => stopper.stop("shutdown_route")));
    if (config.assistantToken !== null) internal.push(assistantHeartbeatRoutes({ clock: systemClock, heartbeats }));
    const share = sharePageRoutes({ ledger, clock: systemClock, baseUrl: config.publicBaseUrl, acceptFakeHost: bridge.port.mode === "fake" });
    const pages = [receiptPageRoutes({ ledger, clock: systemClock }), share, customerProofRoutes({ ledger, clock: systemClock, proofs })];
    servers = buildServers({ clock: systemClock, internalToken: config.internalToken, assistantToken: config.assistantToken, bridgeToken: config.bridgeToken, logger, internal, public: pages, ...(staff ? { staff } : {}) });
    await listen(servers, { public: config.publicPort, internal: config.internalPort });
    jobs = createScheduler(jobsFor(config, ledger, logger, bridge), { clock: systemClock, timer: systemTimer, logger });
    jobs.start();
    logger.info({ env: config.env, publicPort: config.publicPort, internalPort: config.internalPort, bridge: config.bridgeMode, zalo: config.zaloMode }, "platform.server.started");
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
  // Names the bridge and Zalo mode before anything starts, so a dev start shows it runs the fakes (Story 8.1).
  logger.info(environmentModes(config), "platform.environment.mode");
  for (const warning of config.isolationWarnings) logger.warn({ warning }, "platform.config.isolation_warning");

  const lockFile = lockFilePath(config.dataDir);
  const lock = acquireServerLock(lockFile);
  if (!lock) {
    logger.error({ lockFile }, "platform.server.lock_held");
    return 1;
  }

  let stopping = false;
  let parts: RunningParts | null = null;
  const stopper: Stopper = {
    stop(reason) {
      if (stopping || parts === null) return;
      stopping = true;
      void stopServer(parts, reason)
        .catch(() => 1)
        .then((code) => process.exit(code));
    },
  };
  parts = await start(config, logger, lock, stopper);
  if (!parts) return 1;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stopper.stop(signal));
  return 0;
}

process.exitCode = await main();
