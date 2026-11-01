/**
 * The send-only relay to the Dev group through the live bot (owner's testing policy): only the
 * configured Dev group, always as group "test", with the live bot's token; never a private target,
 * never another group, never a friend request; dev only. A fake `fetch` stands in for the live bot.
 */
import { join } from "node:path";
import { fixedClock } from "@cashback/core";
import { describe, expect, it, vi } from "vitest";

import { isolationFor, parseAssistantConfig, REPOSITORY_ROOT } from "../src/assistant.config";
import { fakeZaloSession } from "../src/fake-zalo.adapter";
import type { FetchLike } from "../src/internal-api.adapter";
import { LIVE_BOT_BROADCAST_URL, RelaySendError, relayZaloSession } from "../src/relay-zalo.adapter";
import { ZaloTargetRefused } from "../src/zalo-target.guard";
import { openZaloSession } from "../src/zalo-session";

const DEV_GROUP = "8786316503449470342";
const MAIN_GROUP = "2813090100064697955";
const LIVE_TOKEN = "l".repeat(32);
const TOKEN = "a".repeat(40);
const ISOLATION = isolationFor(REPOSITORY_ROOT, join(REPOSITORY_ROOT, "..", "fake-home"), null, process.platform === "win32");

function liveBot(status = 200): { fetch: FetchLike; calls: { url: string; headers: Record<string, string>; body: unknown }[] } {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body ?? "null") });
    return { status, json: async () => ({ ok: status === 200 }) };
  };
  return { fetch, calls };
}

describe("the relay Zalo session (ZALO_MODE=relay)", () => {
  it("posts a send to the Dev group to the live bot's local broadcast API as group 'test' with its token", async () => {
    const bot = liveBot();
    const session = relayZaloSession({ token: LIVE_TOKEN, devGroupId: DEV_GROUP, fetch: bot.fetch });
    await session.sendText({ kind: "group", groupId: DEV_GROUP }, "hello dev");
    expect(session.mode).toBe("relay");
    expect(bot.calls).toEqual([{ url: "http://127.0.0.1:8891/api/broadcast", headers: { "content-type": "application/json", "x-assistant-token": LIVE_TOKEN }, body: { group: "test", message: "hello dev" } }]);
    expect(LIVE_BOT_BROADCAST_URL).toBe("http://127.0.0.1:8891/api/broadcast");
  });

  it("refuses the main group, any other group, a private target and every friend request before anything is sent", async () => {
    const bot = liveBot();
    const session = relayZaloSession({ token: LIVE_TOKEN, devGroupId: DEV_GROUP, fetch: bot.fetch });
    await expect(session.sendText({ kind: "group", groupId: MAIN_GROUP }, "x")).rejects.toBeInstanceOf(ZaloTargetRefused);
    await expect(session.sendText({ kind: "group", groupId: "123" }, "x")).rejects.toBeInstanceOf(ZaloTargetRefused);
    await expect(session.sendText({ kind: "private", userId: "70001" }, "x")).rejects.toBeInstanceOf(ZaloTargetRefused);
    await expect(session.addFriend("70001", "hi")).rejects.toBeInstanceOf(ZaloTargetRefused);
    expect(bot.calls).toEqual([]);
  });

  it("a refused broadcast is an error that names the status, never the token", async () => {
    const session = relayZaloSession({ token: LIVE_TOKEN, devGroupId: DEV_GROUP, fetch: liveBot(401).fetch });
    const error = await session.sendText({ kind: "group", groupId: DEV_GROUP }, "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RelaySendError);
    expect(String(error)).not.toContain(LIVE_TOKEN);
  });

  it("is dev only, needs LIVE_BOT_TOKEN and exactly the Dev group, and opens without any account", async () => {
    const config = parseAssistantConfig("dev", { ASSISTANT_TOKEN: TOKEN, ZALO_MODE: "relay", ZALO_GROUP_IDS: DEV_GROUP, LIVE_BOT_TOKEN: LIVE_TOKEN }, ISOLATION);
    expect(config).toMatchObject({ zaloMode: "relay", liveBotToken: LIVE_TOKEN, zaloCredentialsPath: null, zaloGroupIds: [DEV_GROUP] });
    expect(() => parseAssistantConfig("dev", { ASSISTANT_TOKEN: TOKEN, ZALO_MODE: "relay", ZALO_GROUP_IDS: DEV_GROUP }, ISOLATION)).toThrow(/LIVE_BOT_TOKEN/);
    expect(() => parseAssistantConfig("dev", { ASSISTANT_TOKEN: TOKEN, ZALO_MODE: "relay", LIVE_BOT_TOKEN: LIVE_TOKEN }, ISOLATION)).toThrow(/ZALO_GROUP_IDS/);
    expect(() => parseAssistantConfig("dev", { ASSISTANT_TOKEN: TOKEN, ZALO_MODE: "relay", ZALO_GROUP_IDS: `${DEV_GROUP},${MAIN_GROUP}`, LIVE_BOT_TOKEN: LIVE_TOKEN }, ISOLATION)).toThrow(/ZALO_GROUP_IDS/);
    expect(() => parseAssistantConfig("prod", { ASSISTANT_TOKEN: TOKEN, ZALO_MODE: "relay", ZALO_GROUP_IDS: DEV_GROUP, LIVE_BOT_TOKEN: LIVE_TOKEN }, ISOLATION)).toThrow(/relay in production/);
    const opened: string[] = [];
    const clock = fixedClock("2026-11-01T03:00:00.000Z");
    const session = await openZaloSession(config, clock, vi.fn(), {
      fake: fakeZaloSession,
      account: async () => {
        throw new Error("no account");
      },
      relay: (token, group) => (opened.push(`${token === LIVE_TOKEN}:${group}`), fakeZaloSession(clock)),
    });
    expect(session.mode).toBe("fake");
    expect(opened).toEqual([`true:${DEV_GROUP}`]);
  });

  it("owner decision: a group mention is passed to the live bot as {uid, pos, len}", async () => {
    const bot = liveBot();
    const session = relayZaloSession({ token: LIVE_TOKEN, devGroupId: DEV_GROUP, fetch: bot.fetch });
    await session.sendText({ kind: "group", groupId: DEV_GROUP }, "@Minh\nhello", [{ userId: "70005", pos: 0, len: 5 }]);
    expect(bot.calls[0]!.body).toEqual({ group: "test", message: "@Minh\nhello", mentions: [{ uid: "70005", pos: 0, len: 5 }] });
  });

  it("review 7: every session openZaloSession hands out is behind guardTargets, the relay included", async () => {
    const config = parseAssistantConfig("dev", { ASSISTANT_TOKEN: TOKEN, ZALO_MODE: "relay", ZALO_GROUP_IDS: DEV_GROUP, LIVE_BOT_TOKEN: LIVE_TOKEN }, ISOLATION);
    const clock = fixedClock("2026-11-01T03:00:00.000Z");
    const inner = fakeZaloSession(clock);
    const openers = { fake: () => inner, account: async () => inner, relay: () => inner };
    for (const zaloMode of ["relay", "fake"] as const) {
      const session = await openZaloSession({ ...config, zaloMode }, clock, vi.fn(), openers);
      await expect(session.sendText({ kind: "group", groupId: MAIN_GROUP }, "x")).rejects.toBeInstanceOf(ZaloTargetRefused);
    }
    expect(inner.sent).toEqual([]);
  });
});
