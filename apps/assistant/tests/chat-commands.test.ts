/**
 * Story 6.7 (assistant side): `/id`, `/sodu`, `/donhang`, `/stk` and `/help` answered from the
 * server's facts with sentences from the message file, in the pacer's turn, in the live bot's
 * format (owner requirement 2026-11-02). The balance shows exactly the server's `getBalances`
 * figures; `/donhang` lists today's orders with their total, else the latest five with their date;
 * `/sodu`, `/donhang`, `/stk` and `/matkhau` in the group get the live pointer to the private chat;
 * a group reply tags the sender. The server side is in apps/server/tests/assistant-commands.test.ts.
 * Every Zalo session here is the in-memory fake.
 */
import { ASSISTANT_COMMAND_PATH, ASSISTANT_LINK_REQUEST_PATH, type AssistantCommandReply } from "@cashback/contracts";
import { parseInstant, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { COMMAND_SPELLINGS, commandOf, staticCommandOf } from "../src/chat-command";
import { fakeZaloSession, type FakeZaloSession } from "../src/fake-zalo.adapter";
import { internalApi } from "../src/internal-api.adapter";
import { messageText } from "../src/messages";
import { timerSleep } from "../src/pacer";
import { BASE, fakeServer, ok, TOKEN, type FakeServer } from "./fake-server";

const START = "2026-11-01T03:00:00.000Z";
const DEV_GROUP = "8786316503449470342";
/** A date or a day count in a balance, which no balance gives (D11). */
const DATE_LIKE = /\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|\d+\s*ng\u00e0y/u;
const D = "\u0111";

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

const balance = (lines: { payableLine: string; owedLine?: string; waiting: string; paid: string; bankStatus?: string }) =>
  messageText("command_balance", { name: "Lan", customerCode: "DP00012", owedLine: "", bankStatus: messageText("balance_bank_none"), ...lines });

describe("Story 6.7: chat commands for balance, orders, code, bank and help", () => {
  it("AC1: /sodu of a customer with payable 79,216 and waiting 9,263 shows the same figures getBalances returns", async () => {
    const server = fakeServer();
    answering(server, { kind: "balance", payable: 79216, waiting: 9263, paid: 150000, deducted: 0, owedAfter: 0, customerCode: "DP00012", bank: { bankName: "Vietcombank", lastFour: "6789", held: false } });
    const sent = await sentFor(server, privately("/sodu"));
    expect(server.callsTo(ASSISTANT_COMMAND_PATH)).toEqual([{ zaloUserId: "70001", displayName: "Lan", chat: "private", command: "balance" }]);
    const bankStatus = messageText("balance_bank_set", { bank: "Vietcombank", lastFour: "6789" });
    expect(sent).toEqual([balance({ payableLine: messageText("balance_line_payable", { payable: `79.216${D}` }), waiting: `9.263${D}`, paid: `150.000${D}`, bankStatus })]);
    expect(sent[0]).toContain(`79.216${D}`);
    expect(sent[0]).toContain("DP00012");
    expect(sent[0]).not.toMatch(DATE_LIKE);
  });

  it("AC1: open clawbacks show what the next payout actually deducts, and what is still owed after it", async () => {
    const server = fakeServer();
    answering(server, { kind: "balance", payable: 10737, waiting: 0, paid: 0, deducted: 9263, owedAfter: 0, customerCode: "DP00012", bank: null });
    const [covered] = await sentFor(server, privately("/sodu"));
    expect(covered).toBe(balance({ payableLine: messageText("balance_line_payable_deducted", { payable: `10.737${D}`, deducted: `9.263${D}` }), waiting: `0${D}`, paid: `0${D}` }));
    const short = fakeServer();
    answering(short, { kind: "balance", payable: 0, waiting: 0, paid: 0, deducted: 5000, owedAfter: 4263, customerCode: "DP00012", bank: null });
    const [text] = await sentFor(short, privately("/sodu"));
    expect(text).toBe(balance({ payableLine: messageText("balance_line_payable_deducted", { payable: `0${D}`, deducted: `5.000${D}` }), owedLine: messageText("balance_line_owed", { owed: `4.263${D}` }), waiting: `0${D}`, paid: `0${D}` }));
    expect(text).not.toContain(`9.263${D}`);
    const held = fakeServer();
    answering(held, { kind: "balance", payable: 0, waiting: 0, paid: 0, deducted: 0, owedAfter: 0, customerCode: "DP00012", bank: { bankName: null, lastFour: "6789", held: true } });
    const [waiting] = await sentFor(held, privately("/sodu"));
    expect(waiting).toContain(messageText("balance_bank_held", { bank: messageText("bank_unnamed"), lastFour: "6789" }));
  });

  it("the guest account gets no reply (D5); a record without a code is sent to an admin, never asked to register again", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: null, reply: { kind: "none" } });
    expect(await sentFor(server, privately("/help", "HOUSE"))).toEqual([]);
    const staff = fakeServer();
    staff.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: null, reply: { kind: "contact_admin" } });
    expect(await sentFor(staff, privately("/id", "S1"))).toEqual([messageText("command_contact_admin")]);
  });

  it("/sodu in the group is refused with the live pointer to the private chat (owner decision)", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: null, reply: { kind: "private_only" } });
    expect(await sentFor(server, inGroup("/sodu"))).toEqual([`@Lan\n${messageText("command_private_only")}`]);
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
    expect(zalo.sent).toEqual([{ target: { kind: "group", groupId: DEV_GROUP }, text: `@Lan\n${messageText("command_orders_private_only")}`, at: expect.any(String), mentions: [{ userId: "70001", pos: 0, len: 4 }] }]);
  });

  it("AC3: /donhang in a private chat lists today's orders with their total, as the live order_history did", async () => {
    const server = fakeServer();
    answering(server, {
      kind: "orders",
      todayTotal: 88479,
      orders: [
        { orderId: "261101W0001", status: "AWAITING_APPROVAL", cashback: null, rejectionReason: null, amount: 9263, recordedAt: "2026-11-01T02:00:00.000Z", today: true },
        { orderId: "261101A0001", status: "APPROVED", cashback: 79216, rejectionReason: null, amount: 79216, recordedAt: "2026-11-01T01:00:00.000Z", today: true },
        { orderId: "261020P0001", status: "PAID", cashback: 36000, rejectionReason: null, amount: 36000, recordedAt: "2026-10-20T05:00:00.000Z", today: false },
      ],
    });
    const [text] = await sentFor(server, privately("/donhang"));
    const lines = [
      messageText("command_orders_line_today", { index: 1, orderId: "261101W0001", cashback: `9.263${D}` }),
      messageText("command_orders_line_today", { index: 2, orderId: "261101A0001", cashback: `79.216${D}` }),
    ];
    expect(text).toBe(messageText("command_orders_today", { date: "01/11/2026", orders: lines.join("\n"), total: `88.479${D}` }));
    expect(text).not.toContain("261020P0001");
    expect(text).not.toContain("{");
  });

  it("AC3: without an order today the latest five are listed with their date; with none at all the live empty message", async () => {
    const server = fakeServer();
    answering(server, { kind: "orders", orders: [] });
    expect(await sentFor(server, privately("/don"))).toEqual([messageText("command_orders_none", { date: "01/11/2026" })]);
    const other = fakeServer();
    const order = (n: number) => ({ orderId: `2610${String(n).padStart(2, "0")}X0001`, status: "REJECTED", cashback: null, rejectionReason: "order_cancelled", amount: 0, recordedAt: `2026-10-${String(n).padStart(2, "0")}T05:00:00.000Z`, today: false });
    answering(other, { kind: "orders", todayTotal: 0, orders: [order(20), order(19), order(18), order(17), order(16), order(15)] });
    const [text] = await sentFor(other, privately("/donhang"));
    const lines = [20, 19, 18, 17, 16].map((n, i) => messageText("command_orders_line_recent", { index: i + 1, orderId: `2610${n}X0001`, date: `${n}/10`, cashback: `0${D}` }));
    expect(text).toBe(messageText("command_orders_recent", { date: "01/11/2026", count: 5, orders: lines.join("\n") }));
  });

  it("AC4: /id answers the customer code with the Zalo name; /help is the live guide", async () => {
    const server = fakeServer();
    answering(server, { kind: "id", customerCode: "DP00042" });
    expect(await sentFor(server, privately("/id"))).toEqual([messageText("command_id", { name: "Lan", customerCode: "DP00042" })]);
    expect(messageText("command_id", { name: "Lan", customerCode: "DP00042" })).toContain("DP00042");
    const helped = fakeServer();
    answering(helped, { kind: "help" });
    expect(await sentFor(helped, privately("/help"))).toEqual([messageText("command_help")]);
    for (const command of ["id", "balance", "bank", "password"] as const) expect(messageText("command_help"), command).toContain(`/${COMMAND_SPELLINGS[command][0]}`);
    for (const fixed of ["/chinhsach", "/web"]) expect(messageText("command_help")).toContain(fixed);
  });

  it("/id in the group gets the live pointer there and the code privately, as the live bot sent it", async () => {
    const server = fakeServer();
    answering(server, { kind: "id", customerCode: "DP00042" });
    const { zalo, stop } = start(server);
    const done = zalo.deliver(inGroup("/id"));
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    await stop();
    expect(zalo.sent.map((s) => [s.target, s.text])).toEqual([
      [{ kind: "group", groupId: DEV_GROUP }, `@Lan\n${messageText("command_private_only")}`],
      [{ kind: "private", userId: "70001" }, messageText("command_id_from_group", { name: "Lan", customerCode: "DP00042" })],
    ]);
  });

  it("/web, /chinhsach and /ping say what the live bot said, without asking the server", async () => {
    expect(["/web", "/chinhsach", "/ping", "/xyz"].map(staticCommandOf)).toEqual(["command_web", "command_policy", "command_ping", null]);
    const server = fakeServer();
    expect(await sentFor(server, inGroup("/web"))).toEqual([`@Lan\n${messageText("command_web")}`]);
    expect(await sentFor(server, inGroup("/ping"))).toEqual([messageText("command_ping", { groupName: messageText("group_default_name") })]);
    expect(await sentFor(server, privately("/chinhsach"))).toEqual([messageText("command_policy")]);
    expect(server.callsTo(ASSISTANT_COMMAND_PATH)).toEqual([]);
  });

  it("AC4: the live spellings are the same commands; any other word or plain text is no command", () => {
    expect(["/id", "/ma", "/sodu", "/donhang", "/don", "/lichsu", "/stk", "/bank", "/tk", "/help", "/huongdan", " /SODU "].map(commandOf)).toEqual(["id", "id", "balance", "orders", "orders", "orders", "bank", "bank", "bank", "help", "help", "balance"]);
    // Story 6.8: /matkhau and its live spellings are the password command now.
    expect(["/matkhau", "/pass", "/password"].map(commandOf)).toEqual(["password", "password", "password"]);
    expect(["/xyz", "sodu", "hello"].map(commandOf)).toEqual([null, null, null]);
  });

  it("/stk names the bank and the last four digits only; without an account it shows how to add one", async () => {
    const server = fakeServer();
    answering(server, { kind: "bank", bank: { bankName: "Vietcombank", lastFour: "6789", held: false } });
    expect(await sentFor(server, privately("/stk"))).toEqual([messageText("command_bank_saved", { name: "Lan", bank: "Vietcombank", lastFour: "6789" })]);
    const held = fakeServer();
    answering(held, { kind: "bank", bank: { bankName: null, lastFour: "6789", held: true } });
    expect(await sentFor(held, privately("/stk"))).toEqual([messageText("command_bank_held", { name: "Lan", bank: messageText("bank_unnamed"), lastFour: "6789" })]);
    const none = fakeServer();
    answering(none, { kind: "bank", bank: null });
    expect(await sentFor(none, privately("/stk"))).toEqual([messageText("command_bank_none")]);
    // Story 6.9: details after /stk are saved in the private chat (bank-chat.test.ts); in the group they never leave the assistant.
    const group = fakeServer();
    answering(group, { kind: "private_only" });
    expect(await sentFor(group, inGroup("/stk Vietcombank 0123456789 NGUYEN VAN A"))).toEqual([`@Lan\n${messageText("command_private_only")}`]);
    expect(JSON.stringify(group.calls)).not.toContain("0123456789");
  });

  it("a private command from someone new gets the welcome first, then the answer; /id the welcome alone", async () => {
    const server = fakeServer();
    expect(await sentFor(server, privately("/help", "70007"))).toEqual([messageText("welcome", { name: "Lan", customerCode: "DP00001" }), messageText("command_help")]);
    const fresh = fakeServer();
    expect(await sentFor(fresh, privately("/id", "70008"))).toEqual([messageText("welcome", { name: "Lan", customerCode: "DP00001" })]);
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
