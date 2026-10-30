/**
 * Story 4.2: staff sign in on the admin host behind Cloudflare Access. Staff routes exist only for
 * the admin host, need a valid Access JWT and a staff session (never a customer one), admin-only
 * actions need the admin role on the server, and only the SHA-256 of the session token is stored.
 */
import { createHash } from "node:crypto";
import { errorEnvelopeSchema, staffSessionResponseSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { openSession, STAFF_SESSION_MS } from "../src/modules/identity/index";
import type { Ledger } from "../src/platform/db/ledger";
import { ACCESS_JWT_HEADER } from "../src/platform/http/access-jwt.guard";
import { close, type Servers } from "../src/platform/http/servers";
import { CUSTOMER_SESSION_COOKIE, STAFF_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import type { StaffRoutes } from "../src/platform/http/staff-routes";
import { HOUR, closeLedgers, freshLedger, movingClock } from "./helpers/order-ledger";
import { ACCESS, ACCESS_SUBJECT, accessJwt, addStaff, ADMIN_HOST, deskServers, generatedPassword, ORIGIN, PUBLIC_HOST, setCookieValue, STRANGER_KEY } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

/** Stand-ins for routes later stories add (Stories 4.10, 6.x), on the real gate and policy; GET /api/admin/payouts is the real list (Story 4.6). */
const LATER_ROUTES: StaffRoutes = (add) => {
  add({ method: "POST", url: "/api/admin/payouts/:payoutId/void", adminOnly: true, handler: async () => ({ voided: true }) });
  add({ method: "POST", url: "/api/admin/customers/:customerId/force-erase", adminOnly: true, handler: async () => ({ erased: true }) });
};

interface Desk {
  ledger: Ledger;
  clock: Clock & { advance(ms: number): void };
  app: Servers["publicApp"];
  passwords: Record<string, string>;
}

async function desk(): Promise<Desk> {
  const ledger = freshLedger();
  const clock = movingClock("2026-10-30T02:00:00.000Z");
  const passwords = { root: generatedPassword(), lan: generatedPassword(), off: generatedPassword() };
  await addStaff(ledger, "root", "ADMIN", passwords.root, { root: true });
  await addStaff(ledger, "lan", "EMPLOYEE", passwords.lan);
  await addStaff(ledger, "off", "EMPLOYEE", passwords.off, { status: "DISABLED" });
  servers = deskServers(ledger, clock, [LATER_ROUTES]);
  return { ledger, clock, app: servers.publicApp, passwords };
}

type Method = "GET" | "POST" | "DELETE";

function call(d: Desk, method: Method, url: string, options: { host?: string; jwt?: string | null; cookie?: string; body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { host: options.host ?? ADMIN_HOST };
  const jwt = options.jwt === undefined ? accessJwt(d.clock) : options.jwt;
  if (jwt !== null) headers[ACCESS_JWT_HEADER] = jwt;
  if (options.cookie) headers["cookie"] = options.cookie;
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null && method !== "GET") headers["origin"] = origin;
  return d.app.inject({ method, url, headers, ...(options.body === undefined ? {} : { payload: options.body as object }) });
}

async function signIn(d: Desk, username: string, password = d.passwords[username] ?? "", jwt?: string) {
  return call(d, "POST", "/api/admin/session", { body: { username, password }, ...(jwt === undefined ? {} : { jwt }) });
}

const failedAudits = (d: Desk) => d.ledger.sqlite.prepare("SELECT actor_kind, actor_id, actor_role, entity_id, payload FROM audit_entries WHERE event = 'identity.staff.sign_in_failed' ORDER BY id").all() as Record<string, unknown>[];

async function staffCookie(d: Desk, username: string): Promise<string> {
  const res = await signIn(d, username);
  expect(res.statusCode).toBe(200);
  const token = setCookieValue(res.headers["set-cookie"], STAFF_SESSION_COOKIE);
  if (token === null) throw new Error("no staff cookie");
  return `${STAFF_SESSION_COOKIE}=${token}`;
}

const codeOf = (body: string) => errorEnvelopeSchema.parse(JSON.parse(body)).error.code;

describe("Story 4.2 acceptance criteria", () => {
  it("AC1: a request to hoantiendp.com/api/admin/payouts returns 404, because staff routes exist only for the admin host", async () => {
    const d = await desk();
    const cookie = await staffCookie(d, "root");
    const onPublic = await call(d, "GET", "/api/admin/payouts", { host: PUBLIC_HOST, cookie });
    expect(onPublic.statusCode).toBe(404);
    expect(codeOf(onPublic.body)).toBe("not_found");
    for (const [method, url] of [["POST", "/api/admin/session"], ["GET", "/api/admin/session"], ["POST", "/api/admin/payouts/P1/void"]] as const) {
      expect((await call(d, method, url, { host: PUBLIC_HOST, cookie, body: {} })).statusCode, url).toBe(404);
    }
    expect((await call(d, "GET", "/api/admin/payouts", { host: `${ADMIN_HOST}.evil.test`, cookie })).statusCode).toBe(404);
    expect((await call(d, "GET", "/api/admin/payouts", { cookie })).statusCode).toBe(200);
  });

  it("AC1: without the staff access config no staff route exists on any host", async () => {
    const { buildServers } = await import("../src/platform/http/servers");
    servers = buildServers({ clock: movingClock("2026-10-30T02:00:00.000Z"), internalToken: "t".repeat(40) });
    expect((await servers.publicApp.inject({ method: "GET", url: "/api/admin/session", headers: { host: ADMIN_HOST } })).statusCode).toBe(404);
  });

  it("AC2: on the admin host, a staff route without a valid Access JWT (wrong audience, expired or missing) returns 401 even with a valid staff session", async () => {
    const d = await desk();
    const cookie = await staffCookie(d, "root");
    const invalid: Record<string, string | null> = {
      missing: null,
      wrongAudience: accessJwt(d.clock, { aud: ["another-application-audience"] }),
      expired: accessJwt(d.clock, { expiresIn: -1 }),
      wrongIssuer: accessJwt(d.clock, { iss: "https://other-team.cloudflareaccess.com" }),
      foreignKey: accessJwt(d.clock, { key: STRANGER_KEY }),
      unknownKeyId: accessJwt(d.clock, { kid: "rotated-away" }),
      algNone: `${Buffer.from(JSON.stringify({ alg: "none", kid: "team-key-1" })).toString("base64url")}.${accessJwt(d.clock).split(".")[1]}.`,
      tamperedClaims: (() => {
        const [h, , s] = accessJwt(d.clock).split(".");
        const forged = accessJwt(d.clock, { expiresIn: 999_999 }).split(".")[1];
        return `${h}.${forged}.${s}`;
      })(),
      garbage: "not-a-jwt",
    };
    for (const [name, jwt] of Object.entries(invalid)) {
      const res = await call(d, "GET", "/api/admin/payouts", { jwt, cookie });
      expect(res.statusCode, name).toBe(401);
      expect(codeOf(res.body), name).toBe("unauthorized");
    }
    expect((await call(d, "GET", "/api/admin/payouts", { cookie })).statusCode).toBe(200);
    expect((await call(d, "POST", "/api/admin/session", { jwt: null, body: { username: "root", password: d.passwords.root } })).statusCode).toBe(401);
  });

  it("AC2: an Access JWT that was valid at sign-in stops working when it expires", async () => {
    const d = await desk();
    const cookie = await staffCookie(d, "root");
    const jwt = accessJwt(d.clock, { expiresIn: 60 });
    expect((await call(d, "GET", "/api/admin/payouts", { jwt, cookie })).statusCode).toBe(200);
    d.clock.advance(61_000);
    expect((await call(d, "GET", "/api/admin/payouts", { jwt, cookie })).statusCode).toBe(401);
  });

  it("AC3: with a valid Access JWT and a customer session cookie, a staff route returns 401", async () => {
    const d = await desk();
    const customer = d.ledger.tx((db) => openSession(db, { kind: "CUSTOMER", customerId: "C1" }, d.clock, null));
    expect((await call(d, "GET", "/api/admin/payouts", { cookie: `${CUSTOMER_SESSION_COOKIE}=${customer.token}` })).statusCode).toBe(401);
    // The customer's token in the staff cookie's name is still a customer session.
    expect((await call(d, "GET", "/api/admin/payouts", { cookie: `${STAFF_SESSION_COOKIE}=${customer.token}` })).statusCode).toBe(401);
    expect((await call(d, "GET", "/api/admin/session")).statusCode).toBe(401);
  });

  it("AC3: staff and customer cookies are separate, each HttpOnly, Secure and SameSite=Lax", async () => {
    const d = await desk();
    expect(STAFF_SESSION_COOKIE).not.toBe(CUSTOMER_SESSION_COOKIE);
    const res = await signIn(d, "lan");
    const header = String(res.headers["set-cookie"]);
    expect(header.startsWith(`${STAFF_SESSION_COOKIE}=`)).toBe(true);
    expect(STAFF_SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", `Max-Age=${STAFF_SESSION_MS / 1000}`]) expect(header).toContain(attribute);
    expect(header).not.toMatch(/Domain=/i);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("AC4: with an employee session, an admin-only action (payout void, forced erase) returns 403, checked on the server", async () => {
    const d = await desk();
    const employee = await staffCookie(d, "lan");
    const admin = await staffCookie(d, "root");
    for (const url of ["/api/admin/payouts/P1/void", "/api/admin/customers/C1/force-erase"]) {
      const refused = await call(d, "POST", url, { cookie: employee, body: {} });
      expect(refused.statusCode, url).toBe(403);
      expect(codeOf(refused.body)).toBe("forbidden");
      expect((await call(d, "POST", url, { cookie: admin, body: {} })).statusCode, url).toBe(200);
    }
    expect((await call(d, "GET", "/api/admin/payouts", { cookie: employee })).statusCode).toBe(200);
  });

  it("AC4: an admin-only path registered without the admin flag is refused at startup", async () => {
    const d = await desk();
    const open: StaffRoutes = (add) => add({ method: "POST", url: "/api/admin/payouts/:payoutId/void", handler: async () => ({}) });
    expect(() => deskServers(d.ledger, d.clock, [open])).toThrow(/admin-only/);
  });

  it("AC4: the role comes from the staff row on every request, so a demoted admin loses admin actions at once", async () => {
    const d = await desk();
    const password = generatedPassword();
    await addStaff(d.ledger, "minh", "ADMIN", password);
    const minh = await staffCookie({ ...d, passwords: { ...d.passwords, minh: password } }, "minh");
    expect((await call(d, "POST", "/api/admin/payouts/P1/void", { cookie: minh, body: {} })).statusCode).toBe(200);
    d.ledger.sqlite.prepare("UPDATE staff SET role = 'EMPLOYEE' WHERE staff_id = 'minh'").run();
    expect((await call(d, "POST", "/api/admin/payouts/P1/void", { cookie: minh, body: {} })).statusCode).toBe(403);
    d.ledger.sqlite.prepare("UPDATE staff SET status = 'DISABLED' WHERE staff_id = 'minh'").run();
    expect((await call(d, "GET", "/api/admin/payouts", { cookie: minh })).statusCode).toBe(401);
  });

  it("AC5: after a successful sign-in only the SHA-256 hash of the 32-byte token is in the database, and the sign-in is in the audit trail", async () => {
    const d = await desk();
    const res = await signIn(d, "lan");
    expect(res.statusCode).toBe(200);
    expect(staffSessionResponseSchema.parse(res.json())).toEqual({ staffId: "lan", username: "lan", role: "EMPLOYEE", expiresAt: "2026-10-30T14:00:00.000Z" });
    const token = setCookieValue(res.headers["set-cookie"], STAFF_SESSION_COOKIE) ?? "";
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(res.body).not.toContain(token);
    const stored = d.ledger.sqlite.prepare("SELECT * FROM sessions").all() as Record<string, unknown>[];
    expect(stored).toEqual([{ token_hash: createHash("sha256").update(token).digest("hex"), kind: "STAFF", customer_id: null, staff_id: "lan", created_at: d.clock.now(), expires_at: "2026-10-30T14:00:00.000Z", ended_at: null, end_reason: null }]);
    const dump = JSON.stringify(d.ledger.sqlite.prepare("SELECT * FROM audit_entries").all()) + JSON.stringify(stored);
    expect(dump).not.toContain(token);
    expect(d.ledger.sqlite.prepare("SELECT actor_kind, actor_id, event, entity_id FROM audit_entries WHERE event LIKE 'identity.staff.%'").all()).toEqual([{ actor_kind: "staff", actor_id: "lan", event: "identity.staff.signed_in", entity_id: "lan" }]);
    expect((await call(d, "GET", "/api/admin/session", { cookie: `${STAFF_SESSION_COOKIE}=${token}` })).json()).toEqual({ staffId: "lan", username: "lan", role: "EMPLOYEE" });
  });
});

describe("staff sign-in rules (AD-18, D48)", () => {
  it("a wrong password, an unknown name and a disabled account get the same 401; no session is opened", async () => {
    const d = await desk();
    const answers = [await signIn(d, "lan", "wrong-" + generatedPassword()), await signIn(d, "nobody", generatedPassword()), await signIn(d, "off")];
    for (const res of answers) expect([res.statusCode, res.json()]).toEqual([401, { error: { code: "unauthorized", messageKey: "error.staff_sign_in_refused" } }]);
    expect(answers.every((res) => res.headers["set-cookie"] === undefined)).toBe(true);
    expect(failedAudits(d).map((a) => a.entity_id)).toEqual(["lan", "unknown", "off"]);
    expect(d.ledger.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("from the sixth failure the name waits a doubling delay, and a correct password inside it is not accepted", async () => {
    const d = await desk();
    for (let i = 0; i < 6; i++) expect((await signIn(d, "lan", `wrong-${i}`)).statusCode).toBe(401);
    const waiting = await signIn(d, "lan");
    expect(waiting.statusCode).toBe(429);
    expect(waiting.json().error).toEqual({ code: "rate_limited", messageKey: "error.staff_sign_in_waiting", fields: { retryAt: "2026-10-30T02:01:00.000Z" } });
    d.clock.advance(60_001);
    expect((await signIn(d, "lan")).statusCode).toBe(200);
    expect(d.ledger.sqlite.prepare("SELECT COUNT(*) AS n FROM staff_sign_in_throttles").get()).toEqual({ n: 0 });
  });

  it("a staff session ends after 12 hours and at sign-out", async () => {
    const d = await desk();
    const cookie = await staffCookie(d, "lan");
    d.clock.advance(12 * HOUR - 1);
    expect((await call(d, "GET", "/api/admin/session", { cookie })).statusCode).toBe(200);
    d.clock.advance(1);
    expect((await call(d, "GET", "/api/admin/session", { cookie })).statusCode).toBe(401);
    const again = await staffCookie(d, "lan");
    const out = await call(d, "DELETE", "/api/admin/session", { cookie: again });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers["set-cookie"])).toContain("Max-Age=0");
    expect((await call(d, "GET", "/api/admin/session", { cookie: again })).statusCode).toBe(401);
    expect(d.ledger.sqlite.prepare("SELECT end_reason FROM sessions WHERE ended_at IS NOT NULL").all()).toEqual([{ end_reason: "SIGNED_OUT" }]);
  });

  it("a staff request that changes something needs the admin host's own Origin", async () => {
    const d = await desk();
    const admin = await staffCookie(d, "root");
    expect((await call(d, "POST", "/api/admin/payouts/P1/void", { cookie: admin, body: {}, origin: null })).statusCode).toBe(403);
    expect((await call(d, "POST", "/api/admin/payouts/P1/void", { cookie: admin, body: {}, origin: `https://${PUBLIC_HOST}` })).statusCode).toBe(403);
    expect((await call(d, "POST", "/api/admin/session", { body: { username: "root", password: d.passwords.root }, origin: "https://evil.test" })).statusCode).toBe(403);
  });

  it("the root admin is never demoted, disabled or deleted, and there is only one", async () => {
    const d = await desk();
    for (const sql of ["UPDATE staff SET role = 'EMPLOYEE' WHERE staff_id = 'root'", "UPDATE staff SET status = 'DISABLED' WHERE staff_id = 'root'", "UPDATE staff SET is_root = 0 WHERE staff_id = 'root'", "DELETE FROM staff WHERE staff_id = 'root'"]) {
      expect(() => d.ledger.sqlite.prepare(sql).run(), sql).toThrow();
    }
    expect(() => d.ledger.sqlite.prepare("UPDATE staff SET is_root = 1 WHERE staff_id = 'lan'").run()).toThrow();
  });

  it("a session row has one owner of its kind and keeps it", async () => {
    const d = await desk();
    const insert = (kind: string, customer: string | null, staffId: string | null) => () => d.ledger.sqlite.prepare("INSERT INTO sessions (token_hash, kind, customer_id, staff_id, created_at) VALUES (?, ?, ?, ?, ?)").run("a".repeat(64), kind, customer, staffId, d.clock.now());
    expect(insert("STAFF", "C1", null)).toThrow();
    expect(insert("CUSTOMER", null, "lan")).toThrow();
    expect(insert("STAFF", "C1", "lan")).toThrow();
    insert("CUSTOMER", "C1", null)();
    expect(() => d.ledger.sqlite.prepare("UPDATE sessions SET kind = 'STAFF', customer_id = NULL, staff_id = 'lan'").run()).toThrow();
  });

  it("the Access audience and team come from config: all three settings or none", async () => {
    const { parseConfig } = await import("../src/platform/config/env.config");
    const token = "s".repeat(40);
    expect(parseConfig("dev", { INTERNAL_TOKEN: token }).staffAccess).toBeNull();
    expect(parseConfig("prod", { INTERNAL_TOKEN: token, ADMIN_HOST, ACCESS_TEAM_DOMAIN: ACCESS.accessTeamDomain, ACCESS_AUDIENCE: ACCESS.accessAudience }).staffAccess).toEqual(ACCESS);
    expect(() => parseConfig("prod", { INTERNAL_TOKEN: token, ADMIN_HOST })).toThrow("config: missing or invalid ACCESS_TEAM_DOMAIN, ACCESS_AUDIENCE");
    expect(() => parseConfig("prod", { INTERNAL_TOKEN: token, ADMIN_HOST: "https://admin.hoantiendp.com", ACCESS_TEAM_DOMAIN: ACCESS.accessTeamDomain, ACCESS_AUDIENCE: ACCESS.accessAudience })).toThrow(/ADMIN_HOST/);
    expect(() => parseConfig("prod", { INTERNAL_TOKEN: token, ADMIN_HOST, ACCESS_TEAM_DOMAIN: "example.com", ACCESS_AUDIENCE: ACCESS.accessAudience })).toThrow(/ACCESS_TEAM_DOMAIN/);
  });
});

describe("Sprint 12 code review fixes", () => {
  it("review item 1: an unknown or disabled name is throttled and answered exactly like a real one, so names cannot be enumerated", async () => {
    const d = await desk();
    const answersFor = async (username: string) => {
      const out: { status: number; body: unknown }[] = [];
      for (let i = 0; i < 7; i++) {
        const res = await signIn(d, username, `wrong-${i}`);
        out.push({ status: res.statusCode, body: res.json() });
      }
      return out;
    };
    const real = await answersFor("lan");
    expect(real.map((a) => a.status)).toEqual([401, 401, 401, 401, 401, 401, 429]);
    expect(await answersFor("nobody")).toEqual(real);
    expect(await answersFor("off")).toEqual(real);
  });

  it("review item 1: an unknown or disabled name still runs the password check once, on the dummy hash, like a real name", async () => {
    const d = await desk();
    const { auditFor } = await import("../src/modules/operations/index");
    const { DUMMY_HASH, signInStaff, verifyPassword } = await import("../src/modules/identity/index");
    const checked: string[] = [];
    const verify = async (hash: string, password: string) => {
      checked.push(hash);
      return verifyPassword(hash, password);
    };
    const attempt = (username: string) => signInStaff(d.ledger, { username, password: "wrong-password", accessSubject: ACCESS_SUBJECT }, { clock: d.clock, auditFor: (db) => auditFor(db, d.clock), verify });
    const realHash = (d.ledger.sqlite.prepare("SELECT password_hash FROM staff WHERE staff_id = 'lan'").get() as { password_hash: string }).password_hash;
    for (const [username, expected] of [["lan", realHash], ["nobody", DUMMY_HASH], ["off", DUMMY_HASH]] as const) {
      checked.length = 0;
      expect(await attempt(username), username).toEqual({ outcome: "refused", reason: "bad_credentials" });
      expect(checked, username).toEqual([expected]);
    }
    expect(DUMMY_HASH).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("review item 2: failures by one Access identity never delay another identity's sign-in to the same account", async () => {
    const d = await desk();
    const attacker = () => accessJwt(d.clock, { sub: "attacker-identity" });
    // Attempts made while waiting are refused uncounted, so six failures stand.
    for (let i = 0; i < 10; i++) await signIn(d, "lan", `wrong-${i}`, attacker());
    expect((await signIn(d, "lan", d.passwords.lan, attacker())).statusCode).toBe(429);
    expect((await signIn(d, "lan")).statusCode).toBe(200);
    expect(d.ledger.sqlite.prepare("SELECT username, access_subject, failures FROM staff_sign_in_throttles").all()).toEqual([{ username: "lan", access_subject: "attacker-identity", failures: 6 }]);
  });

  it("review items 3 and 4: a failed key fetch is retried at most once a minute, held keys keep verifying with a warning, up to 24 hours", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { cloudflareAccessKeys, KEYS_STALE_LIMIT_MS } = await import("../src/platform/http/access-jwt.guard");
    const clock = movingClock("2026-10-30T02:00:00.000Z");
    const jwk = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
    let up = true;
    let calls = 0;
    const warnings: string[] = [];
    const fetchFn = async () => {
      calls++;
      return { ok: up, json: async () => ({ keys: [{ ...jwk, kid: "k1" }] }) };
    };
    const keys = cloudflareAccessKeys(ACCESS.accessTeamDomain, clock, { fetch: fetchFn, onStale: (info) => warnings.push(info.code) });
    expect(await keys.keyFor("k1")).not.toBeNull();
    up = false;
    clock.advance(HOUR + 1);
    expect(await keys.keyFor("k1")).not.toBeNull();
    for (let i = 0; i < 5; i++) expect(await keys.keyFor("k1")).not.toBeNull();
    expect(calls).toBe(2);
    expect(warnings).toEqual(["access_keys_unavailable"]);
    clock.advance(61_000);
    await keys.keyFor("k1");
    expect(calls).toBe(3);
    clock.advance(KEYS_STALE_LIMIT_MS);
    await expect(keys.keyFor("k1")).rejects.toMatchObject({ code: "access_keys_unavailable" });
  });

  it("review item 3: a first key fetch that fails is not retried on every request", async () => {
    const { cloudflareAccessKeys } = await import("../src/platform/http/access-jwt.guard");
    const clock = movingClock("2026-10-30T02:00:00.000Z");
    let calls = 0;
    const keys = cloudflareAccessKeys(ACCESS.accessTeamDomain, clock, {
      fetch: async () => {
        calls++;
        throw new Error("network down");
      },
    });
    for (let i = 0; i < 5; i++) await expect(keys.keyFor("k1")).rejects.toMatchObject({ code: "access_keys_unavailable" });
    expect(calls).toBe(1);
  });

  it("review item 4: a published key that cannot be read is skipped and the others still verify", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { cloudflareAccessKeys } = await import("../src/platform/http/access-jwt.guard");
    const clock = movingClock("2026-10-30T02:00:00.000Z");
    const good = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
    const keys = cloudflareAccessKeys(ACCESS.accessTeamDomain, clock, { fetch: async () => ({ ok: true, json: async () => ({ keys: [{ kty: "RSA", kid: "broken" }, null, { ...good, kid: "k2" }] }) }) });
    expect(await keys.keyFor("k2")).not.toBeNull();
    expect(await keys.keyFor("broken")).toBeNull();
  });

  it("review item 5: a failed sign-in is audited under the sign-in system actor, with the target staff id and the Access identity as ids", async () => {
    const d = await desk();
    await signIn(d, "lan", "wrong-password");
    await signIn(d, "nobody", "wrong-password");
    expect(failedAudits(d)).toEqual([
      { actor_kind: "system", actor_id: "staff-sign-in", actor_role: null, entity_id: "lan", payload: JSON.stringify({ staffId: "lan", accessSubjectId: ACCESS_SUBJECT, failures: 1, waiting: false }) },
      { actor_kind: "system", actor_id: "staff-sign-in", actor_role: null, entity_id: "unknown", payload: JSON.stringify({ staffId: null, accessSubjectId: ACCESS_SUBJECT, failures: 1, waiting: false }) },
    ]);
    expect(JSON.stringify(failedAudits(d))).not.toContain("example.test");
  });

  it("review item 6: sign-out clears the cookie even with an expired or missing session, still behind Access and the Origin", async () => {
    const d = await desk();
    const cookie = await staffCookie(d, "lan");
    d.clock.advance(STAFF_SESSION_MS + 1);
    for (const sent of [cookie, undefined]) {
      const out = await call(d, "DELETE", "/api/admin/session", sent === undefined ? {} : { cookie: sent });
      expect(out.statusCode).toBe(200);
      expect(String(out.headers["set-cookie"])).toContain(`${STAFF_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    }
    expect((await call(d, "DELETE", "/api/admin/session", { cookie, jwt: null })).statusCode).toBe(401);
    expect((await call(d, "DELETE", "/api/admin/session", { cookie, origin: null })).statusCode).toBe(403);
  });

  it("review item 7: the first five failures cost nothing and the sixth starts a one-minute wait, doubling to 15 minutes", async () => {
    const { signInDelayMs } = await import("../src/modules/identity/index");
    expect([0, 1, 5, 6, 7, 8, 9, 10, 50].map(signInDelayMs)).toEqual([0, 0, 0, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000]);
    const d = await desk();
    for (let i = 0; i < 5; i++) await signIn(d, "lan", `wrong-${i}`);
    expect((await signIn(d, "lan")).statusCode).toBe(200);
  });

  it("review item 8: staff roles have one definition, in packages/core, and the tables and contracts follow it", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { STAFF_ROLES } = await import("@cashback/core");
    const { staffSessionResponseSchema } = await import("@cashback/contracts");
    const root = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));
    const copies = [...files(join(root, "server", "src")), ...files(join(root, "..", "packages", "contracts", "src"))].filter((f) => /\[\s*"ADMIN",\s*"EMPLOYEE"\s*\]/.test(readFileSync(f, "utf8")));
    expect(copies).toEqual([]);
    expect(staffSessionResponseSchema.shape.role.options).toEqual([...STAFF_ROLES]);
    const d = await desk();
    const insert = (role: string) => () => d.ledger.sqlite.prepare("INSERT INTO staff (staff_id, username, role, status, password_hash, password_set_at, created_at) VALUES (?, ?, ?, 'ACTIVE', '$argon2id$x', 'x', 'x')").run(`s-${role.toLowerCase()}`, `s-${role.toLowerCase()}`, role);
    for (const role of STAFF_ROLES) expect(insert(role)).not.toThrow();
    expect(insert("OWNER")).toThrow();
  });

  it("review item 9: an audit entry stores the actor's staff role, and audit_entries stays insert-only", async () => {
    const d = await desk();
    await signIn(d, "lan");
    await signIn(d, "root");
    expect(d.ledger.sqlite.prepare("SELECT actor_id, actor_role FROM audit_entries WHERE event = 'identity.staff.signed_in' ORDER BY id").all()).toEqual([
      { actor_id: "lan", actor_role: "EMPLOYEE" },
      { actor_id: "root", actor_role: "ADMIN" },
    ]);
    expect(() => d.ledger.sqlite.prepare("UPDATE audit_entries SET actor_role = 'ADMIN' WHERE actor_id = 'lan'").run()).toThrow(/insert_only/);
    expect(() => d.ledger.sqlite.prepare("DELETE FROM audit_entries").run()).toThrow(/insert_only/);
    const insert = (kind: string, role: string | null) => () => d.ledger.sqlite.prepare("INSERT INTO audit_entries (recorded_at, actor_kind, actor_id, event, entity_id, actor_role) VALUES ('x', ?, 'a', 'a.b.c', 'e', ?)").run(kind, role);
    expect(insert("system", "ADMIN")).toThrow();
    expect(insert("staff", "OWNER")).toThrow();
    expect(insert("system", null)).not.toThrow();
  });
});
