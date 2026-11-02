/**
 * Story 7.2 (server side): customer sign-in on the public listener with the customer code and the
 * password from /matkhau (AD-18, FR-9, D21, INV-5, INV-8). The cookie carries a random 32-byte
 * token and only its SHA-256 is stored; after five failures a code waits, from that client, a
 * delay that doubles from 1 minute to 15; one client failing 20 times in 10 minutes waits too; a
 * burst across codes raises one owner alert; a mutating request needs the website's Origin; a
 * session a new password ended says so. Unknown codes are answered and throttled exactly like
 * real ones, write no audit row per attempt, and their rows are pruned and capped by the hourly
 * job. The website side is in apps/web/tests/sign-in.test.tsx.
 */
import { createHash } from "node:crypto";
import { CUSTOMER_SESSION_PATH } from "@cashback/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CUSTOMER_COOKIE_MAX_AGE_S, customerSessionRoutes, DUMMY_HASH, hashPassword, runSignInHousekeeping, setCustomerPassword, signInBurstWatch, unknownSignInTally, type UnknownSignInTally } from "../src/modules/identity/index";
import { alertsFor, auditFor, commandAudit } from "../src/modules/operations/index";
import type { Ledger } from "../src/platform/db/ledger";
import { clientAddress, clientKeyer } from "../src/platform/http/client-key";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { closeLedgers, movingClock } from "./helpers/order-ledger";
import { NOW, payoutLedger } from "./helpers/payout-ledger";

const ORIGIN = "https://hoantiendp.com";
const PASSWORD = "Kp7mWx3q";
const MINUTE = 60_000;
const KEY_SECRET = "test-client-key-secret-0123456789";
let HASH = "";

beforeAll(async () => {
  HASH = await hashPassword(PASSWORD);
});

const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  closeLedgers();
});

type Answer = { status: number; body: Record<string, unknown>; cookie: string | undefined };

interface Site {
  readonly ledger: Ledger;
  readonly clock: ReturnType<typeof movingClock>;
  readonly unknown: UnknownSignInTally;
  /** Signs in from the client at `ip` (through the tunnel), or with exactly `headers`. */
  signIn(code: string, password: string, from?: { ip?: string; headers?: Record<string, string> }): Promise<Answer>;
  whoAmI(cookie: string | undefined): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | undefined }>;
  signOut(cookie: string | undefined, headers?: Record<string, string>): Promise<{ status: number }>;
}

/** The fake customers of payout-customers.json; P1 (DP00012) and P2 (DP00031) have the password. */
function site(options: { verify?: (hash: string, password: string) => Promise<boolean> } = {}): Site {
  const ledger = payoutLedger();
  ledger.sqlite.prepare("UPDATE customers SET password_hash = ?, password_set_at = ? WHERE customer_id IN ('P1', 'P2')").run(HASH, NOW);
  const clock = movingClock(NOW);
  const unknown = unknownSignInTally();
  const routes = customerSessionRoutes({ ledger, clock, auditFor: (db) => auditFor(db, clock), alertsFor: (db) => alertsFor(db, clock), burst: signInBurstWatch(), unknown, clientKey: clientKeyer(KEY_SECRET), origins: [ORIGIN], ...(options.verify ? { verify: options.verify } : {}) });
  const servers = buildServers({ clock, internalToken: "i".repeat(40), public: [routes] });
  opened.push(servers);
  const app = servers.publicApp;
  const cookieOf = (header: string | string[] | undefined): string | undefined => (Array.isArray(header) ? header[0] : header);
  return {
    ledger,
    clock,
    unknown,
    async signIn(code, password, from = {}) {
      const headers = from.headers ?? { origin: ORIGIN, "cf-connecting-ip": from.ip ?? "203.0.113.7" };
      const res = await app.inject({ method: "POST", url: CUSTOMER_SESSION_PATH, headers, payload: { customerCode: code, password } });
      return { status: res.statusCode, body: res.json(), cookie: cookieOf(res.headers["set-cookie"]) };
    },
    async whoAmI(cookie) {
      const res = await app.inject({ method: "GET", url: CUSTOMER_SESSION_PATH, headers: cookie === undefined ? {} : { cookie } });
      return { status: res.statusCode, body: res.json(), setCookie: cookieOf(res.headers["set-cookie"]) };
    },
    async signOut(cookie, headers = { origin: ORIGIN }) {
      const res = await app.inject({ method: "DELETE", url: CUSTOMER_SESSION_PATH, headers: { ...headers, ...(cookie === undefined ? {} : { cookie }) } });
      return { status: res.statusCode };
    },
  };
}

const tokenOf = (setCookie: string | undefined): string => /^__Host-cashback_session=([^;]*)/.exec(setCookie ?? "")?.[1] ?? "";
const cookieHeader = (setCookie: string | undefined): string => `__Host-cashback_session=${tokenOf(setCookie)}`;
const sessionRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT token_hash, kind, customer_id, expires_at, ended_at FROM sessions").all() as { token_hash: string; kind: string; customer_id: string; expires_at: string | null; ended_at: string | null }[];
const throttles = (ledger: Ledger, code?: string) =>
  (code === undefined ? ledger.sqlite.prepare("SELECT customer_code AS code, client_key AS clientKey, failures, locked_until AS lockedUntil FROM customer_sign_in_throttles ORDER BY customer_code, client_key").all() : ledger.sqlite.prepare("SELECT customer_code AS code, client_key AS clientKey, failures, locked_until AS lockedUntil FROM customer_sign_in_throttles WHERE customer_code = ? ORDER BY client_key").all(code)) as { code: string; clientKey: string; failures: number; lockedUntil: string | null }[];
const auditCount = (ledger: Ledger, event: string) => (ledger.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_entries WHERE event = ?").get(event) as { n: number }).n;
const ip = (n: number): string => `198.51.${Math.floor(n / 250)}.${(n % 250) + 1}`;

describe("Story 7.2 AC1: a correct code and password set a session cookie and only the token's hash is stored", () => {
  it("answers the customer code and sets the HttpOnly, Secure, SameSite=Lax cookie that lasts until sign-out", async () => {
    const s = site();
    const res = await s.signIn("DP00012", PASSWORD);
    expect(res).toMatchObject({ status: 200, body: { customerCode: "DP00012" } });
    expect(res.cookie).toMatch(/^__Host-cashback_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=34560000$/);
    expect(CUSTOMER_COOKIE_MAX_AGE_S).toBe(400 * 86_400);
    const token = tokenOf(res.cookie);
    expect(sessionRows(s.ledger)).toEqual([{ token_hash: createHash("sha256").update(token).digest("hex"), kind: "CUSTOMER", customer_id: "P1", expires_at: null, ended_at: null }]);
    expect(JSON.stringify(s.ledger.sqlite.prepare("SELECT * FROM sessions").all())).not.toContain(token);
    expect(await s.whoAmI(cookieHeader(res.cookie))).toMatchObject({ status: 200, body: { customerCode: "DP00012" } });
  });

  it("accepts the code typed in lower case or with spaces, and records the sign-in in the audit trail under the customer", async () => {
    const s = site();
    expect((await s.signIn("  dp00012 ", PASSWORD)).status).toBe(200);
    const audit = s.ledger.sqlite.prepare("SELECT actor_kind, actor_id, payload FROM audit_entries WHERE event = 'identity.customer.signed_in'").all() as { actor_kind: string; actor_id: string; payload: string }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_kind: "customer", actor_id: "P1" });
    expect(audit[0]?.payload).not.toContain(PASSWORD);
  });

  it("refuses a wrong password, an unknown code, a customer with no password yet, staff and a disabled customer with the same 401", async () => {
    const s = site();
    s.ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status, password_hash) VALUES ('S9', 'DP00900', 'EMPLOYEE', 'ACTIVE', ?), ('D9', 'DP00901', 'USER', 'DISABLED', ?)").run(HASH, HASH);
    for (const [code, password] of [["DP00012", "wrong"], ["DP09999", PASSWORD], ["DP00044", PASSWORD], ["DP00900", PASSWORD], ["DP00901", PASSWORD]] as const) {
      expect(await s.signIn(code, password)).toEqual({ status: 401, body: { error: { code: "unauthorized", messageKey: "error.customer_sign_in_refused" } }, cookie: undefined });
    }
    expect(sessionRows(s.ledger)).toEqual([]);
  });

  it("checks the password of a code nobody holds against the dummy hash, once, like a real one", async () => {
    const checked: string[] = [];
    const s = site({ verify: async (hash) => (checked.push(hash), false) });
    await s.signIn("DP09999", PASSWORD);
    await s.signIn("DP00012", "wrong");
    expect(checked).toEqual([DUMMY_HASH, HASH]);
  });

  it("refuses a malformed code under its field without counting it", async () => {
    const s = site();
    const res = await s.signIn("12345", PASSWORD);
    expect(res).toMatchObject({ status: 400, body: { error: { code: "invalid_request", messageKey: "error.customer_code_format", fields: { customerCode: "error.customer_code_format" } } } });
    expect(throttles(s.ledger)).toEqual([]);
  });
});

describe("Story 7.2 AC2: after five wrong passwords a code waits 1 minute, doubling to 15; other codes are unaffected", () => {
  it("refuses the sixth attempt within the minute as waiting, even with the right password, then doubles each wait up to 15 minutes", async () => {
    const s = site();
    for (let i = 0; i < 6; i++) expect((await s.signIn("DP00012", "wrong")).status).toBe(401);
    s.clock.advance(30_000);
    expect(await s.signIn("DP00012", PASSWORD)).toMatchObject({ status: 429, body: { error: { code: "rate_limited", messageKey: "error.customer_sign_in_waiting", fields: { retryAt: "2026-10-30T12:01:00.000Z" } } } });
    s.clock.advance(30_000);
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = s.clock.now();
      expect((await s.signIn("DP00012", "wrong")).status).toBe(401);
      const until = throttles(s.ledger, "DP00012")[0]?.lockedUntil ?? before;
      waits.push((Date.parse(until) - Date.parse(before)) / MINUTE);
      s.clock.advance(Date.parse(until) - Date.parse(before));
    }
    expect(waits).toEqual([2, 4, 8, 15, 15]);
    expect(sessionRows(s.ledger)).toEqual([]);
  });

  it("keeps another code free while one waits", async () => {
    const s = site();
    for (let i = 0; i < 6; i++) await s.signIn("DP00012", "wrong");
    expect((await s.signIn("DP00012", PASSWORD)).status).toBe(429);
    expect((await s.signIn("DP00031", PASSWORD)).status).toBe(200);
  });

  it("makes a code nobody holds wait exactly like a real one, so the answers never tell which codes exist", async () => {
    const s = site();
    const real: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 7; i++) {
      real.push((await s.signIn("DP00012", "wrong", { ip: "203.0.113.1" })).status);
      unknown.push((await s.signIn("DP09999", "wrong", { ip: "203.0.113.2" })).status);
    }
    expect(unknown).toEqual(real);
    expect(real).toEqual([401, 401, 401, 401, 401, 401, 429]);
    expect(throttles(s.ledger).map((t) => [t.code, t.failures, t.lockedUntil])).toEqual([
      ["DP00012", 6, "2026-10-30T12:01:00.000Z"],
      ["DP09999", 6, "2026-10-30T12:01:00.000Z"],
    ]);
  });

  it("review item 9: a new password from /matkhau works at once: it deletes the customer's throttle rows from every client", async () => {
    const s = site();
    for (const from of ["203.0.113.1", "203.0.113.2"]) for (let i = 0; i < 6; i++) await s.signIn("DP00012", "wrong", { ip: from });
    expect(throttles(s.ledger, "DP00012")).toHaveLength(2);
    const fresh = await hashPassword("Nw3pass8");
    s.ledger.tx((db) => setCustomerPassword(db, "P1", fresh, { clock: s.clock, by: commandAudit(db, s.clock, { kind: "customer", id: "P1" }) }));
    expect(throttles(s.ledger, "DP00012")).toEqual([]);
    expect((await s.signIn("DP00012", "Nw3pass8", { ip: "203.0.113.1" })).status).toBe(200);
  });

  it("starts counting again from zero after a successful sign-in", async () => {
    const s = site();
    for (let i = 0; i < 4; i++) await s.signIn("DP00012", "wrong");
    expect((await s.signIn("DP00012", PASSWORD)).status).toBe(200);
    expect(throttles(s.ledger, "DP00012")).toEqual([]);
  });
});

describe("Story 7.2 review item 1: nobody can keep another person locked out", () => {
  it("review item 1: a correct password from another client is accepted while an attacker's client waits on the same code", async () => {
    const s = site();
    for (let i = 0; i < 12; i++) await s.signIn("DP00012", "wrong", { ip: "192.0.2.66" });
    expect((await s.signIn("DP00012", PASSWORD, { ip: "192.0.2.66" })).status).toBe(429);
    expect((await s.signIn("DP00012", PASSWORD, { ip: "203.0.113.9" })).status).toBe(200);
  });

  it("review item 1: one client failing 20 times in 10 minutes across codes waits 10 minutes, on any code; other clients do not", async () => {
    const s = site({ verify: async () => false });
    for (let i = 0; i < 20; i++) {
      expect((await s.signIn(`DP${10_000 + i}`, "Matkhau1", { ip: "192.0.2.77" })).status).toBe(401);
      s.clock.advance(10_000);
    }
    const waiting = await s.signIn("DP00031", PASSWORD, { ip: "192.0.2.77" });
    expect(waiting).toMatchObject({ status: 429, body: { error: { fields: { retryAt: "2026-10-30T12:13:10.000Z" } } } });
    expect((await s.signIn("DP00031", "wrong", { ip: "192.0.2.78" })).status).toBe(401);
    s.clock.advance(10 * MINUTE);
    expect((await s.signIn("DP00031", "wrong", { ip: "192.0.2.77" })).status).toBe(401);
  });

  it("review item 1: only an HMAC of the address is stored, and CF-Connecting-IP counts only on a request from the tunnel (loopback)", async () => {
    const s = site();
    await s.signIn("DP00012", "wrong", { ip: "203.0.113.50" });
    const stored = JSON.stringify([...throttles(s.ledger), ...s.ledger.sqlite.prepare("SELECT * FROM customer_sign_in_clients").all()]);
    expect(stored).not.toContain("203.0.113.50");
    expect(throttles(s.ledger)[0]?.clientKey).toBe(clientKeyer(KEY_SECRET)({ headers: { "cf-connecting-ip": "203.0.113.50" }, socket: { remoteAddress: "127.0.0.1" } } as never));
    expect(clientAddress({ headers: { "cf-connecting-ip": "203.0.113.50" }, socket: { remoteAddress: "127.0.0.1" } } as never)).toBe("203.0.113.50");
    expect(clientAddress({ headers: { "cf-connecting-ip": "203.0.113.50" }, socket: { remoteAddress: "10.0.0.8" } } as never)).toBe("10.0.0.8");
    expect(clientAddress({ headers: { "cf-connecting-ip": "not an address; drop table" }, socket: { remoteAddress: "127.0.0.1" } } as never)).toBe("127.0.0.1");
  });
});

describe("Story 7.2 review item 2: made-up codes cannot grow the ledger without limit", () => {
  it("review item 2: a failure on a code nobody holds writes no audit row; the hourly job writes one entry with the count", async () => {
    const s = site({ verify: async () => false });
    for (let i = 0; i < 15; i++) await s.signIn(`DP${20_000 + i}`, "Matkhau1", { ip: ip(i) });
    await s.signIn("DP00012", "wrong");
    expect(auditCount(s.ledger, "identity.customer.sign_in_failed")).toBe(1);
    expect(runSignInHousekeeping({ ledger: s.ledger, clock: s.clock, unknown: s.unknown, auditFor: (db) => auditFor(db, s.clock) })).toMatchObject({ unknownFailures: 15 });
    const tally = s.ledger.sqlite.prepare("SELECT entity_id, payload FROM audit_entries WHERE event = 'identity.customer.unknown_sign_ins'").all();
    expect(tally).toEqual([{ entity_id: "unknown", payload: JSON.stringify({ failures: 15 }) }]);
    expect(runSignInHousekeeping({ ledger: s.ledger, clock: s.clock, unknown: s.unknown, auditFor: (db) => auditFor(db, s.clock) }).unknownFailures).toBe(0);
    expect(auditCount(s.ledger, "identity.customer.unknown_sign_ins")).toBe(1);
  });

  it("review item 2: the job removes throttle rows quiet for 24 hours whose wait has ended, and caps the table at its newest rows", async () => {
    const s = site({ verify: async () => false });
    for (let i = 0; i < 6; i++) await s.signIn(`DP${30_000 + i}`, "Matkhau1", { ip: ip(i) });
    s.clock.advance(23 * 60 * MINUTE);
    for (let i = 0; i < 4; i++) await s.signIn(`DP${31_000 + i}`, "Matkhau1", { ip: ip(100 + i) });
    const deps = { ledger: s.ledger, clock: s.clock, unknown: s.unknown, auditFor: (db: Parameters<typeof auditFor>[0]) => auditFor(db, s.clock) };
    expect(runSignInHousekeeping(deps)).toMatchObject({ pruned: 0, capped: 0 });
    s.clock.advance(2 * 60 * MINUTE);
    expect(runSignInHousekeeping(deps)).toMatchObject({ pruned: 12, capped: 0 });
    expect(throttles(s.ledger).map((t) => t.code)).toEqual(["DP31000", "DP31001", "DP31002", "DP31003"]);
    expect(runSignInHousekeeping({ ...deps, maxRows: 2 }).capped).toBe(2);
    expect(throttles(s.ledger)).toHaveLength(2);
  });
});

describe("Story 7.2 AC3: a burst of failed sign-ins across many codes raises one owner alert", () => {
  const alerts = (ledger: Ledger) => ledger.sqlite.prepare("SELECT kind, severity, suppressed FROM alerts").all();
  const spray = async (s: Site, count: number, from = 0): Promise<void> => {
    for (let i = from; i < from + count; i++) {
      await s.signIn(`DP${10_000 + i}`, "Matkhau1", { ip: ip(i) });
      s.clock.advance(5_000);
    }
  };

  it("raises nothing at 49 failures and one high alert at the 50th within 10 minutes; more failures add none", async () => {
    const s = site({ verify: async () => false });
    await spray(s, 49);
    expect(alerts(s.ledger)).toEqual([]);
    await spray(s, 1, 49);
    expect(alerts(s.ledger)).toEqual([{ kind: "customer_sign_in_burst", severity: "high", suppressed: 0 }]);
    await spray(s, 30, 50);
    expect(alerts(s.ledger)).toHaveLength(1);
  });

  it("raises nothing when the same 50 failures are spread over more than 10 minutes", async () => {
    const s = site({ verify: async () => false });
    for (let i = 0; i < 50; i++) {
      await s.signIn(`DP${20_000 + i}`, "Matkhau1", { ip: ip(i) });
      s.clock.advance(13_000);
    }
    expect(alerts(s.ledger)).toEqual([]);
  });

  it("re-arms once the pace drops, so a later burst is heard again", () => {
    const watch = signInBurstWatch({ failures: 3, windowMs: 1000 });
    expect([0, 10, 20, 30].map((t) => watch.failed(t))).toEqual([false, false, true, false]);
    expect([5000, 5010, 5020].map((t) => watch.failed(t))).toEqual([false, false, true]);
  });
});

describe("Story 7.2 AC4: a POST or DELETE without the website's Origin is refused", () => {
  it("refuses a sign-in with no Origin or another site's Origin before checking anything, asking to reload the page", async () => {
    const checked: string[] = [];
    const s = site({ verify: async (hash) => (checked.push(hash), true) });
    for (const headers of [{}, { origin: "https://evil.example" }, { origin: "null" }, { origin: "http://hoantiendp.com" }] as Record<string, string>[]) {
      expect(await s.signIn("DP00012", PASSWORD, { headers })).toEqual({ status: 403, body: { error: { code: "forbidden", messageKey: "error.reload_page" } }, cookie: undefined });
    }
    expect(checked).toEqual([]);
    expect(throttles(s.ledger)).toEqual([]);
    expect(sessionRows(s.ledger)).toEqual([]);
  });

  it("refuses a sign-out from another site and keeps the session open", async () => {
    const s = site();
    const cookie = cookieHeader((await s.signIn("DP00012", PASSWORD)).cookie);
    expect((await s.signOut(cookie, { origin: "https://evil.example" })).status).toBe(403);
    expect((await s.whoAmI(cookie)).status).toBe(200);
    expect((await s.signOut(cookie)).status).toBe(200);
    expect((await s.whoAmI(cookie)).body).toEqual({ error: { code: "unauthorized", messageKey: "error.unauthorized" } });
  });
});

describe("Story 7.2 AC5: a session ended by a new password says so on the next signed-in request", () => {
  it("answers 401 with the new-password message once and clears the cookie", async () => {
    const s = site();
    const cookie = cookieHeader((await s.signIn("DP00012", PASSWORD)).cookie);
    const fresh = await hashPassword("Nw3pass8");
    s.ledger.tx((db) => setCustomerPassword(db, "P1", fresh, { clock: s.clock, by: commandAudit(db, s.clock, { kind: "customer", id: "P1" }) }));
    const answer = await s.whoAmI(cookie);
    expect(answer).toMatchObject({ status: 401, body: { error: { code: "unauthorized", messageKey: "error.session_ended_new_password" } } });
    expect(answer.setCookie).toBe("__Host-cashback_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  });

  it("answers a signed-out or unknown cookie with the plain 401, and no cookie with no Set-Cookie", async () => {
    const s = site();
    expect(await s.whoAmI(undefined)).toMatchObject({ status: 401, body: { error: { messageKey: "error.unauthorized" } }, setCookie: undefined });
    expect((await s.whoAmI(`__Host-cashback_session=${"x".repeat(43)}`)).body).toEqual({ error: { code: "unauthorized", messageKey: "error.unauthorized" } });
  });

  it("never caches a session answer", async () => {
    const s = site();
    const res = await s.signIn("DP00012", PASSWORD);
    const who = await opened[0]?.publicApp.inject({ method: "GET", url: CUSTOMER_SESSION_PATH, headers: { cookie: cookieHeader(res.cookie) } });
    expect(who?.headers["cache-control"]).toBe("no-store");
  });
});
