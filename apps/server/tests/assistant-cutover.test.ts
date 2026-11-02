/**
 * Cutover parity with the live assistant (owner decisions), server side: the friend check the
 * assistant asks before accepting a friend request (never the guest account or a disabled
 * customer, nobody registered by it), and the immediate `assistant_session_conflict` alert when a
 * heartbeat says another login took the Zalo account. The assistant side is
 * apps/assistant/tests/session-events.test.ts.
 */
import { ASSISTANT_FRIEND_CHECK_PATH, type AssistantHeartbeat } from "@cashback/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { assistantCommandRoutes } from "../src/links/assistant-command.routes";
import { assistantHeartbeats, healthCheck } from "../src/modules/operations/index";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER, INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import type { AlertSeverity } from "../src/platform/ports/alert.port";
import { closeLedgers } from "./helpers/order-ledger";
import { CLOCK, payoutLedger } from "./helpers/payout-ledger";

const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);

const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  closeLedgers();
});

function app(ledger: Ledger) {
  const servers = buildServers({ clock: CLOCK, internalToken: INTERNAL, assistantToken: ASSISTANT, internal: [assistantCommandRoutes({ ledger, clock: CLOCK })], public: [] });
  opened.push(servers);
  return async (zaloUserId: string, headers: Record<string, string> = { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }) => {
    const res = await servers.internalApp.inject({ method: "POST", url: ASSISTANT_FRIEND_CHECK_PATH, headers, payload: { zaloUserId } });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };
}

const customerCount = (ledger: Ledger): number => (ledger.sqlite.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number }).n;

describe("cutover: the friend check before accepting a friend request", () => {
  it("accepts an active customer and a person the server does not know, registering no one", async () => {
    const ledger = payoutLedger();
    const before = customerCount(ledger);
    const check = app(ledger);
    expect(await check("P1")).toEqual({ status: 200, body: { accept: true } });
    expect(await check("90001")).toEqual({ status: 200, body: { accept: true } });
    expect(customerCount(ledger)).toBe(before);
  });

  it("refuses the guest account (HOUSE) and a disabled customer; the route needs the assistant token", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("UPDATE customers SET status = 'DISABLED' WHERE customer_id = 'P1'");
    const check = app(ledger);
    expect((await check("HOUSE")).body).toEqual({ accept: false });
    expect((await check("P1")).body).toEqual({ accept: false });
    expect((await check("P1", { [INTERNAL_TOKEN_HEADER]: INTERNAL })).status).toBe(401);
    expect((await check("not valid!")).status).toBe(400);
  });
});

describe("cutover: a Zalo session taken by another login alerts the owner at once", () => {
  const beat = (over: Partial<AssistantHeartbeat> = {}): AssistantHeartbeat => ({ zalo: "account", session: "connected", startedAt: CLOCK.now(), account: "1234567890", queuedSends: 0, ...over });

  it("raises one critical assistant_session_conflict at the next check, not again while it lasts, and again after it cleared", () => {
    const heartbeats = assistantHeartbeats(CLOCK.now());
    const raised: [string, AlertSeverity][] = [];
    const check = healthCheck({ model: () => [], alerts: { alert: (kind, severity) => void raised.push([kind, severity]) }, clock: CLOCK, heartbeats });
    heartbeats.record(beat(), CLOCK.now());
    check.run();
    expect(raised).toEqual([]);
    heartbeats.record(beat({ session: "disconnected", sessionConflict: true }), CLOCK.now());
    expect(check.run().raised).toEqual([{ kind: "assistant_session_conflict", severity: "critical" }]);
    check.run();
    expect(raised).toEqual([["assistant_session_conflict", "critical"]]);
    heartbeats.record(beat(), CLOCK.now());
    check.run();
    heartbeats.record(beat({ session: "disconnected", sessionConflict: true }), CLOCK.now());
    check.run();
    expect(raised).toHaveLength(2);
  });
});
