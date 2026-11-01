import { parseInstant, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeZaloSession } from "../src/fake-zalo.adapter";
import { createPacer, drawDelay, timerSleep } from "../src/pacer";

const START = "2026-11-01T03:00:00.000Z";
const DELAY = { minMs: 6_000, maxMs: 12_000 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

const gaps = (times: readonly string[]): number[] => times.slice(1).map((t, i) => toMs(parseInstant(t)) - toMs(parseInstant(times[i]!)));

describe("Story 6.1: the human-pace pacer", () => {
  it("AC1: 10 replies due at once are sent one at a time, each after the configured human delay", async () => {
    const zalo = fakeZaloSession(systemClock);
    const pacer = createPacer({ clock: systemClock, sleep: timerSleep, delay: DELAY, random: () => 0.5 });
    let inFlight = 0;
    let most = 0;
    const replies = Array.from({ length: 10 }, (_, i) =>
      pacer.send(async () => {
        most = Math.max(most, ++inFlight);
        await zalo.sendText({ kind: "private", userId: `u${i}` }, `reply ${i}`);
        inFlight -= 1;
      }),
    );
    expect(pacer.queued()).toBe(10);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(zalo.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(9 * 9_000);
    await Promise.all(replies);
    expect(zalo.sent.map((s) => s.text)).toEqual(Array.from({ length: 10 }, (_, i) => `reply ${i}`));
    expect(gaps(zalo.sent.map((s) => s.at))).toEqual(Array(9).fill(drawDelay(DELAY, () => 0.5)));
    expect(most).toBe(1);
    expect(pacer.queued()).toBe(0);
  });

  it("AC1: with jitter every gap stays inside the configured bounds, and the earliest possible send never comes early", async () => {
    const zalo = fakeZaloSession(systemClock);
    const draws = [0, 0.99999, 0.3, 0.7, 0.1, 0.5, 0.9, 0.2, 0.6];
    const pacer = createPacer({ clock: systemClock, sleep: timerSleep, delay: DELAY, random: () => draws.shift() ?? 0 });
    const replies = Array.from({ length: 10 }, (_, i) => pacer.send(() => zalo.sendText({ kind: "group", groupId: "8786316503449470342" }, `r${i}`)));
    await vi.advanceTimersByTimeAsync(10 * DELAY.maxMs);
    await Promise.all(replies);
    const sent = gaps(zalo.sent.map((s) => s.at));
    expect(sent).toHaveLength(9);
    for (const gap of sent) expect(gap >= DELAY.minMs && gap <= DELAY.maxMs).toBe(true);
    expect(sent[0]).toBe(DELAY.minMs);
    expect(sent[1]).toBe(DELAY.maxMs);
  });

  it("a failed send keeps the pace for the next one and does not block the queue", async () => {
    const zalo = fakeZaloSession(systemClock);
    const pacer = createPacer({ clock: systemClock, sleep: timerSleep, delay: DELAY, random: () => 0 });
    const failed = pacer.send(async () => {
      throw new Error("zalo down");
    });
    const next = pacer.send(() => zalo.sendText({ kind: "private", userId: "u1" }, "after"));
    await expect(failed).rejects.toThrow("zalo down");
    await vi.advanceTimersByTimeAsync(DELAY.minMs - 1);
    expect(zalo.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect(zalo.sent).toHaveLength(1);
  });

  it("a send long after the previous one goes at once, and bad bounds are refused", async () => {
    const zalo = fakeZaloSession(systemClock);
    const pacer = createPacer({ clock: systemClock, sleep: timerSleep, delay: DELAY });
    await pacer.send(() => zalo.sendText({ kind: "private", userId: "u1" }, "a"));
    await vi.advanceTimersByTimeAsync(60_000);
    const second = pacer.send(() => zalo.sendText({ kind: "private", userId: "u1" }, "b"));
    await vi.advanceTimersByTimeAsync(0);
    await second;
    expect(zalo.sent).toHaveLength(2);
    expect(() => createPacer({ clock: systemClock, sleep: timerSleep, delay: { minMs: 0, maxMs: 10 } })).toThrow(RangeError);
    expect(() => createPacer({ clock: systemClock, sleep: timerSleep, delay: { minMs: 10, maxMs: 5 } })).toThrow(RangeError);
  });
});
