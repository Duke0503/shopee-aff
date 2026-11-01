/**
 * The bridge's one loop (AD-14; Story 5.3): poll, work the one job, answer, poll again. There is
 * never a second job in hand, so the server's order of service holds. After an empty poll the next
 * poll starts at once: the server holds each poll, so every wait for work is the server's. A
 * server that is down or restarting is retried with a growing pause, and an answer that cannot be
 * posted is retried a few times and then dropped (the server gives the job out again after its own
 * timeout). The loop ends when the settings are missing or the token is refused; the keep-alive
 * alarm starts it again, so a fixed token or a restarted browser needs nothing else.
 */
import type { BridgeJob, BridgeResult } from "@cashback/contracts";

import type { ConnectedSettings } from "./bridge-settings";
import type { PageDriver, Wait } from "./bridge-tab";
import { runLinkJob } from "./link-job";
import { runLookupJob } from "./lookup-job";
import { runReportJob } from "./report-job";
import type { ServerClient } from "./server-client";
import { NO_RESOLUTION, type ResolveLink } from "./short-link";

type WithoutTicket<T> = T extends unknown ? Omit<T, "ticket"> : never;
/** An answer before the loop puts the job's ticket on it. */
export type Answer = WithoutTicket<BridgeResult>;

export interface LoopDeps {
  loadSettings(): Promise<ConnectedSettings | null>;
  client(settings: ConnectedSettings): ServerClient;
  work(job: BridgeJob): Promise<Answer>;
  readonly wait: Wait;
  log(event: string, detail?: Record<string, unknown>): void;
}

export type LoopEnd = "no_settings" | "unauthorized" | "stopped";

export const RETRY_FIRST_MS = 1_000;
export const RETRY_MAX_MS = 30_000;
export const POST_TRIES = 3;

/** The work for one job: a link on the custom link page, a product lookup (Story 5.6), a report page (Story 5.9). */
export function jobWorker(page: PageDriver, wait: Wait, resolve: ResolveLink = NO_RESOLUTION, resolveSource: ResolveLink = NO_RESOLUTION): (job: BridgeJob) => Promise<Answer> {
  return async (job) => {
    if (job.kind === "link") return runLinkJob(job, page, wait, resolve, resolveSource);
    if (job.kind === "lookup") return runLookupJob(job, page, wait, resolve);
    return runReportJob(job, page, wait);
  };
}

async function postAnswer(deps: LoopDeps, client: ServerClient, result: BridgeResult): Promise<void> {
  for (let tries = 1; ; tries++) {
    try {
      const accepted = await client.post(result);
      deps.log("bridge.result.posted", { ticket: result.ticket, outcome: result.outcome, accepted });
      return;
    } catch {
      if (tries >= POST_TRIES) return deps.log("bridge.result.dropped", { ticket: result.ticket });
      await deps.wait(RETRY_FIRST_MS * tries);
    }
  }
}

async function workOne(deps: LoopDeps, client: ServerClient, job: BridgeJob): Promise<void> {
  let answer: Answer;
  try {
    answer = await deps.work(job);
  } catch {
    answer = { outcome: "failed", reason: "script_error" };
  }
  await postAnswer(deps, client, { ...answer, ticket: job.ticket } as BridgeResult);
}

export async function runBridgeLoop(deps: LoopDeps, stop: { readonly stopped: boolean }): Promise<LoopEnd> {
  let pause = RETRY_FIRST_MS;
  while (!stop.stopped) {
    const settings = await deps.loadSettings();
    if (settings === null) return "no_settings";
    const client = deps.client(settings);
    let poll;
    try {
      poll = await client.next();
    } catch {
      deps.log("bridge.server.unreachable", { retryInMs: pause });
      await deps.wait(pause);
      pause = Math.min(RETRY_MAX_MS, pause * 2);
      continue;
    }
    pause = RETRY_FIRST_MS;
    if (poll.kind === "unauthorized") {
      deps.log("bridge.token.refused");
      return "unauthorized";
    }
    if (poll.kind === "job") await workOne(deps, client, poll.job);
  }
  return "stopped";
}
