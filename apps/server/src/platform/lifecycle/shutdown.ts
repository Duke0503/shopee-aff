/**
 * Stopping the server. Each step runs even when an earlier one fails, and the lock is
 * always released last, so a failed close never leaves a live process holding the data
 * directory or a half-closed ledger behind a running listener.
 */
import type { Logger } from "../log/logger";

export interface RunningParts {
  closeServers: () => Promise<void>;
  ledger: { close(): void } | null;
  lock: { release(): void };
  logger: Logger;
}

/** Closes everything that was started and returns the exit code. */
export async function stopServer(parts: RunningParts, reason: string): Promise<number> {
  let failed = false;
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
