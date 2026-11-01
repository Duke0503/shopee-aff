/**
 * Story 6.7 (server side): the chat command route on the internal listener (AD-6, AD-10, AD-15,
 * FR-15, FR-20, D5, D10, D11, D25, D27). `/sodu` answers `getBalances` itself with the next
 * payout's netting; `/sodu`, `/donhang` and `/stk` in the group are refused with no money, order or
 * bank fact; the guest account gets no reply, a record without a code is sent to an admin; `/donhang` in the private chat gives the
 * latest orders with their status values; `/id` gives the code; a private command registers a new
 * sender, a group one never does. The assistant side (the sentences) is in
 * apps/assistant/tests/chat-commands.test.ts.
 */
import { ASSISTANT_COMMAND_PATH, CHAT_ORDERS_MAX } from "@cashback/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { assistantCommandRoutes } from "../src/links/assistant-command.routes";
import { getBalances } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER, INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { closeLedgers } from "./helpers/order-ledger";
import { addBank, addClawback, addOrder, CLOCK, payoutLedger } from "./helpers/payout-ledger";

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
  return async (body: object, headers: Record<string, string> = { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }) => {
    const res = await servers.internalApp.inject({ method: "POST", url: ASSISTANT_COMMAND_PATH, headers, payload: body });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };
}

/** Lan (P1): an approved order of 79,216 and an awaiting one whose estimate gives 9,263 waiting. */
function lan(): Ledger {
  const ledger = payoutLedger();
  addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
  addOrder(ledger, { id: "261001W0001", customer: "P1", status: "AWAITING_APPROVAL", estimate: 13007 });
  return ledger;
}

const ask = (command: string, chat: "private" | "group" = "private", zaloUserId = "P1") => ({ zaloUserId, displayName: "Lan", chat, command });

describe("Story 6.7: chat commands for balance, orders, code, bank and help", () => {
  it("AC1: /sodu of a customer with payable 79,216 and waiting 9,263 answers the figures getBalances returns", async () => {
    const ledger = lan();
    const post = app(ledger);
    const [balance] = getBalances(ledger.db, ["P1"]);
    expect(balance).toMatchObject({ payable: 79216, waiting: 9263 });
    const res = await post(ask("balance"));
    expect(res).toEqual({ status: 200, body: { registered: false, customerCode: "DP00012", reply: { kind: "balance", payable: balance?.payable, waiting: balance?.waiting, paid: balance?.paid, deducted: 0, owedAfter: 0 } } });
  });

  it("/sodu with open clawbacks above the gross: deducted is what the next payout nets (the gross), the rest is still owed", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 5000 });
    addClawback(ledger, "P1", "260901C0001", 9263);
    const [balance] = getBalances(ledger.db, ["P1"]);
    expect(balance).toMatchObject({ gross: 5000, payable: 0, deductedNext: 9263 });
    expect((await app(ledger)(ask("balance"))).body["reply"]).toEqual({ kind: "balance", payable: 0, waiting: 0, paid: 0, deducted: 5000, owedAfter: 4263 });
    const covered = payoutLedger();
    addOrder(covered, { id: "261001A0002", customer: "P1", cashback: 20000 });
    addClawback(covered, "P1", "260901C0002", 9263);
    expect((await app(covered)(ask("balance"))).body["reply"]).toMatchObject({ payable: 10737, deducted: 9263, owedAfter: 0 });
  });

  it("AC2: /donhang in the group is refused with the pointer to the private chat and carries no order; so are /stk and /sodu", async () => {
    const ledger = lan();
    addBank(ledger, "P1");
    const post = app(ledger);
    for (const command of ["orders", "bank", "balance"]) {
      const res = await post(ask(command, "group"));
      expect(res).toEqual({ status: 200, body: { registered: false, customerCode: null, reply: { kind: "private_only" } } });
      expect(JSON.stringify(res.body)).not.toMatch(/261001|79216|3456/);
    }
  });

  it("AC3: /donhang in a private chat lists the latest orders with their status values, newest first, and no date", async () => {
    const ledger = lan();
    ledger.sqlite.exec("UPDATE orders SET recorded_at = '2026-10-01T03:00:00.000Z' WHERE order_id = '261001A0001'; UPDATE orders SET recorded_at = '2026-10-02T03:00:00.000Z' WHERE order_id = '261001W0001'");
    ledger.sqlite.prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, rejection_reason, recorded_at, origin) VALUES ('261001R0001', 'shopee', 'shopee', 'P1', 'REJECTED', 'all_items_cancelled', '2026-09-30T03:00:00.000Z', 'REPORT')").run();
    addOrder(ledger, { id: "261001X0001", customer: "P2", cashback: 5000 });
    const res = await app(ledger)(ask("orders"));
    expect(res.body["reply"]).toEqual({
      kind: "orders",
      orders: [
        { orderId: "261001W0001", status: "AWAITING_APPROVAL", cashback: null, rejectionReason: null },
        { orderId: "261001A0001", status: "APPROVED", cashback: 79216, rejectionReason: null },
        { orderId: "261001R0001", status: "REJECTED", cashback: null, rejectionReason: "all_items_cancelled" },
      ],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/_at"|\d{4}-\d{2}-\d{2}/);
  });

  it(`AC3: /donhang lists at most ${CHAT_ORDERS_MAX} orders`, async () => {
    const ledger = payoutLedger();
    for (let i = 0; i < CHAT_ORDERS_MAX + 2; i++) addOrder(ledger, { id: `2610010${String(i).padStart(4, "0")}`, customer: "P1", cashback: 1000 });
    const res = await app(ledger)(ask("orders"));
    expect((res.body["reply"] as { orders: unknown[] }).orders).toHaveLength(CHAT_ORDERS_MAX);
  });

  it("AC4: /id answers the customer code, in the private chat and in the group; /help answers help", async () => {
    const post = app(lan());
    expect((await post(ask("id"))).body["reply"]).toEqual({ kind: "id", customerCode: "DP00012" });
    expect((await post(ask("id", "group"))).body["reply"]).toEqual({ kind: "id", customerCode: "DP00012" });
    expect((await post(ask("help", "group", "70000000000000001"))).body["reply"]).toEqual({ kind: "help" });
  });

  it("/stk in the private chat names the bank and the last four digits only, never the number", async () => {
    const ledger = lan();
    addBank(ledger, "P1", { number: "0071000123456" });
    const res = await app(ledger)(ask("bank"));
    expect(res.body["reply"]).toEqual({ kind: "bank", bank: { bankName: "Vietcombank", lastFour: "3456", held: false } });
    expect(JSON.stringify(res.body)).not.toContain("0071000");
    expect((await app(lan())(ask("bank"))).body["reply"]).toEqual({ kind: "bank", bank: null });
  });

  it("a private command from someone new registers them; a group command registers no one and says how to get a code", async () => {
    const ledger = lan();
    ledger.sqlite.exec("INSERT OR REPLACE INTO customer_code_counter (id, last) VALUES (1, 99)");
    const post = app(ledger);
    const count = () => (ledger.sqlite.prepare("SELECT count(*) AS n FROM customers").get() as { n: number }).n;
    const before = count();
    expect((await post(ask("id", "group", "70000000000000001"))).body).toEqual({ registered: false, customerCode: null, reply: { kind: "not_registered" } });
    expect(count()).toBe(before);
    const res = await post(ask("id", "private", "70000000000000001"));
    expect(res.body).toEqual({ registered: true, customerCode: "DP00100", reply: { kind: "id", customerCode: "DP00100" } });
    expect(count()).toBe(before + 1);
  });

  it("a known record without a customer code is asked to contact an admin, in either chat, never told to register again", async () => {
    const ledger = lan();
    ledger.sqlite.exec("INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('S1', NULL, 'EMPLOYEE', 'ACTIVE')");
    const post = app(ledger);
    for (const chat of ["private", "group"] as const) expect((await post(ask("id", chat, "S1"))).body).toEqual({ registered: false, customerCode: null, reply: { kind: "contact_admin" } });
    expect((await post(ask("balance", "private", "S1"))).body["reply"]).toEqual({ kind: "contact_admin" });
  });

  it("the guest account gets no reply at all (D5), in the private chat and the group, /help included; the route needs the assistant token", async () => {
    const ledger = lan();
    const post = app(ledger);
    for (const chat of ["private", "group"] as const) for (const command of ["id", "help"]) expect((await post(ask(command, chat, "HOUSE"))).body["reply"], `${command} ${chat}`).toEqual({ kind: "none" });
    expect((await post(ask("balance", "private", "HOUSE"))).body["reply"]).toEqual({ kind: "none" });
    expect((await post(ask("balance"), { [INTERNAL_TOKEN_HEADER]: INTERNAL })).status).toBe(401);
    expect((await post({ ...ask("balance"), command: "matkhau" })).status).toBe(400);
  });
});
