/**
 * Story 6.8 (server side): `/matkhau` issues a new 8-character password through the chat command
 * route, stores only its argon2id hash and ends every open session of the customer (AD-18, D21,
 * INV-8). Refused in the group; the password never reaches a log. The assistant side is in
 * apps/assistant/tests/password-chat.test.ts.
 */
import { ASSISTANT_COMMAND_PATH, ISSUED_PASSWORD_PATTERN } from "@cashback/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { assistantCommandRoutes } from "../src/links/assistant-command.routes";
import { customerSessionOf, newCustomerPassword, openSession, verifyPassword } from "../src/modules/identity/index";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { createLogger } from "../src/platform/log/logger";
import { closeLedgers } from "./helpers/order-ledger";
import { CLOCK, payoutLedger } from "./helpers/payout-ledger";

const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);
const PASSWORD = "Kp7mWx3q";

const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  closeLedgers();
});

function app(ledger: Ledger, lines: string[] = [], newPassword: () => string = () => PASSWORD) {
  const logger = createLogger({ level: "debug", destination: { write: (line: string) => void lines.push(line) } });
  const servers = buildServers({ clock: CLOCK, internalToken: INTERNAL, assistantToken: ASSISTANT, logger, internal: [assistantCommandRoutes({ ledger, clock: CLOCK, newPassword })], public: [] });
  opened.push(servers);
  return async (chat: "private" | "group", zaloUserId = "P1") => {
    const res = await servers.internalApp.inject({ method: "POST", url: ASSISTANT_COMMAND_PATH, headers: { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }, payload: { zaloUserId, displayName: "Lan", chat, command: "password" } });
    return { status: res.statusCode, body: res.json() as Record<string, unknown>, raw: res.body };
  };
}

const stored = (ledger: Ledger, id = "P1") => ledger.sqlite.prepare("SELECT password_hash, password_set_at, failed_sign_ins FROM customers WHERE customer_id = ?").get(id) as { password_hash: string | null; password_set_at: string | null; failed_sign_ins: number };

describe("Story 6.8: /matkhau issues a new password and ends other sessions", () => {
  it("AC1: /matkhau in a private chat replies a new 8-character password once and stores only its argon2id hash", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("UPDATE customers SET failed_sign_ins = 4 WHERE customer_id = 'P1'");
    const res = await app(ledger)("private");
    expect(res).toMatchObject({ status: 200, body: { registered: false, reply: { kind: "password", customerCode: "DP00012", password: PASSWORD } } });
    const row = stored(ledger);
    expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(row.password_hash).not.toContain(PASSWORD);
    expect(await verifyPassword(row.password_hash ?? "", PASSWORD)).toBe(true);
    expect(row).toMatchObject({ password_set_at: CLOCK.now(), failed_sign_ins: 0 });
    const audit = ledger.sqlite.prepare("SELECT event, actor_kind, payload FROM audit_entries WHERE event = 'identity.customer.password_issued'").all() as { payload: string; actor_kind: string }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_kind).toBe("customer");
    expect(audit[0]?.payload).not.toContain(PASSWORD);
  });

  it("AC1: each issued password is 8 random letters and digits, none misread (no 0, O, 1, l, I)", () => {
    const drawn = Array.from({ length: 200 }, () => newCustomerPassword());
    for (const password of drawn) {
      expect(password).toMatch(ISSUED_PASSWORD_PATTERN);
      expect(password).not.toMatch(/[0O1lI]/);
    }
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("AC2: given two open customer sessions, /matkhau ends both; another customer's session stays open", async () => {
    const ledger = payoutLedger();
    const [phone, laptop, other] = ledger.tx((db) => [openSession(db, { kind: "CUSTOMER", customerId: "P1" }, CLOCK, null), openSession(db, { kind: "CUSTOMER", customerId: "P1" }, CLOCK, 86_400_000), openSession(db, { kind: "CUSTOMER", customerId: "P2" }, CLOCK, null)]);
    expect(ledger.tx((db) => customerSessionOf(db, phone!.token, CLOCK))).toBe("P1");
    await app(ledger)("private");
    expect(ledger.tx((db) => [phone, laptop, other].map((s) => customerSessionOf(db, s!.token, CLOCK)))).toEqual([null, null, "P2"]);
    const ended = ledger.sqlite.prepare("SELECT end_reason FROM sessions WHERE customer_id = 'P1'").all() as { end_reason: string }[];
    expect(ended).toEqual([{ end_reason: "NEW_PASSWORD" }, { end_reason: "NEW_PASSWORD" }]);
  });

  it("AC3: /matkhau in the group is refused with the pointer to the private chat; nothing is issued or ended", async () => {
    const ledger = payoutLedger();
    const session = ledger.tx((db) => openSession(db, { kind: "CUSTOMER", customerId: "P1" }, CLOCK, null));
    const res = await app(ledger)("group");
    expect(res).toEqual({ status: 200, body: { registered: false, customerCode: null, reply: { kind: "private_only" } }, raw: expect.any(String) });
    expect(stored(ledger).password_hash).toBeNull();
    expect(ledger.tx((db) => customerSessionOf(db, session.token, CLOCK))).toBe("P1");
  });

  it("AC4: the password value never appears in a log line; the guest account and a staff record get no password", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('S1', NULL, 'EMPLOYEE', 'ACTIVE')");
    const lines: string[] = [];
    const post = app(ledger, lines);
    expect((await post("private")).raw).toContain(PASSWORD);
    expect((await post("private", "HOUSE")).body["reply"]).toEqual({ kind: "none" });
    expect((await post("private", "S1")).body["reply"]).toEqual({ kind: "contact_admin" });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("messaging.chat_command.answered");
    expect(lines.join("\n")).not.toContain(PASSWORD);
  });

  it("a disabled customer is sent to an admin and gets no password", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("UPDATE customers SET status = 'DISABLED' WHERE customer_id = 'P1'");
    expect((await app(ledger)("private")).body["reply"]).toEqual({ kind: "contact_admin" });
    expect(stored(ledger).password_hash).toBeNull();
  });

  it("review 6: only an active customer (USER) gets a password; an admin or employee record with a code is sent to an admin", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('A1', 'DP09001', 'ADMIN', 'ACTIVE'), ('E1', 'DP09002', 'EMPLOYEE', 'ACTIVE')");
    const post = app(ledger);
    for (const id of ["A1", "E1"]) {
      expect((await post("private", id)).body["reply"], id).toEqual({ kind: "contact_admin" });
      expect(stored(ledger, id).password_hash, id).toBeNull();
    }
  });

  it("review 6: a customer disabled while the password is hashed gets no password and no 500; nothing is stored or ended", async () => {
    const ledger = payoutLedger();
    const session = ledger.tx((db) => openSession(db, { kind: "CUSTOMER", customerId: "P1" }, CLOCK, null));
    const racing = () => {
      ledger.sqlite.exec("UPDATE customers SET status = 'DISABLED' WHERE customer_id = 'P1'");
      return PASSWORD;
    };
    const res = await app(ledger, [], racing)("private");
    expect(res.status).toBe(200);
    expect(res.body["reply"]).toEqual({ kind: "contact_admin" });
    expect(res.raw).not.toContain(PASSWORD);
    expect(stored(ledger).password_hash).toBeNull();
    expect((ledger.sqlite.prepare("SELECT ended_at FROM sessions WHERE token_hash IS NOT NULL").get() as { ended_at: string | null }).ended_at).toBeNull();
    expect(session.token).toBeTruthy();
  });
});
