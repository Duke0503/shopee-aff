import { join } from "node:path";
import { fixedClock } from "@cashback/core";
import { describe, expect, it, vi } from "vitest";

import { AssistantConfigError, isolationFor, parseAssistantConfig, REPOSITORY_ROOT, type AssistantIsolation } from "../src/assistant.config";
import { fakeZaloSession } from "../src/fake-zalo.adapter";
import { guardTargets, ZaloTargetRefused } from "../src/zalo-target.guard";
import { openZaloSession, type SessionOpeners } from "../src/zalo-session";

const HOME = join(REPOSITORY_ROOT, "..", "fake-home");
const PROD_CREDENTIALS = join(HOME, "secrets", "prod-zalo.json");
const ISOLATION: AssistantIsolation = isolationFor(REPOSITORY_ROOT, HOME, { ZALO_CREDENTIALS_PATH: PROD_CREDENTIALS }, process.platform === "win32");
const DEV_GROUP = "8786316503449470342";
const LIVE_GROUP = "2813090100064697955";
const TOKEN = "a".repeat(40);
const DEV_CREDENTIALS = join(HOME, ".config", "cashback", "dev-zalo-credentials.json");
const CLOCK = fixedClock("2026-11-01T03:00:00.000Z");

const dev = (values: Record<string, string> = {}) => parseAssistantConfig("dev", { ASSISTANT_TOKEN: TOKEN, ...values }, ISOLATION);

function openers(): SessionOpeners & { accountCalls: string[] } {
  const accountCalls: string[] = [];
  return {
    accountCalls,
    fake: fakeZaloSession,
    account: async (path) => {
      accountCalls.push(path);
      return fakeZaloSession(CLOCK);
    },
    relay: () => {
      throw new Error("no relay in these tests");
    },
  };
}

describe("Story 6.1: dev configuration", () => {
  it("AC5: a dev configuration with no Zalo settings starts the fake Zalo client and never opens an account", async () => {
    const config = dev();
    expect(config).toMatchObject({ env: "dev", zaloMode: "fake", zaloCredentialsPath: null, internalBaseUrl: "http://127.0.0.1:9081", sendDelay: { minMs: 6_000, maxMs: 12_000 }, friendRequestsPerDay: 30 });
    const o = openers();
    const session = await openZaloSession(config, CLOCK, vi.fn(), o);
    expect(session.mode).toBe("fake");
    expect(o.accountCalls).toEqual([]);
  });

  it("AC5: the dev Zalo account opens only with its own credentials and the Dev group", async () => {
    const config = dev({ ZALO_MODE: "account", ZALO_CREDENTIALS_PATH: DEV_CREDENTIALS, ZALO_GROUP_IDS: DEV_GROUP });
    const o = openers();
    await openZaloSession(config, CLOCK, vi.fn(), o);
    expect(o.accountCalls).toEqual([DEV_CREDENTIALS]);
  });

  it("AC5: dev never uses the production credentials path", () => {
    const production = [join(REPOSITORY_ROOT, "zalo_assistant", "credentials.json"), PROD_CREDENTIALS, join(REPOSITORY_ROOT, "data", "prod", "zalo.json"), "C:/Project/mmo/zalo_assistant/credentials.json", join(HOME, ".config", "cashback", "prod.env")];
    for (const path of production) {
      expect(() => dev({ ZALO_MODE: "account", ZALO_CREDENTIALS_PATH: path, ZALO_GROUP_IDS: DEV_GROUP })).toThrow(/ZALO_CREDENTIALS_PATH \(production credentials\)/);
    }
    expect(() => dev({ ZALO_MODE: "account" })).toThrow(/ZALO_CREDENTIALS_PATH/);
  });

  it("AC5: dev may name only the Dev group and never a production port; production never runs the fake", () => {
    expect(() => dev({ ZALO_GROUP_IDS: `${DEV_GROUP},${LIVE_GROUP}` })).toThrow(/ZALO_GROUP_IDS \(not the Dev group\)/);
    expect(() => dev({ INTERNAL_PORT: "8081" })).toThrow(/INTERNAL_PORT/);
    expect(dev().dataDir).toBe(join(REPOSITORY_ROOT, "data", "dev", "assistant"));
    expect(() => dev({ ASSISTANT_DATA_DIR: join(REPOSITORY_ROOT, "data", "prod", "assistant") })).toThrow(/ASSISTANT_DATA_DIR \(production folder\)/);
    expect(() => dev({ ASSISTANT_DATA_DIR: join(REPOSITORY_ROOT, "zalo_assistant") })).toThrow(/ASSISTANT_DATA_DIR/);
    expect(() => parseAssistantConfig("prod", { ASSISTANT_TOKEN: TOKEN, ZALO_MODE: "fake" }, ISOLATION)).toThrow(/fake in production/);
    expect(parseAssistantConfig("prod", { ASSISTANT_TOKEN: TOKEN, ZALO_CREDENTIALS_PATH: PROD_CREDENTIALS, ZALO_GROUP_IDS: LIVE_GROUP }, ISOLATION)).toMatchObject({ zaloMode: "account", internalBaseUrl: "http://127.0.0.1:8081" });
  });

  it("refuses a missing token, a delay below a human pace or upside down, and more than 30 friend requests a day, naming keys only", () => {
    expect(() => parseAssistantConfig("dev", {}, ISOLATION)).toThrow(AssistantConfigError);
    expect(() => dev({ ASSISTANT_SEND_DELAY_MIN_MS: "500" })).toThrow(/ASSISTANT_SEND_DELAY_MIN_MS/);
    expect(() => dev({ ASSISTANT_SEND_DELAY_MIN_MS: "9000", ASSISTANT_SEND_DELAY_MAX_MS: "8000" })).toThrow(/ASSISTANT_SEND_DELAY_MAX_MS/);
    expect(() => dev({ ASSISTANT_FRIEND_REQUESTS_PER_DAY: "31" })).toThrow(/ASSISTANT_FRIEND_REQUESTS_PER_DAY/);
    try {
      parseAssistantConfig("dev", { ASSISTANT_TOKEN: "short-secret-value" }, ISOLATION);
    } catch (error) {
      expect(String(error)).not.toContain("short-secret-value");
    }
  });

  it("the session guard refuses a group outside ZALO_GROUP_IDS and drops its messages", async () => {
    const inner = fakeZaloSession(CLOCK);
    const guarded = guardTargets(inner, [DEV_GROUP]);
    await expect(guarded.sendText({ kind: "group", groupId: LIVE_GROUP }, "x")).rejects.toBeInstanceOf(ZaloTargetRefused);
    await guarded.sendText({ kind: "group", groupId: DEV_GROUP }, "x");
    await guarded.sendText({ kind: "private", userId: "u1" }, "x");
    expect(inner.sent.map((s) => s.target)).toEqual([{ kind: "group", groupId: DEV_GROUP }, { kind: "private", userId: "u1" }]);
    const seen: string[] = [];
    guarded.onMessage(async (m) => {
      seen.push(m.text);
    });
    await inner.deliver({ chat: { kind: "group", groupId: LIVE_GROUP }, senderId: "u2", text: "live" });
    await inner.deliver({ chat: { kind: "group", groupId: DEV_GROUP }, senderId: "u2", text: "dev" });
    expect(seen).toEqual(["dev"]);
  });
});
