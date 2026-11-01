/**
 * The real browser bridge behind the bridge port (AD-14, AD-25, D8, D47, INV-10; Story 5.3). The
 * affiliate Chrome's extension long-polls the internal listener; this adapter is the meeting point.
 * Work waits in memory in the order of service (link, product lookup, report page, then oldest
 * first), and exactly one job is out at a time: the next job is handed out only after the one out
 * is answered or given up, so a Zalo link waits for at most one report page.
 *
 * Every wait is here, on the server: the poll is held until work arrives or `pollMs` ends. The job
 * at the front of the line, once it could be handed out, waits at most `pickupMs` for a bridge to
 * take it (`no_bridge`); a job taken but not answered within its timeout and a grace is given up
 * as `no_answer`. Neither is decided here to be the request's failure; the link job decides.
 *
 * The job out belongs to the instance that took it (the extension's id, `X-Bridge-Instance`). That
 * instance polling again means it lost the job to a restart, so it gets the same job back with a
 * fresh answer deadline; any other instance waits as if there were no work, so one link is never
 * submitted twice. An answer counts only from that instance and for that job's ticket, so an answer
 * from before a server restart, or for a job given up, is dropped.
 *
 * A job is checked against the bridge contract when it is queued; one that could not be a valid job
 * is answered `bad_job` at once and never joins the line, so it can never block a poll.
 *
 * The queue lives in memory on purpose: the durable record of a link submission is its PENDING
 * `bridge_jobs` row, which the link job hands out again after a server restart.
 */
import { randomBytes } from "node:crypto";
import { bridgeJobSchema, type BridgeFailure, type BridgeJob, type BridgeJobKind, type BridgeResult } from "@cashback/contracts";

import type { BridgeLinkResult, BridgePort, BridgeUnavailable, BridgeWorkQueue, LinkBridgeJob } from "../../platform/ports/bridge.port";

/** Seconds-scale timers, injected so tests run without waiting. */
export interface BridgeTimer {
  schedule(fn: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface BrowserBridgeOptions {
  readonly timer: BridgeTimer;
  /** How long one long poll is held with no work (the extension polls again at once). */
  readonly pollMs?: number;
  /** How long the front job waits for a bridge to take it before it is given up as `no_bridge`. */
  readonly pickupMs?: number;
  /** How long the bridge may work on one job (sent with the job). */
  readonly jobTimeoutMs?: number;
  /** Added to the job timeout before the server stops waiting (`no_answer`). */
  readonly answerGraceMs?: number;
  readonly makeTicket?: () => string;
}

export const BRIDGE_POLL_MS = 25_000;
export const BRIDGE_PICKUP_MS = 60_000;
export const BRIDGE_JOB_TIMEOUT_MS = 90_000;
export const BRIDGE_ANSWER_GRACE_MS = 15_000;

const SERVICE_ORDER: Record<BridgeJobKind, number> = { link: 0, lookup: 1, report: 2 };

/** What is asked of the browser, before the queue gives it a ticket and a timeout. */
export type BridgeWork = { kind: "link"; sourceUrl: string; subId1: string; subId2: string } | { kind: "lookup"; url: string } | { kind: "report"; page: number };

export type BridgeAnswer = { outcome: "link"; url: string } | { outcome: "failed"; reason: BridgeFailure } | { outcome: "value"; value: unknown } | { outcome: "unavailable"; reason: BridgeUnavailable };

export interface BrowserBridge extends BridgePort {
  readonly mode: "browser";
  /** The extension's side, for the bridge routes. */
  readonly work: BridgeWorkQueue;
  /** Queues one job and waits for its answer; `signal` aborts at shutdown. */
  submit(work: BridgeWork, signal: AbortSignal): Promise<BridgeAnswer>;
}

interface Entry {
  readonly job: BridgeJob;
  readonly seq: number;
  /** The pickup timer while it waits at the front, the answer timer once it is out. */
  timer: unknown;
  pickupArmed: boolean;
  settled: boolean;
  settle(answer: BridgeAnswer): void;
}

interface Waiter {
  readonly instance: string;
  give(job: BridgeJob): void;
}

interface Limits {
  readonly pollMs: number;
  readonly pickupMs: number;
  readonly jobTimeoutMs: number;
  readonly answerMs: number;
  readonly makeTicket: () => string;
}

const newTicket = (): string => randomBytes(16).toString("hex");

/** The answer to a link job in the port's terms; a lookup or report answer to a link job is a failure. */
function linkResultOf(answer: BridgeAnswer): BridgeLinkResult {
  if (answer.outcome === "link") return { outcome: "link", url: answer.url };
  if (answer.outcome === "unavailable") return answer;
  return { outcome: "failed", reason: answer.outcome === "failed" ? answer.reason : "bad_answer" };
}

/** The in-memory work list: queued jobs, the one job out (and whose it is) and the held polls. */
class WorkList {
  private readonly queue: Entry[] = [];
  private readonly waiters: Waiter[] = [];
  private out: { readonly entry: Entry; readonly instance: string } | null = null;
  private seq = 0;

  constructor(
    private readonly timer: BridgeTimer,
    private readonly limits: Limits,
  ) {}

  submit(work: BridgeWork, signal: AbortSignal): Promise<BridgeAnswer> {
    const job = bridgeJobSchema.safeParse({ ...work, ticket: this.limits.makeTicket(), timeoutMs: this.limits.jobTimeoutMs });
    if (!job.success) return Promise.resolve({ outcome: "failed", reason: "bad_job" });
    return new Promise<BridgeAnswer>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const entry: Entry = { job: job.data, seq: this.seq++, timer: null, pickupArmed: false, settled: false, settle: resolve };
      this.queue.push(entry);
      signal.addEventListener("abort", () => this.settle(entry, () => reject(signal.reason)), { once: true });
      this.changed();
    });
  }

  next(instance: string, signal: AbortSignal): Promise<BridgeJob | null> {
    if (this.out !== null && this.out.instance === instance) return Promise.resolve(this.resume(this.out.entry));
    const front = this.out === null ? this.front() : undefined;
    if (front !== undefined) {
      const job = this.handOut(front, instance);
      this.changed();
      return Promise.resolve(job);
    }
    return new Promise<BridgeJob | null>((resolve) => {
      const leave = (job: BridgeJob | null): void => {
        this.timer.cancel(held);
        const at = this.waiters.indexOf(waiter);
        if (at >= 0) this.waiters.splice(at, 1);
        resolve(job);
      };
      const waiter: Waiter = { instance, give: (job) => leave(job) };
      const held = this.timer.schedule(() => leave(null), this.limits.pollMs);
      this.waiters.push(waiter);
      signal.addEventListener("abort", () => leave(null), { once: true });
    });
  }

  deliver(result: BridgeResult, instance: string): boolean {
    const out = this.out;
    if (out === null || out.instance !== instance || out.entry.job.ticket !== result.ticket) return false;
    const { ticket: _ticket, ...answer } = result;
    this.settle(out.entry, () => out.entry.settle(answer));
    return true;
  }

  private giveUp(entry: Entry, reason: BridgeUnavailable): void {
    this.settle(entry, () => entry.settle({ outcome: "unavailable", reason }));
  }

  /** Settles an entry once, takes it off the list and lets the next job out. */
  private settle(entry: Entry, settle: () => void): void {
    if (entry.settled) return;
    entry.settled = true;
    this.timer.cancel(entry.timer);
    const at = this.queue.indexOf(entry);
    if (at >= 0) this.queue.splice(at, 1);
    if (this.out?.entry === entry) this.out = null;
    settle();
    this.changed();
  }

  private front(): Entry | undefined {
    return [...this.queue].sort((a, b) => SERVICE_ORDER[a.job.kind] - SERVICE_ORDER[b.job.kind] || a.seq - b.seq)[0];
  }

  private startAnswerTimer(entry: Entry): void {
    this.timer.cancel(entry.timer);
    entry.pickupArmed = false;
    entry.timer = this.timer.schedule(() => this.giveUp(entry, "no_answer"), this.limits.answerMs);
  }

  private handOut(entry: Entry, instance: string): BridgeJob {
    this.queue.splice(this.queue.indexOf(entry), 1);
    this.out = { entry, instance };
    this.startAnswerTimer(entry);
    return entry.job;
  }

  /** The same instance asks again after a restart: the same job, with a fresh answer deadline. */
  private resume(entry: Entry): BridgeJob {
    this.startAnswerTimer(entry);
    return entry.job;
  }

  /** After every change: a held poll takes the front job, and only a job that could be handed out waits on a pickup timer. */
  private changed(): void {
    let front = this.front();
    if (this.out === null && front !== undefined) {
      const waiter = this.waiters.shift();
      if (waiter !== undefined) waiter.give(this.handOut(front, waiter.instance));
    }
    front = this.out === null ? this.front() : undefined;
    for (const entry of this.queue) {
      if (entry === front || !entry.pickupArmed) continue;
      this.timer.cancel(entry.timer);
      entry.pickupArmed = false;
    }
    if (front !== undefined && !front.pickupArmed) {
      const eligible = front;
      eligible.pickupArmed = true;
      eligible.timer = this.timer.schedule(() => this.giveUp(eligible, "no_bridge"), this.limits.pickupMs);
    }
  }
}

export function browserBridge(options: BrowserBridgeOptions): BrowserBridge {
  const jobTimeoutMs = options.jobTimeoutMs ?? BRIDGE_JOB_TIMEOUT_MS;
  const list = new WorkList(options.timer, {
    pollMs: options.pollMs ?? BRIDGE_POLL_MS,
    pickupMs: options.pickupMs ?? BRIDGE_PICKUP_MS,
    jobTimeoutMs,
    answerMs: jobTimeoutMs + (options.answerGraceMs ?? BRIDGE_ANSWER_GRACE_MS),
    makeTicket: options.makeTicket ?? newTicket,
  });
  const submit = (work: BridgeWork, signal: AbortSignal): Promise<BridgeAnswer> => list.submit(work, signal);
  return {
    mode: "browser",
    work: { next: (instance, signal) => list.next(instance, signal), deliver: (result, instance) => list.deliver(result, instance) },
    submit,
    createLink: async (job: LinkBridgeJob, signal: AbortSignal): Promise<BridgeLinkResult> => linkResultOf(await submit({ kind: "link", sourceUrl: job.sourceUrl, subId1: job.subId1, subId2: job.subId2 }, signal)),
  };
}
