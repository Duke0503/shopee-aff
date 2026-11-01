/**
 * The human-pace pacer (AD-15, D9). The one Zalo session is a personal account, and a burst of
 * sends is the surest way to get it locked, which cuts every customer off at once. So every send
 * (replies, notifications, friend requests) goes through one pacer: one send at a time, in the
 * order asked, and between the end of one send and the start of the next a human delay drawn
 * between the configured bounds. There is no batch call. A failed send still counts as a send for
 * the pace.
 */
import { toMs, type Clock } from "@cashback/core";

/** Waits `ms`; resolves early when `signal` aborts. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface HumanDelay {
  readonly minMs: number;
  readonly maxMs: number;
}

export interface PacerDeps {
  readonly clock: Clock;
  readonly sleep: Sleep;
  readonly delay: HumanDelay;
  /** A number in [0, 1); tests pass a fixed one. */
  readonly random?: () => number;
}

export interface Pacer {
  /** Runs `send` in its turn, after the human delay; resolves or rejects with its outcome. */
  send<T>(send: () => Promise<T>): Promise<T>;
  /** Sends asked for and not finished yet. */
  queued(): number;
}

export function drawDelay(delay: HumanDelay, random: () => number): number {
  return delay.minMs + Math.floor(random() * (delay.maxMs - delay.minMs + 1));
}

export function createPacer(deps: PacerDeps): Pacer {
  if (!(deps.delay.minMs > 0 && deps.delay.maxMs >= deps.delay.minMs)) throw new RangeError("human delay needs 0 < minMs <= maxMs");
  const random = deps.random ?? Math.random;
  let tail: Promise<unknown> = Promise.resolve();
  let lastEndMs: number | null = null;
  let waiting = 0;

  const turn = async <T>(send: () => Promise<T>): Promise<T> => {
    if (lastEndMs !== null) {
      const wait = lastEndMs + drawDelay(deps.delay, random) - toMs(deps.clock.now());
      if (wait > 0) await deps.sleep(wait);
    }
    try {
      return await send();
    } finally {
      lastEndMs = toMs(deps.clock.now());
      waiting -= 1;
    }
  };

  return {
    send: (send) => {
      waiting += 1;
      const run = tail.then(() => turn(send));
      tail = run.catch(() => undefined);
      return run;
    },
    queued: () => waiting,
  };
}

/** The real sleep: a timer that an abort clears. */
export const timerSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
