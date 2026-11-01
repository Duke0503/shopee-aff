/**
 * Story 6.11 (server side): Zalo account loss keeps customers served and alerts the owner (AD-15,
 * AD-16, AD-27, FR-30, FR-36, D9). Five minutes without a connected heartbeat, whether the
 * assistant stopped beating or beats with its session lost, raise one critical `assistant_down`
 * alert and the health model reports the assistant down; notifications wait on the server, the
 * ones older than 7 days are dropped and counted; a new Zalo account yields merge proposals for the
 * admin command, never a merge; the down state clears when a connected beat is back. Nothing here
 * or in the assistant's tests logs in to Zalo: the loss is played by the fake session
 * (apps/assistant/tests/zalo-loss.test.ts).
 */
import { ASSISTANT_HEARTBEAT_PATH, STAFF_TOKEN_HEADER, type AssistantHeartbeat } from "@cashback/contracts";
import { fixedClock, instantFromMs, parseInstant, toMs, type Instant } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { runAdminCli, type CliIo } from "../src/admin/admin-cli";
import { adminCommandRoutes } from "../src/admin/admin-command.routes";
import { healthOf } from "../src/admin/overview-activity.query";
import { latestZaloSwitch, mergeProposals, openSession, recordMergeClaim, registerCustomer, STAFF_SESSION_MS } from "../src/modules/identity/index";
import { droppedNotifications, enqueue, handOutNext } from "../src/modules/messaging/index";
import { alertsFor, ASSISTANT_DOWN_ALERT, assistantHeartbeatRoutes, assistantHeartbeats, commandAudit, ledgerAlerts, runAssistantHealthCheck } from "../src/modules/operations/index";
import { runNotificationExpiry } from "../src/notifications/notification-expiry.job";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER, INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { alertRows, C1, linkLedger, movingClock, SILENT } from "./helpers/link-ledger";
import { closeLedgers } from "./helpers/order-ledger";
import { CLOCK, payoutLedger } from "./helpers/payout-ledger";
import { addStaff, generatedPassword } from "./helpers/staff-desk";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const START = "2026-11-01T03:00:00.000Z";
const beat = (session: "connected" | "disconnected"): AssistantHeartbeat => ({ zalo: "account", session, startedAt: START, queuedSends: 0 });
const at = (ms: number): Instant => instantFromMs(toMs(parseInstant(START)) + ms);

const ledgers: Ledger[] = [];
const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  for (const l of ledgers.splice(0)) l.close();
  closeLedgers();
});

function watcher() {
  const ledger = linkLedger(ledgers);
  const clock = movingClock(START);
  const heartbeats = assistantHeartbeats(clock.now());
  const check = () => runAssistantHealthCheck({ heartbeats, clock, alerts: ledgerAlerts(ledger, clock, SILENT) });
  const assistantState = () => healthOf(ledger.db, clock, (now) => heartbeats.liveness(now)).find((h) => h.component === "assistant");
  return { ledger, clock, heartbeats, check, assistantState };
}

describe("Story 6.11: Zalo account loss keeps customers served and alerts the owner", () => {
  it("AC1: given no heartbeat for 5 minutes, the health check raises one critical assistant_down alert and the health model reports the assistant down", () => {
    const { ledger, clock, heartbeats, check, assistantState } = watcher();
    heartbeats.record(beat("connected"), clock.now());
    clock.advance(5 * MINUTE);
    expect(check()).toBe("up");
    expect(assistantState()).toEqual({ component: "assistant", state: "up", at: START });
    clock.advance(1);
    expect(check()).toBe("went_down");
    expect(heartbeats.downSince()).toBe(at(5 * MINUTE + 1));
    expect(assistantState()).toEqual({ component: "assistant", state: "down", at: START });
    for (let i = 0; i < 30; i++) {
      clock.advance(MINUTE);
      expect(check()).toBe("still_down");
    }
    expect(alertRows(ledger)).toEqual([{ kind: ASSISTANT_DOWN_ALERT.kind, severity: "critical", suppressed: 0 }]);
  });

  it("AC1: an assistant that keeps beating with its Zalo session lost is down after 5 minutes too", () => {
    const { ledger, clock, heartbeats, check } = watcher();
    heartbeats.record(beat("connected"), clock.now());
    for (let i = 0; i < 6; i++) {
      clock.advance(MINUTE);
      heartbeats.record(beat("disconnected"), clock.now());
      check();
    }
    expect(heartbeats.liveness(clock.now()).state).toBe("down");
    expect(alertRows(ledger)).toEqual([{ kind: "assistant_down", severity: "critical", suppressed: 0 }]);
  });

  it("AC1: with no connected beat at all since the server started, the assistant is not known for 5 minutes, then down", () => {
    const { ledger, clock, check, assistantState } = watcher();
    expect(check()).toBe("unknown");
    expect(assistantState()).toEqual({ component: "assistant", state: "unknown", at: null });
    clock.advance(5 * MINUTE + 1);
    expect(check()).toBe("went_down");
    expect(assistantState()).toEqual({ component: "assistant", state: "down", at: null });
    expect(alertRows(ledger)).toHaveLength(1);
  });

  it("AC2: while the assistant is down, notifications wait on the server and go out once it is back; rows older than 7 days are dropped and counted", () => {
    const { ledger, clock, heartbeats, check } = watcher();
    const by = (db: Parameters<typeof commandAudit>[0]) => commandAudit(db, clock, { kind: "system", id: "test" });
    ledger.sqlite.exec(`UPDATE customers SET zalo_user_id = '70001' WHERE customer_id = '${C1}'`);
    heartbeats.record(beat("connected"), clock.now());
    ledger.tx((db) => enqueue(db, clock, { dedupKey: "link_request:OLD:failed", customerId: C1, messageKey: "link_failed", params: {} }, by(db)));
    clock.advance(2 * DAY);
    ledger.tx((db) => enqueue(db, clock, { dedupKey: "link_request:NEW:failed", customerId: C1, messageKey: "link_failed", params: {} }, by(db)));
    expect(check()).toBe("went_down");
    // Down for six more days: the assistant pulls nothing (its session is lost), so both rows wait.
    clock.advance(5 * DAY);
    expect(runNotificationExpiry(ledger, clock)).toBe(0);
    clock.advance(DAY);
    expect(runNotificationExpiry(ledger, clock)).toBe(1);
    expect(droppedNotifications(ledger.db).expired).toBe(1);
    heartbeats.record(beat("connected"), clock.now());
    expect(check()).toBe("came_back");
    const handed = ledger.tx((db) => handOutNext(db, clock, { dailyCap: 150, alerts: alertsFor(db, clock) }));
    expect(handed.kind === "row" ? handed.row.dedupKey : null).toBe("link_request:NEW:failed");
  });

  it("AC3: given a new Zalo account connected, known customers writing under new Zalo ids produce merge proposals for the admin command, never a merge", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("UPDATE customers SET created_at = '2026-09-01T03:00:00.000Z'; INSERT OR REPLACE INTO customer_code_counter (id, last) VALUES (1, 99)");
    const connectedAt = "2026-10-30T12:00:00.000Z";
    const later = fixedClock("2026-10-30T13:00:00.000Z");
    const names = ledger.sqlite.prepare("SELECT customer_id, display_name FROM customers WHERE role = 'USER' AND display_name IS NOT NULL ORDER BY customer_id LIMIT 2").all() as { customer_id: string; display_name: string }[];
    const [known, other] = names;
    ledger.tx((db) => {
      const by = commandAudit(db, later, { kind: "assistant", id: "zalo" });
      registerCustomer(db, { zaloUserId: "80000000000000001", displayName: known!.display_name, via: "private_message" }, { clock: later, logger: SILENT, by });
      registerCustomer(db, { zaloUserId: "80000000000000002", displayName: "Someone New", via: "private_message" }, { clock: later, logger: SILENT, by });
    });
    const proposals = mergeProposals(ledger.db, parseInstant(connectedAt));
    expect(proposals).toEqual([{ merged: expect.objectContaining({ customerId: "80000000000000001" }), survivor: expect.objectContaining({ customerId: known!.customer_id, customerName: known!.display_name }), reason: "same_name" }]);
    expect(proposals.flatMap((p) => [p.merged.customerId, p.survivor.customerId])).not.toContain(other!.customer_id);

    const servers = buildServers({ clock: CLOCK, internalToken: "i".repeat(40), internal: [adminCommandRoutes({ ledger, clock: CLOCK })] });
    opened.push(servers);
    const session = ledger.tx((db) => openSession(db, { kind: "STAFF", staffId: "minh" }, CLOCK, STAFF_SESSION_MS));
    const ask = (headers: Record<string, string>) => servers.internalApp.inject({ method: "POST", url: "/internal/admin/customers/merge/proposals", headers: { [INTERNAL_TOKEN_HEADER]: "i".repeat(40), ...headers }, payload: { since: connectedAt } });
    const res = await ask({ [STAFF_TOKEN_HEADER]: session.token });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { proposals: unknown[] }).proposals).toHaveLength(1);
    expect((await ask({})).statusCode).toBeGreaterThanOrEqual(400);
    const statuses = ledger.sqlite.prepare("SELECT customer_id, status FROM customers WHERE customer_id IN (?, ?)").all("80000000000000001", known!.customer_id) as { status: string }[];
    expect(statuses.map((s) => s.status)).toEqual(["ACTIVE", "ACTIVE"]);
    expect((ledger.sqlite.prepare("SELECT count(*) AS n FROM customer_aliases").get() as { n: number }).n).toBe(0);
  });

  it("AC3: a name shared by two older customers proposes nothing", () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("UPDATE customers SET created_at = '2026-09-01T03:00:00.000Z', display_name = 'Lan', sort_key = 'same' WHERE customer_id IN ('P1', 'P2')");
    ledger.sqlite.exec("INSERT INTO customers (customer_id, customer_code, role, status, display_name, sort_key, created_at) VALUES ('N1', 'DP09999', 'USER', 'ACTIVE', 'Lan', 'same', '2026-10-30T13:00:00.000Z')");
    expect(mergeProposals(ledger.db, parseInstant("2026-10-30T12:00:00.000Z"))).toEqual([]);
  });

  it("AC4: given the heartbeat returns, the next health check clears the down state and raises no further alert", () => {
    const { ledger, clock, heartbeats, check, assistantState } = watcher();
    heartbeats.record(beat("connected"), clock.now());
    clock.advance(6 * MINUTE);
    expect(check()).toBe("went_down");
    clock.advance(MINUTE);
    heartbeats.record(beat("connected"), clock.now());
    expect(check()).toBe("came_back");
    expect(heartbeats.downSince()).toBeNull();
    expect(assistantState()?.state).toBe("up");
    clock.advance(MINUTE);
    expect(check()).toBe("up");
    expect(alertRows(ledger)).toHaveLength(1);
  });

  it("review 5: several new records with the same name, or one name on two older records, propose nothing", () => {
    const ledger = payoutLedger();
    const since = parseInstant("2026-10-30T12:00:00.000Z");
    ledger.sqlite.exec("UPDATE customers SET created_at = '2026-09-01T03:00:00.000Z'; UPDATE customers SET display_name = 'Lan', sort_key = 'lan' WHERE customer_id = 'P1'");
    const add = (id: string, code: string) => ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status, display_name, sort_key, created_at) VALUES (?, ?, 'USER', 'ACTIVE', 'Lan', 'lan', '2026-10-30T13:00:00.000Z')").run(id, code);
    add("N1", "DP09991");
    expect(mergeProposals(ledger.db, since).map((p) => [p.merged.customerId, p.survivor.customerId])).toEqual([["N1", "P1"]]);
    add("N2", "DP09992");
    expect(mergeProposals(ledger.db, since)).toEqual([]);
  });

  it("review 7: a since that is no real instant is refused as invalid_request, never a 500", async () => {
    const ledger = payoutLedger();
    const servers = buildServers({ clock: CLOCK, internalToken: "i".repeat(40), internal: [adminCommandRoutes({ ledger, clock: CLOCK })] });
    opened.push(servers);
    const session = ledger.tx((db) => openSession(db, { kind: "STAFF", staffId: "minh" }, CLOCK, STAFF_SESSION_MS));
    const res = await servers.internalApp.inject({ method: "POST", url: "/internal/admin/customers/merge/proposals", headers: { [INTERNAL_TOKEN_HEADER]: "i".repeat(40), [STAFF_TOKEN_HEADER]: session.token }, payload: { since: "2026-13-45T25:61:00.000Z" } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { messageKey: "error.invalid_request" } });
  });

  it("decision: a heartbeat stores the first time each Zalo account is seen; the latest one after a switch is the default since", async () => {
    const ledger = payoutLedger();
    const clock = movingClock(START);
    const servers = buildServers({ clock, internalToken: "i".repeat(40), assistantToken: "a".repeat(40), internal: [assistantHeartbeatRoutes({ clock, heartbeats: assistantHeartbeats(), ledger })] });
    opened.push(servers);
    const send = (account: string) => servers.internalApp.inject({ method: "POST", url: ASSISTANT_HEARTBEAT_PATH, headers: { [ASSISTANT_TOKEN_HEADER]: "a".repeat(40) }, payload: { ...beat("connected"), account } });
    expect((await send("11111111111111111")).statusCode).toBe(200);
    clock.advance(DAY);
    await send("11111111111111111");
    expect(latestZaloSwitch(ledger.db)).toBeNull();
    clock.advance(DAY);
    await send("22222222222222222");
    await send("22222222222222222");
    expect(ledger.sqlite.prepare("SELECT account_id, first_seen_at FROM zalo_accounts ORDER BY first_seen_at").all()).toEqual([
      { account_id: "11111111111111111", first_seen_at: START },
      { account_id: "22222222222222222", first_seen_at: at(2 * DAY) },
    ]);
    expect(latestZaloSwitch(ledger.db)).toBe(at(2 * DAY));
  });

  it("decision: a customer who wrote an older code is proposed with the reason code_claimed; nothing merges", () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("UPDATE customers SET created_at = '2026-09-01T03:00:00.000Z'");
    ledger.sqlite.exec("INSERT INTO customers (customer_id, customer_code, role, status, display_name, sort_key, created_at) VALUES ('N1', 'DP09991', 'USER', 'ACTIVE', 'Someone', 'someone', '2026-10-30T13:00:00.000Z')");
    const code = (ledger.sqlite.prepare("SELECT customer_code FROM customers WHERE customer_id = 'P1'").get() as { customer_code: string }).customer_code;
    const claim = (claimant: string, claimed: string) => ledger.tx((db) => recordMergeClaim(db, claimant, claimed, { clock: CLOCK, by: commandAudit(db, CLOCK, { kind: "customer", id: claimant }) }));
    expect(claim("N1", code)).toBe("recorded");
    expect(claim("N1", code)).toBe("known");
    expect(claim("N1", "DP09991")).toBe("own");
    expect(claim("N1", "DP99999")).toBe("not_found");
    expect(mergeProposals(ledger.db, null)).toEqual([{ merged: { customerId: "N1", customerCode: "DP09991", customerName: "Someone" }, survivor: expect.objectContaining({ customerId: "P1", customerCode: code }), reason: "code_claimed" }]);
    expect(ledger.sqlite.prepare("SELECT status FROM customers WHERE customer_id IN ('N1', 'P1')").all()).toEqual([{ status: "ACTIVE" }, { status: "ACTIVE" }]);
    const audit = ledger.sqlite.prepare("SELECT payload FROM audit_entries WHERE event = 'identity.merge_claim.recorded'").all() as { payload: string }[];
    expect(audit.map((a) => JSON.parse(a.payload))).toEqual([{ claimantId: "N1", claimedId: "P1" }]);
  });

  it("decision: the CLI lists the proposals since the latest account switch, with their reasons, and merges nothing", async () => {
    const ledger = payoutLedger();
    const password = generatedPassword();
    await addStaff(ledger, "owner", "ADMIN", password);
    ledger.sqlite.exec("UPDATE customers SET created_at = '2026-09-01T03:00:00.000Z'; INSERT INTO zalo_accounts (account_id, first_seen_at) VALUES ('11111111111111111', '2026-01-01T00:00:00.000Z'), ('22222222222222222', '2026-10-30T12:00:00.000Z')");
    const [known] = ledger.sqlite.prepare("SELECT customer_id, display_name, sort_key FROM customers WHERE role = 'USER' AND display_name IS NOT NULL ORDER BY customer_id LIMIT 1").all() as { customer_id: string; display_name: string; sort_key: string }[];
    ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status, display_name, sort_key, created_at) VALUES ('N1', 'DP09991', 'USER', 'ACTIVE', ?, ?, '2026-10-30T13:00:00.000Z')").run(known!.display_name, known!.sort_key);
    const token = "i".repeat(40);
    const servers = buildServers({ clock: CLOCK, internalToken: token, internal: [adminCommandRoutes({ ledger, clock: CLOCK })] });
    opened.push(servers);
    const lines: Record<string, unknown>[] = [];
    const io: CliIo = {
      async call(method, path, body, headers) {
        const res = await servers.internalApp.inject({ method, url: path, headers: { [INTERNAL_TOKEN_HEADER]: token, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
        return { status: res.statusCode, body: JSON.parse(res.body) as unknown };
      },
      secret: async () => password,
      readJson: () => ({}),
      print: (line) => void lines.push(line),
    };
    expect(await runAdminCli(["merge-proposals", "latest", "--as", "owner"], io)).toBe(0);
    expect(lines).toEqual([{ ok: true, command: "merge-proposals", since: "2026-10-30T12:00:00.000Z", proposals: [{ merged: expect.objectContaining({ customerId: "N1" }), survivor: expect.objectContaining({ customerId: known!.customer_id }), reason: "same_name" }] }]);
    lines.length = 0;
    expect(await runAdminCli(["merge-proposals", "2026-13-45T25:61:00.000Z", "--as", "owner"], io)).toBe(1);
    expect(lines[0]).toMatchObject({ ok: false, reason: "error.invalid_request" });
    expect(JSON.stringify(lines)).not.toContain(password);
    expect((ledger.sqlite.prepare("SELECT count(*) AS n FROM customer_aliases").get() as { n: number }).n).toBe(0);
  });
});
