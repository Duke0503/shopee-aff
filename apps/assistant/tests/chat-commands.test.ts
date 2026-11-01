/**
 * Story 6.7 (assistant side): `/id`, `/sodu`, `/donhang`, `/stk` and `/help` answered from the
 * server's facts with sentences from the message file, in the pacer's turn. The balance shows
 * exactly the server's `getBalances` figures; an order's state is its status registry sentence;
 * `/donhang` and `/stk` in the group get the pointer to the private chat; a group reply tags the
 * sender. The server side is in apps/server/tests/assistant-commands.test.ts. Every Zalo session
 * here is the in-memory fake.
 */
import { ASSISTANT_COMMAND_PATH, ASSISTANT_COMMANDS, ASSISTANT_LINK_REQUEST_PATH, type AssistantCommandReply } from "@cashback/contracts";
import { parseInstant, statusesOf, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { COMMAND_SPELLINGS, commandOf } from "../src/chat-command";
import { fakeZaloSession, type FakeZaloSession } from "../src/fake-zalo.adapter";
import { internalApi } from "../src/internal-api.adapter";
import { messageText, type MessageKey } from "../src/messages";
import { timerSleep } from "../src/pacer";
import { BASE, fakeServer, ok, TOKEN, type FakeServer } from "./fake-server";

const START = "2026-11-01T03:00:00.000Z";
const DEV_GROUP = "8786316503449470342";
/** A date or a day count in a reply, which no command answer gives (D11). */
const DATE_LIKE = /\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|\d+\s*ng\u00e0y/u;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

function start(server: FakeServer): { zalo: FakeZaloSession; stop: () => Promise<void> } {
  const zalo = fakeZaloSession(systemClock);
  const assistant = startAssistant({
    zalo,
    api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }),
    clock: systemClock,
    sleep: timerSleep,
    sendDelay: { minMs: 6_000, maxMs: 12_000 },
    zaloGroupIds: [DEV_GROUP],
    friendRequestsPerDay: 30,
    onError: () => undefined,
    random: () => 0,
  });
  return { zalo, stop: () => assistant.stop() };
}

const privately = (text: string, userId = "70001") => ({ chat: { kind: "private" as const, userId }, senderId: userId, senderName: "Lan", text });
const inGroup = (text: string, userId = "70001") => ({ chat: { kind: "group" as const, groupId: DEV_GROUP }, senderId: userId, senderName: "Lan", text });

/** The server answers every command with `reply` for a known customer. */
function answering(server: FakeServer, reply: AssistantCommandReply): void {
  server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: "DP00001", reply });
}

async function sentFor(server: FakeServer, message: ReturnType<typeof privately> | ReturnType<typeof inGroup>): Promise<string[]> {
  const { zalo, stop } = start(server);
  const done = zalo.deliver(message);
  await vi.advanceTimersByTimeAsync(30_000);
  await done;
  await stop();
  return zalo.sent.map((s) => s.text);
}

const sentence = (status: string, reason = "") => messageText(statusesOf("order").find((s) => s.value === status)?.messageKey as MessageKey, { reason });

describe("Story 6.7: chat commands for balance, orders, code, bank and help", () => {
  it("AC1: /sodu of a customer with payable 79,216 and waiting 9,263 shows the same figures getBalances returns", async () => {
    const server = fakeServer();
    answering(server, { kind: "balance", payable: 79216, waiting: 9263, paid: 150000, deducted: 0, owedAfter: 0 });
    const sent = await sentFor(server, privately("/sodu"));
    expect(server.callsTo(ASSISTANT_COMMAND_PATH)).toEqual([{ zaloUserId: "70001", displayName: "Lan", chat: "private", command: "balance" }]);
    expect(sent).toEqual([messageText("command_balance", { payableLines: messageText("balance_line_payable", { payable: "79.216\u0111" }), waiting: "9.263\u0111", paid: "150.000\u0111" })]);
    expect(sent[0]).toContain("79.216\u0111");
    expect(sent[0]).toContain("9.263\u0111");
    expect(sent[0]).not.toMatch(DATE_LIKE);
  });

  it("AC1: open clawbacks show what the next payout actually deducts, and what is still owed after it", async () => {
    const server = fakeServer();
    answering(server, { kind: "balance", payable: 10737, waiting: 0, paid: 0, deducted: 9263, owedAfter: 0 });
    const [covered] = await sentFor(server, privately("/sodu"));
    expect(covered).toBe(messageText("command_balance", { payableLines: messageText("balance_line_payable_deducted", { payable: "10.737\u0111", deducted: "9.263\u0111" }), waiting: "0\u0111", paid: "0\u0111" }));
    const short = fakeServer();
    answering(short, { kind: "balance", payable: 0, waiting: 0, paid: 0, deducted: 5000, owedAfter: 4263 });
    const [text] = await sentFor(short, privately("/sodu"));
    const lines = [messageText("balance_line_payable_deducted", { payable: "0\u0111", deducted: "5.000\u0111" }), messageText("balance_line_owed", { owed: "4.263\u0111" })].join("\n");
    expect(text).toBe(messageText("command_balance", { payableLines: lines, waiting: "0\u0111", paid: "0\u0111" }));
    expect(text).not.toContain("9.263\u0111");
    const nothingTaken = fakeServer();
    answering(nothingTaken, { kind: "balance", payable: 0, waiting: 0, paid: 0, deducted: 0, owedAfter: 9263 });
    const [owed] = await sentFor(nothingTaken, privately("/sodu"));
    expect(owed).toBe(messageText("command_balance", { payableLines: [messageText("balance_line_payable", { payable: "0\u0111" }), messageText("balance_line_owed", { owed: "9.263\u0111" })].join("\n"), waiting: "0\u0111", paid: "0\u0111" }));
  });

  it("the guest account gets no reply (D5); a record without a code is sent to an admin, never asked to register again", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: null, reply: { kind: "none" } });
    expect(await sentFor(server, privately("/help", "HOUSE"))).toEqual([]);
    const staff = fakeServer();
    staff.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: null, reply: { kind: "contact_admin" } });
    expect(await sentFor(staff, privately("/id", "S1"))).toEqual([messageText("command_contact_admin")]);
  });

  it("/sodu in the group is refused with the pointer to the private chat (owner decision)", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: null, reply: { kind: "private_only" } });
    expect(await sentFor(server, inGroup("/sodu"))).toEqual([`@Lan\n${messageText("command_private_only")}`]);
    expect(messageText("command_help")).toMatch(/\/sodu[^\n]*\(/);
  });

  it("AC2: /donhang in the group is refused with the pointer to the private chat, tags the sender and shows no order", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: null, reply: { kind: "private_only" } });
    const { zalo, stop } = start(server);
    const done = zalo.deliver(inGroup("/donhang"));
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    await stop();
    expect(server.callsTo(ASSISTANT_COMMAND_PATH)).toEqual([{ zaloUserId: "70001", displayName: "Lan", chat: "group", command: "orders" }]);
    expect(zalo.sent).toEqual([{ target: { kind: "group", groupId: DEV_GROUP }, text: `@Lan\n${messageText("command_private_only")}`, at: expect.any(String), mentions: [{ userId: "70001", pos: 0, len: 4 }] }]);
  });

  it("AC3: /donhang in a private chat shows each order's state from the status registry sentence and no payout date", async () => {
    const server = fakeServer();
    answering(server, {
      kind: "orders",
      orders: [
        { orderId: "261001W0001", status: "AWAITING_APPROVAL", cashback: null, rejectionReason: null },
        { orderId: "261001A0001", status: "APPROVED", cashback: 79216, rejectionReason: null },
        { orderId: "261001P0001", status: "PAID", cashback: 36000, rejectionReason: null },
        { orderId: "261001R0001", status: "REJECTED", cashback: null, rejectionReason: "all_items_cancelled" },
        { orderId: "261001F0001", status: "FROZEN", cashback: null, rejectionReason: null },
        { orderId: "261001V0001", status: "REVERSED", cashback: 5000, rejectionReason: null },
      ],
    });
    const [text] = await sentFor(server, privately("/donhang"));
    const lines = [
      messageText("command_orders_line", { orderId: "261001W0001", state: sentence("AWAITING_APPROVAL") }),
      messageText("command_orders_line_amount", { orderId: "261001A0001", state: sentence("APPROVED"), cashback: "79.216\u0111" }),
      messageText("command_orders_line_amount", { orderId: "261001P0001", state: sentence("PAID"), cashback: "36.000\u0111" }),
      messageText("command_orders_line", { orderId: "261001R0001", state: sentence("REJECTED", messageText("rejection_reason_all_items_cancelled")) }),
      messageText("command_orders_line", { orderId: "261001F0001", state: sentence("FROZEN") }),
      messageText("command_orders_line", { orderId: "261001V0001", state: sentence("REVERSED") }),
    ];
    expect(text).toBe(messageText("command_orders", { orders: lines.join("\n") }));
    expect(text).not.toMatch(DATE_LIKE);
    expect(text).not.toContain("{");
  });

  it("AC3: a customer with no order is told so; a rejection reason the message file lacks points to the website", async () => {
    const server = fakeServer();
    answering(server, { kind: "orders", orders: [] });
    expect(await sentFor(server, privately("/don"))).toEqual([messageText("command_orders_none")]);
    const other = fakeServer();
    answering(other, { kind: "orders", orders: [{ orderId: "X1", status: "REJECTED", cashback: null, rejectionReason: "live text" }] });
    const [text] = await sentFor(other, privately("/donhang"));
    expect(text).toContain(sentence("REJECTED", messageText("rejection_reason_other")));
  });

  it("AC4: /id answers the customer code; /help lists every command from the message file", async () => {
    const server = fakeServer();
    answering(server, { kind: "id", customerCode: "DP00042" });
    expect(await sentFor(server, privately("/id"))).toEqual([messageText("command_id", { customerCode: "DP00042" })]);
    expect(messageText("command_id", { customerCode: "DP00042" })).toContain("DP00042");
    const helped = fakeServer();
    answering(helped, { kind: "help" });
    expect(await sentFor(helped, privately("/help"))).toEqual([messageText("command_help")]);
    for (const command of ASSISTANT_COMMANDS) expect(messageText("command_help"), command).toContain(`/${COMMAND_SPELLINGS[command][0]}`);
  });

  it("AC4: the live spellings are the same commands; any other word or plain text is no command", () => {
    expect(["/id", "/ma", "/sodu", "/donhang", "/don", "/lichsu", "/stk", "/bank", "/tk", "/help", "/huongdan", " /SODU "].map(commandOf)).toEqual(["id", "id", "balance", "orders", "orders", "orders", "bank", "bank", "bank", "help", "help", "balance"]);
    expect(["/matkhau", "/xyz", "sodu", "hello"].map(commandOf)).toEqual([null, null, null, null]);
  });

  it("/stk names the bank and the last four digits only; without an account it shows how to add one", async () => {
    const server = fakeServer();
    answering(server, { kind: "bank", bank: { bankName: "Vietcombank", lastFour: "6789", held: false } });
    expect(await sentFor(server, privately("/stk"))).toEqual([messageText("command_bank_saved", { bank: "Vietcombank", lastFour: "6789" })]);
    const held = fakeServer();
    answering(held, { kind: "bank", bank: { bankName: null, lastFour: "6789", held: true } });
    expect(await sentFor(held, privately("/stk"))).toEqual([messageText("command_bank_held", { bank: messageText("bank_unnamed"), lastFour: "6789" })]);
    const none = fakeServer();
    answering(none, { kind: "bank", bank: null });
    expect(await sentFor(none, privately("/stk Vietcombank 0123456789 NGUYEN VAN A"))).toEqual([messageText("command_bank_none")]);
    expect(JSON.stringify(none.calls)).not.toContain("0123456789");
  });

  it("a private command from someone new gets the welcome first, then the answer; /id the welcome alone", async () => {
    const server = fakeServer();
    expect(await sentFor(server, privately("/help", "70007"))).toEqual([messageText("welcome", { customerCode: "DP00001" }), messageText("command_help")]);
    const fresh = fakeServer();
    expect(await sentFor(fresh, privately("/id", "70008"))).toEqual([messageText("welcome", { customerCode: "DP00001" })]);
  });

  it("a member the server does not know gets the pointer to a code; a link in the same message is answered as a link", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: null, reply: { kind: "not_registered" } });
    expect(await sentFor(server, inGroup("/id"))).toEqual([`@Lan\n${messageText("command_not_registered")}`]);
    const linked = fakeServer();
    const { zalo, stop } = start(linked);
    const done = zalo.deliver(privately("/sodu https://shopee.vn/Ao-thun-i.11001.22001"));
    await vi.advanceTimersByTimeAsync(0);
    expect(linked.callsTo(ASSISTANT_COMMAND_PATH)).toEqual([]);
    expect(linked.callsTo(ASSISTANT_LINK_REQUEST_PATH)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    await stop();
  });

  it("replies go through the pacer: two commands at once are sent a human delay apart", async () => {
    const server = fakeServer();
    answering(server, { kind: "id", customerCode: "DP00001" });
    const { zalo, stop } = start(server);
    const both = Promise.all([zalo.deliver(privately("/id")), zalo.deliver(privately("/id", "70002"))]);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(zalo.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await both;
    await stop();
    expect(toMs(zalo.sent[1]!.at) - toMs(zalo.sent[0]!.at)).toBeGreaterThanOrEqual(6_000);
  });
});
