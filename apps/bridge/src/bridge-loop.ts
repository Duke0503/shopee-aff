/**
 * The bridge's one loop (AD-14; Story 5.3): poll, work the one job, answer, poll again. There is
 * never a second job in hand, so the server's order of service holds. After an empty poll the next
 * poll starts at once: the server holds each poll, so every wait for work is the server's. A
 * server that is down or restarting is retried with a growing pause, and an answer that cannot be
 * posted is retried a few times and then dropped (the server gives the job out again after its own
 * timeout). The loop ends when the settings are missing or the token is refused; the keep-alive
 * alarm starts it again, so a fixed token or a restarted browser needs nothing else.
 *
 * A job that meets a captcha or a frozen page gets a second look in a fresh tab before it is reported
 * (D68): at most one, and only while half of the job's time is left, so the answer still reaches the
 * server in time. A hold still follows a second captcha answer, so a real captcha is retried at most
 * once per hold. A second run that fails for a page reason does not hide the captcha the first met:
 * the captcha is answered, so the hold and alert follow and the customer is not counted against.
 */
import type { BridgeJob, BridgeResult } from "@cashback/contracts";
import { systemClock, toMs, type Clock } from "@cashback/core";

import type { ConnectedSettings } from "./bridge-settings";
import type { PageDriver, Wait } from "./bridge-tab";
import { runLinkJob } from "./link-job";
import { runLookupJob } from "./lookup-job";
import { runPayoutRecordJob } from "./payout-record-job";
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

const HIDES_A_CAPTCHA: ReadonlySet<string> = new Set(["no_link", "page_not_ready", "form_missing", "script_error"]);

/** The work for one job: a link on the custom link page, a product lookup (Story 5.6), a report page (Story 5.9), the payout record page (Story 4.22). */
export function jobWorker(page: PageDriver, wait: Wait, resolve: ResolveLink = NO_RESOLUTION, resolveSource: ResolveLink = NO_RESOLUTION, clock: Clock = systemClock): (job: BridgeJob) => Promise<Answer> {
  const work = async (job: BridgeJob): Promise<Answer> => {
    if (job.kind === "link") return runLinkJob(job, page, wait, resolve, resolveSource);
    if (job.kind === "lookup") return runLookupJob(job, page, wait, resolve);
    if (job.kind === "payout_record") return runPayoutRecordJob(job, page, wait);
    return runReportJob(job, page, wait);
  };
  return async (job) => {
    const startedMs = toMs(clock.now());
    const before = page.replacements();
    const first = await work(job);
    if (first.outcome !== "failed" || (first.reason !== "captcha" && first.reason !== "page_not_ready")) return first;
    const replaced = page.replacements() > before;
    // A captcha read from a fresh tab has had its second look; `page_not_ready` with no replacement is a form that never came, or the cooldown.
    if (replaced === (first.reason === "captcha")) return first;
    const used = (): number => toMs(clock.now()) - startedMs;
    if (used() > job.timeoutMs / 2) return first;
    if (!replaced) {
      const fresh = await page.replaceTab();
      if (fresh === null) return first;
      if (fresh.shows !== null) return { outcome: "failed", reason: fresh.shows };
      // Opening the fresh tab takes time of its own.
      if (used() > job.timeoutMs / 2) return first;
    }
    const second = await work({ ...job, timeoutMs: job.timeoutMs - used() });
    return first.reason === "captcha" && second.outcome === "failed" && HIDES_A_CAPTCHA.has(second.reason) ? first : second;
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
