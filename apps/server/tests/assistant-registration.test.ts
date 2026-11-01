/**
 * Story 6.2 (server side): registration from Zalo assigns a customer code (FR-8, AD-23, D10, D25,
 * INV-6). The assistant's chat routes on the internal listener are the only way a customer is
 * created: the first private message from an unknown Zalo id makes one customer with the next DP
 * code; the same id again, or an alias of a merged customer, finds the survivor; a group member is
 * registered only by a supported product link; no public route creates anyone. The assistant side
 * (the paced welcome) is in apps/assistant/tests/registration.test.ts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ASSISTANT_LINK_REQUEST_PATH, ASSISTANT_REGISTRATION_PATH } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { splitCommission } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { assistantChatRoutes } from "../src/links/assistant-chat.routes";
import { receiptPageRoutes } from "../src/pages/receipt.page";
import { sharePageRoutes } from "../src/pages/share.page";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER, INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { LINK_START, linkLedger } from "./helpers/link-ledger";

const CLOCK = fixedClock(LINK_START);
const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);
const PRODUCT = "https://shopee.vn/Ao-thun-i.11001.22001";
const SERVER_SRC = join(import.meta.dirname, "..", "src");
const MESSAGES = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", "labels", "vi", "messages.json"), "utf8")) as Record<string, string>;

const ledgers: Ledger[] = [];
const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  for (const l of ledgers.splice(0)) l.close();
});

function app(counter = 41) {
  const ledger = linkLedger(ledgers);
  ledger.sqlite.exec(`INSERT OR REPLACE INTO customer_code_counter (id, last) VALUES (1, ${counter})`);
  const servers = buildServers({
    clock: CLOCK,
    internalToken: INTERNAL,
    assistantToken: ASSISTANT,
    internal: [assistantChatRoutes({ ledger, clock: CLOCK, requestIdPrefix: "", tikTok: true, shareBaseUrl: "https://hoantiendp.com" })],
    public: [sharePageRoutes({ ledger, clock: CLOCK, baseUrl: "https://hoantiendp.com" }), receiptPageRoutes({ ledger, clock: CLOCK })],
  });
  opened.push(servers);
  const post = (url: string, payload: object, headers: Record<string, string> = { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }) => servers.internalApp.inject({ method: "POST", url, headers, payload });
  return { ledger, servers, post };
}

const customers = (ledger: Ledger) => ledger.sqlite.prepare("SELECT customer_id, customer_code, role, status, zalo_user_id, private_chat_id, display_name FROM customers WHERE customer_id NOT IN ('1000000000000000001', '1000000000000000002', 'HOUSE') ORDER BY customer_id").all();
const customerCount = (ledger: Ledger): number => (ledger.sqlite.prepare("SELECT count(*) AS n FROM customers").get() as { n: number }).n;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

describe("Story 6.2: registration from Zalo assigns a customer code", () => {
  it("AC1: a first private message from an unknown Zalo id creates one customer with the next DP code, audited without the name", async () => {
    const { ledger, post } = app(41);
    const res = await post(ASSISTANT_REGISTRATION_PATH, { zaloUserId: "7000000000000000001", displayName: "Lan Nguyen" });
    expect([res.statusCode, res.json()]).toEqual([200, { customerId: "7000000000000000001", customerCode: "DP00042", created: true }]);
    expect(customers(ledger)).toEqual([{ customer_id: "7000000000000000001", customer_code: "DP00042", role: "USER", status: "ACTIVE", zalo_user_id: "7000000000000000001", private_chat_id: "7000000000000000001", display_name: "Lan Nguyen" }]);
    expect(ledger.sqlite.prepare("SELECT last FROM customer_code_counter").get()).toEqual({ last: 42 });
    const audit = ledger.sqlite.prepare("SELECT actor_kind, event, payload FROM audit_entries WHERE event = 'identity.customer.registered'").all() as { actor_kind: string; payload: string }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_kind).toBe("assistant");
    expect(audit[0]!.payload).not.toContain("Lan");
    const next = await post(ASSISTANT_REGISTRATION_PATH, { zaloUserId: "7000000000000000002" });
    expect(next.json()).toMatchObject({ customerCode: "DP00043", created: true });
  });

  it("AC2: the same Zalo id writing again creates no second customer", async () => {
    const { ledger, post } = app();
    await post(ASSISTANT_REGISTRATION_PATH, { zaloUserId: "7000000000000000001" });
    const before = customerCount(ledger);
    const again = await post(ASSISTANT_REGISTRATION_PATH, { zaloUserId: "7000000000000000001", displayName: "Other name" });
    expect(again.json()).toEqual({ customerId: "7000000000000000001", customerCode: "DP00042", created: false });
    const link = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: "7000000000000000001", chat: "private", url: PRODUCT });
    expect(link.json()).toMatchObject({ customerId: "7000000000000000001", registered: false });
    expect(customerCount(ledger)).toBe(before);
    expect(ledger.sqlite.prepare("SELECT last FROM customer_code_counter").get()).toEqual({ last: 42 });
  });

  it("AC3: a group member who sends no link, or a link that is not a supported product, is never registered; a product link registers them", async () => {
    const { ledger, post } = app();
    const before = customerCount(ledger);
    const lazada = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: "7000000000000000009", chat: "group", url: "https://www.lazada.vn/products/ao-i123.html" });
    expect([lazada.statusCode, lazada.json()]).toEqual([200, { outcome: "refused", reason: "network_unsupported", customerId: null, customerCode: null, registered: false }]);
    const news = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: "7000000000000000009", chat: "group", url: "https://vnexpress.net/tin-1.html" });
    expect(news.json()).toEqual({ outcome: "refused", reason: "not_a_shop_link", customerId: null, customerCode: null, registered: false });
    expect(customerCount(ledger)).toBe(before);
    const product = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: "7000000000000000009", displayName: "Minh", chat: "group", url: PRODUCT });
    expect(product.json()).toMatchObject({ outcome: "queued", customerId: "7000000000000000009", customerCode: "DP00042", registered: true, reused: false });
    expect(customers(ledger)).toEqual([expect.objectContaining({ customer_id: "7000000000000000009", private_chat_id: null })]);
  });

  it("AC4: no public route creates a customer, and the internal routes open only with the assistant token", async () => {
    const { ledger, servers, post } = app();
    const before = customerCount(ledger);
    for (const url of [ASSISTANT_REGISTRATION_PATH, ASSISTANT_LINK_REQUEST_PATH, "/api/register", "/api/customers", "/api/session"]) {
      const res = await servers.publicApp.inject({ method: "POST", url, payload: { zaloUserId: "7000000000000000001", chat: "private", url: PRODUCT } });
      expect(res.statusCode).toBe(404);
    }
    const wrong: Record<string, string>[] = [{}, { [INTERNAL_TOKEN_HEADER]: INTERNAL }, { [ASSISTANT_TOKEN_HEADER]: "b".repeat(40) }];
    for (const headers of wrong) {
      expect((await post(ASSISTANT_REGISTRATION_PATH, { zaloUserId: "7000000000000000001" }, headers)).statusCode).toBe(401);
    }
    expect(customerCount(ledger)).toBe(before);
    const callers = tsFiles(SERVER_SRC).filter((f) => /\bregisterCustomer\(/.test(readFileSync(f, "utf8"))).map((f) => relative(SERVER_SRC, f).replaceAll("\\", "/"));
    expect(callers.sort()).toEqual(["links/assistant-chat.routes.ts", "modules/identity/customer-register.command.ts"]);
  });

  it("review 10: a first private message with a link registers its sender in the link call, and says so even when the link is refused", async () => {
    const { ledger, post } = app();
    const refusedLink = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: "7000000000000000003", chat: "private", url: "https://vnexpress.net/tin-1.html" });
    expect(refusedLink.json()).toEqual({ outcome: "refused", reason: "not_a_shop_link", customerId: "7000000000000000003", customerCode: "DP00042", registered: true });
    const queued = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: "7000000000000000004", chat: "private", url: PRODUCT });
    expect(queued.json()).toMatchObject({ outcome: "queued", customerId: "7000000000000000004", customerCode: "DP00043", registered: true });
    const again = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: "7000000000000000004", chat: "private", url: PRODUCT });
    expect(again.json()).toMatchObject({ outcome: "queued", registered: false, reused: true });
    expect(customers(ledger)).toHaveLength(2);
  });

  it("AC5: a Zalo id that is an alias of a merged customer finds the survivor and creates no one", async () => {
    const { ledger, post } = app();
    ledger.sqlite.exec(`INSERT INTO customers (customer_id, customer_code, role, status, zalo_user_id) VALUES ('5000000000000000001', 'DP00010', 'USER', 'ACTIVE', '5000000000000000001'), ('5000000000000000002', 'DP00011', 'USER', 'MERGED', NULL);
      INSERT INTO customer_aliases (alias, customer_id) VALUES ('5000000000000000002', '5000000000000000001'), ('6000000000000000002', '5000000000000000001');`);
    const before = customerCount(ledger);
    for (const zaloUserId of ["6000000000000000002", "5000000000000000002"]) {
      const res = await post(ASSISTANT_REGISTRATION_PATH, { zaloUserId });
      expect(res.json()).toEqual({ customerId: "5000000000000000001", customerCode: "DP00010", created: false });
    }
    const link = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: "6000000000000000002", chat: "group", url: PRODUCT });
    expect(link.json()).toMatchObject({ customerId: "5000000000000000001", registered: false });
    expect(ledger.sqlite.prepare("SELECT customer_id FROM link_requests").all()).toEqual([{ customer_id: "5000000000000000001" }]);
    expect(customerCount(ledger)).toBe(before);
  });

  it("an erased record that still holds the Zalo id as its customer id gets a new customer under the new code; a malformed id is refused", async () => {
    const { ledger, post } = app();
    ledger.sqlite.exec(`INSERT INTO customers (customer_id, customer_code, role, status, erased_at) VALUES ('7000000000000000005', 'DP00005', 'USER', 'ERASED', '2026-10-01T00:00:00.000Z')`);
    const res = await post(ASSISTANT_REGISTRATION_PATH, { zaloUserId: "7000000000000000005" });
    expect(res.json()).toEqual({ customerId: "DP00042", customerCode: "DP00042", created: true });
    expect((await post(ASSISTANT_REGISTRATION_PATH, { zaloUserId: "70-01" })).statusCode).toBe(400);
  });

  it("the welcome's example is the money rule's split: 80% of a 10.000\u0111 commission after fee and tax is about 7.100\u0111", () => {
    const cashback = splitCommission({ approvedCommission: 10_000, network: "shopee", withheld: true }).cashback;
    expect(Math.abs(cashback - 7_100)).toBeLessThan(50);
    expect(MESSAGES["welcome"]).toContain("{customerCode}");
    expect(MESSAGES["welcome"]).toContain("80%");
    expect(MESSAGES["welcome"]).toContain("7.100\u0111");
    for (const key of ["link_ready", "link_ready_withheld"]) expect(MESSAGES[key]).toMatch(/\{cashback\}, t\u1ee9c \{share\}/);
  });
});
