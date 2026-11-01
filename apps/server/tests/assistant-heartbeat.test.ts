/**
 * Story 6.1: the assistant's heartbeat reaches the internal listener behind the assistant token.
 */
import { ASSISTANT_HEARTBEAT_PATH, type AssistantHeartbeat } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { healthOf } from "../src/admin/overview-activity.query";
import { assistantHeartbeatRoutes, assistantHeartbeats } from "../src/modules/operations/index";
import { ASSISTANT_TOKEN_HEADER, INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { closeLedgers, freshLedger } from "./helpers/order-ledger";

const CLOCK = fixedClock("2026-11-01T03:00:00.000Z");
const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);
const BEAT: AssistantHeartbeat = { zalo: "fake", session: "connected", startedAt: "2026-11-01T02:59:00.000Z", queuedSends: 0 };

let servers: Servers | null = null;
afterEach(async () => {
  if (servers) await close(servers);
  servers = null;
});

function build(assistantToken: string | null = ASSISTANT) {
  const heartbeats = assistantHeartbeats();
  servers = buildServers({ clock: CLOCK, internalToken: INTERNAL, assistantToken, internal: [assistantHeartbeatRoutes({ clock: CLOCK, heartbeats })] });
  const post = (headers: Record<string, string>, payload: unknown = BEAT) => servers!.internalApp.inject({ method: "POST", url: ASSISTANT_HEARTBEAT_PATH, headers, payload: payload as object });
  return { heartbeats, post };
}

describe("Story 6.1: assistant heartbeat route", () => {
  it("AC3: a heartbeat with the assistant token is recorded with the server's time", async () => {
    const { heartbeats, post } = build();
    const response = await post({ [ASSISTANT_TOKEN_HEADER]: ASSISTANT });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ receivedAt: "2026-11-01T03:00:00.000Z" });
    expect(heartbeats.last()).toEqual({ receivedAt: "2026-11-01T03:00:00.000Z", beat: BEAT });
  });

  it("AC3: without a token, with a wrong one, or with the internal token it is 401 and nothing is recorded", async () => {
    const { heartbeats, post } = build();
    const attempts: Record<string, string>[] = [{}, { [ASSISTANT_TOKEN_HEADER]: "b".repeat(40) }, { [INTERNAL_TOKEN_HEADER]: INTERNAL }];
    for (const headers of attempts) {
      expect((await post(headers)).statusCode).toBe(401);
    }
    expect(heartbeats.last()).toBeNull();
  });

  it("AC3: with no assistant token configured the route answers 401", async () => {
    const { post } = build(null);
    expect((await post({ [ASSISTANT_TOKEN_HEADER]: ASSISTANT })).statusCode).toBe(401);
  });

  it("AC3: a body that is not a heartbeat is refused and not recorded", async () => {
    const { heartbeats, post } = build();
    const response = await post({ [ASSISTANT_TOKEN_HEADER]: ASSISTANT }, { ...BEAT, customer: "DP00001" });
    expect(response.statusCode).toBe(400);
    expect(heartbeats.last()).toBeNull();
  });
});

describe("Story 6.1 review 7: the heartbeat store is the one the Overview's health reads", () => {
  it("review 7: a beat through the route makes the assistant show as up, and five minutes without one as down", async () => {
    const { heartbeats, post } = build();
    const ledger = freshLedger();
    expect(healthOf(ledger.db, CLOCK, () => heartbeats.last()).find((h) => h.component === "assistant")).toEqual({ component: "assistant", state: "unknown", at: null });
    await post({ [ASSISTANT_TOKEN_HEADER]: ASSISTANT });
    expect(healthOf(ledger.db, CLOCK, () => heartbeats.last()).find((h) => h.component === "assistant")).toEqual({ component: "assistant", state: "up", at: "2026-11-01T03:00:00.000Z" });
    const later = fixedClock("2026-11-01T03:05:01.000Z");
    expect(healthOf(ledger.db, later, () => heartbeats.last()).find((h) => h.component === "assistant")?.state).toBe("down");
    closeLedgers();
  });
});
