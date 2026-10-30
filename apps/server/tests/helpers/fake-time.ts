/**
 * Manual time for scheduler tests: one clock and one timer that move only when the test
 * calls `advance`. Due callbacks run in time order, each at its own instant, and pending
 * promise work is flushed after each one, so a job that awaits finishes when its turn comes.
 */
import { instantFromMs, parseInstant, toMs, type Clock } from "@cashback/core";

import type { JobTimer } from "../../src/platform/jobs/scheduler";

interface Pending {
  id: number;
  at: number;
  fn: () => void;
}

export interface FakeTime {
  clock: Clock;
  timer: JobTimer;
  /** Moves time forward, running every callback that falls due on the way. */
  advance(ms: number): Promise<void>;
  /** Pending callbacks, for assertions. */
  pending(): number;
}

/** Lets settled promises run their continuations (a few hops of microtasks and one macrotask). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

export function fakeTime(start: string): FakeTime {
  let now = toMs(parseInstant(start));
  let nextId = 1;
  let timers: Pending[] = [];
  return {
    clock: { now: () => instantFromMs(now) },
    timer: {
      schedule(fn, delayMs) {
        const id = nextId++;
        timers.push({ id, at: now + delayMs, fn });
        return id;
      },
      cancel(handle) {
        timers = timers.filter((t) => t.id !== handle);
      },
    },
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter((t) => t.id !== due.id);
        now = due.at;
        due.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    pending: () => timers.length,
  };
}
