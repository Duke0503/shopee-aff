/**
 * The external heartbeat (AD-29, D50, D61, Story 8.4): every 5 minutes the server pings the
 * heartbeat URL from config (a healthchecks.io check or a Cloudflare Worker), but only while its
 * one health model is green. The checker, outside the VPS, alerts the owner on Telegram after 15
 * minutes without a ping, so every silence is caught by the same rule: the VPS or its internet
 * down, a Windows Update reboot, the server stopped, or the server running with a part down.
 *
 * Green means no part is down; a part not known yet or `due` (the quarterly restore drill, a
 * reminder) does not count against it. The URL carries the check's
 * secret id, so it is never logged; a failed ping is logged and retried at the next run. `fetch`
 * is injected so tests use a fake and never reach the network.
 */
import type { Logger } from "../../platform/log/logger";
import type { HealthEntry } from "./health-model.query";

export type PingFetch = (url: string, init: { method: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export type PingOutcome = "sent" | "skipped_red" | "failed";

export interface HeartbeatDeps {
  readonly url: string;
  /** The one health model, read in one snapshot. */
  readonly model: () => readonly HealthEntry[];
  readonly logger: Pick<Logger, "info" | "warn">;
  readonly fetch?: PingFetch;
  readonly timeoutMs?: number;
}

/** True when no part that counts is down. */
export const isGreen = (model: readonly HealthEntry[]): boolean => model.every((entry) => entry.state !== "down");

export function heartbeatPinger(deps: HeartbeatDeps): { run(signal?: AbortSignal): Promise<PingOutcome> } {
  const send: PingFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  return {
    async run(signal) {
      const model = deps.model();
      if (!isGreen(model)) {
        const down = model.filter((e) => e.state === "down").map((e) => e.component);
        deps.logger.warn({ down }, "operations.heartbeat.skipped_red");
        return "skipped_red";
      }
      const timeout = AbortSignal.timeout(deps.timeoutMs ?? 10_000);
      try {
        const answer = await send(deps.url, { method: "GET", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        if (!answer.ok) {
          deps.logger.warn({ status: answer.status }, "operations.heartbeat.failed");
          return "failed";
        }
      } catch {
        // The error of a failed request may carry the URL, and the URL is the check's secret.
        deps.logger.warn({ status: null }, "operations.heartbeat.failed");
        return "failed";
      }
      deps.logger.info({}, "operations.heartbeat.sent");
      return "sent";
    },
  };
}
