import { ASSISTANT_HEARTBEAT_PATH, ASSISTANT_TOKEN_HEADER, assistantHeartbeatSchema } from "@cashback/contracts";
import { parseInstant, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { fakeZaloSession } from "../src/fake-zalo.adapter";
import { internalApi, type FetchLike } from "../src/internal-api.adapter";
import { timerSleep } from "../src/pacer";

const START = "2026-11-01T03:00:00.000Z";
const TOKEN = "a".repeat(40);
const BASE = "http://127.0.0.1:9081";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(status = 200): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body ?? "null") });
    return { status, json: async () => ({ receivedAt: systemClock.now() }) };
  };
  return { fetch, calls };
}

function start(fetch: FetchLike, onError = vi.fn()) {
  const assistant = startAssistant({
    zalo: fakeZaloSession(systemClock),
    api: internalApi({ baseUrl: BASE, token: TOKEN, fetch }),
    clock: systemClock,
    sleep: timerSleep,
    sendDelay: { minMs: 6_000, maxMs: 12_000 },
    zaloGroupIds: ["8786316503449470342"],
    friendRequestsPerDay: 30,
    onError,
  });
  return { assistant, onError };
}

describe("Story 6.1: the assistant heartbeat", () => {
  it("AC3: when 60 s pass, a heartbeat with the assistant token reaches /internal/assistant/heartbeat", async () => {
    const { fetch, calls } = fakeFetch();
    const { assistant } = start(fetch);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);

    for (const call of calls) {
      expect(call.url).toBe(`${BASE}${ASSISTANT_HEARTBEAT_PATH}`);
      expect(call.headers[ASSISTANT_TOKEN_HEADER]).toBe(TOKEN);
      expect(assistantHeartbeatSchema.parse(call.body)).toEqual({ zalo: "fake", session: "connected", startedAt: START, queuedSends: 0 });
    }
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(4);
    await assistant.stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(calls).toHaveLength(4);
  });

  it("AC3: a refused heartbeat is reported and the loop goes on", async () => {
    const { fetch, calls } = fakeFetch(401);
    const { assistant, onError } = start(fetch);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]![0]).toBe("assistant.heartbeat.failed");
    expect(String(onError.mock.calls[0]![1])).not.toContain(TOKEN);
    await assistant.stop();
  });

  it("the internal api accepts only http://127.0.0.1:<port>", () => {
    const { fetch } = fakeFetch();
    for (const baseUrl of ["http://localhost:9081", "https://127.0.0.1:9081", "http://127.0.0.1:9081/", "http://10.0.0.1:9081", "http://127.0.0.1:99999", "https://hoantiendp.com"]) {
      expect(() => internalApi({ baseUrl, token: TOKEN, fetch })).toThrow(RangeError);
    }
    expect(() => internalApi({ baseUrl: BASE, token: TOKEN, fetch })).not.toThrow();
  });
});
