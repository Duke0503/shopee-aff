/**
 * Stopping the server. The job scheduler stops first (no new run starts; current runs finish
 * or time out, AD-13) while the listeners still serve the bridge a running job may wait on;
 * then the listeners, then the ledger. Each step runs even when an earlier one fails, and the
 * lock is always released last, so a failed close never leaves a live process holding the
 * data directory or a half-closed ledger behind a running listener.
 */
import { JOB_STOP_TIMEOUT_MS } from "../jobs/job-schedules";
import type { StopResult } from "../jobs/scheduler";
import type { Logger } from "../log/logger";

export interface RunningParts {
  jobs?: { stop(timeoutMs: number): Promise<StopResult> } | null;
  closeServers: () => Promise<void>;
  ledger: { close(): void } | null;
  lock: { release(): void };
  logger: Logger;
}

/** Closes everything that was started and returns the exit code. */
export async function stopServer(parts: RunningParts, reason: string): Promise<number> {
  let failed = false;
  try {
    const jobs = await parts.jobs?.stop(JOB_STOP_TIMEOUT_MS);
    if (jobs && !jobs.finished) {
      failed = true;
      parts.logger.error({ step: "jobs", stillRunning: jobs.stillRunning }, "platform.server.stop_failed");
    }
  } catch (error) {
    failed = true;
    parts.logger.error({ err: error, step: "jobs" }, "platform.server.stop_failed");
  }
  try {
    await parts.closeServers();
  } catch (error) {
    failed = true;
    parts.logger.error({ err: error, step: "servers" }, "platform.server.stop_failed");
  }
  try {
    parts.ledger?.close();
  } catch (error) {
    failed = true;
    parts.logger.error({ err: error, step: "ledger" }, "platform.server.stop_failed");
  }
  parts.lock.release();
  parts.logger.info({ reason }, "platform.server.stopped");
  return failed ? 1 : 0;
}
