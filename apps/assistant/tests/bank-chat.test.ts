/**
 * Story 6.9 (assistant side): bank details sent after `/stk`, or as a reply in the private chat,
 * go to the server and are answered with the bank and the last four digits only; a choice of
 * banks, a broken rule and the group each get their sentence; details sent in the group never
 * leave the assistant. The change message is a notification written from the message file. The
 * server side (reading, matching, saving, the flag, the audit) is in
 * apps/server/tests/assistant-bank.test.ts. Every Zalo session here is the in-memory fake.
 */
import { ASSISTANT_BANK_PATH, ASSISTANT_COMMAND_PATH, ASSISTANT_REGISTRATION_PATH, type AssistantBankReply } from "@cashback/contracts";
import { parseInstant, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { looksLikeBankDetails } from "../src/bank-reply";
import { fakeZaloSession } from "../src/fake-zalo.adapter";
import { internalApi } from "../src/internal-api.adapter";
import { messageText } from "../src/messages";
import { notificationMessage } from "../src/notification-text";
import { timerSleep } from "../src/pacer";
import { incomingOf } from "../src/zca-zalo.adapter";
import type { IncomingMessage } from "../src/zalo.port";
import { BASE, fakeServer, ok, TOKEN, type FakeServer } from "./fake-server";

const START = "2026-11-01T03:00:00.000Z";
const DEV_GROUP = "8786316503449470342";
const AC1_DETAILS = "Vietcombank 0123-456-789 nguyen thi lan";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

const privately = (text: string, quoted = false): IncomingMessage => ({ chat: { kind: "private", userId: "70001" }, senderId: "70001", senderName: "Lan", text, ...(quoted ? { quoted } : {}) });
const inGroup = (text: string, quoted = false): IncomingMessage => ({ chat: { kind: "group", groupId: DEV_GROUP }, senderId: "70001", senderName: "Lan", text, ...(quoted ? { quoted } : {}) });

function answering(server: FakeServer, reply: AssistantBankReply): void {
  server.routes[ASSISTANT_BANK_PATH] = () => ok({ registered: false, customerCode: "DP00012", reply });
}

async function sentFor(server: FakeServer, message: IncomingMessage): Promise<string[]> {
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
  const done = zalo.deliver(message);
  await vi.advanceTimersByTimeAsync(30_000);
  await done;
  await assistant.stop();
  return zalo.sent.map((s) => s.text);
}

const saved = { kind: "saved", bankName: "Vietcombank", lastFour: "6789", changed: false } as const;

describe("Story 6.9: bank account saved or changed from the Zalo private chat", () => {
  it("AC1: \"/stk Vietcombank 0123-456-789 nguyen thi lan\" in a private chat is saved by the server and the reply shows only \u2022\u2022 6789", async () => {
    const server = fakeServer();
    answering(server, saved);
    const sent = await sentFor(server, privately(`/stk ${AC1_DETAILS}`));
    expect(server.callsTo(ASSISTANT_BANK_PATH)).toEqual([{ zaloUserId: "70001", displayName: "Lan", chat: "private", details: AC1_DETAILS }]);
    expect(server.callsTo(ASSISTANT_COMMAND_PATH)).toEqual([]);
    expect(sent).toEqual([messageText("bank_saved", { bank: "Vietcombank", lastFour: "6789" })]);
    expect(sent[0]).toContain("\u2022\u2022 6789");
    expect(sent[0]).not.toMatch(/0123|NGUYEN|nguyen/i);
  });

  it("AC1: the same details sent as a reply to the approved-order message are saved; plain text without a reply is not read as bank details", async () => {
    const server = fakeServer();
    answering(server, saved);
    expect(await sentFor(server, privately(AC1_DETAILS, true))).toEqual([messageText("bank_saved", { bank: "Vietcombank", lastFour: "6789" })]);
    expect(server.callsTo(ASSISTANT_BANK_PATH)).toEqual([{ zaloUserId: "70001", displayName: "Lan", chat: "private", details: AC1_DETAILS, quoted: true }]);
    const plain = fakeServer();
    answering(plain, saved);
    await sentFor(plain, privately(AC1_DETAILS));
    expect(plain.callsTo(ASSISTANT_BANK_PATH)).toEqual([]);
    expect(plain.callsTo(ASSISTANT_REGISTRATION_PATH)).toHaveLength(1);
    expect(incomingOf({ type: 0, threadId: "70001", data: { uidFrom: "70001", content: AC1_DETAILS, quote: { msg: "..." } } })?.quoted).toBe(true);
    expect(incomingOf({ type: 0, threadId: "70001", data: { uidFrom: "70001", content: AC1_DETAILS } })?.quoted).toBeUndefined();
    expect([AC1_DETAILS, "ok cam on", "0123456789"].map(looksLikeBankDetails)).toEqual([true, false, false]);
  });

  it("review 4: a quoted reply needs an account-like number: \"m\u00ecnh \u0111\u1eb7t 2 \u0111\u01a1n r\u1ed3i\" is answered as ordinary chat", async () => {
    expect(["m\u00ecnh \u0111\u1eb7t 2 \u0111\u01a1n r\u1ed3i", "\u0111\u01a1n 12345 \u0111\u00e3 giao", "MB 0123 456 789 NGUYEN"].map(looksLikeBankDetails)).toEqual([false, false, true]);
    const server = fakeServer();
    answering(server, saved);
    expect(await sentFor(server, privately("m\u00ecnh \u0111\u1eb7t 2 \u0111\u01a1n r\u1ed3i", true))).toEqual([messageText("welcome", { customerCode: "DP00001" })]);
    expect(server.callsTo(ASSISTANT_BANK_PATH)).toEqual([]);
  });

  it("review 4: a quoted reply the server reads as no bank details falls through to the ordinary reply", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_BANK_PATH] = () => ok({ registered: false, customerCode: "DP00012", reply: { kind: "not_bank_details" } });
    server.routes[ASSISTANT_REGISTRATION_PATH] = () => ok({ customerId: "70001", customerCode: "DP00012", created: false });
    expect(await sentFor(server, privately("\u0111\u01a1n 2611010001 shopee giao ch\u01b0a", true))).toEqual([messageText("send_a_link")]);
    expect(server.callsTo(ASSISTANT_BANK_PATH)).toHaveLength(1);
    expect(server.callsTo(ASSISTANT_REGISTRATION_PATH)).toHaveLength(1);
  });

  it("AC2: a bank name matching two VietQR banks gets both listed to choose from", async () => {
    const server = fakeServer();
    answering(server, { kind: "choose_bank", banks: ["VPBank", "CAKE"] });
    const [text] = await sentFor(server, privately("/stk Cake by VPBank 0123456789 NGUYEN THI LAN"));
    expect(text).toBe(messageText("bank_choose", { banks: `${messageText("bank_choice_line", { bank: "VPBank" })}\n${messageText("bank_choice_line", { bank: "CAKE" })}` }));
    expect(text).toContain("VPBank");
    expect(text).toContain("CAKE");
  });

  it("AC3: a number against the rule gets the rule's message; each rule has its own sentence", async () => {
    const server = fakeServer();
    answering(server, { kind: "invalid", rule: "number" });
    expect(await sentFor(server, privately("/stk Vietcombank 123 NGUYEN THI LAN"))).toEqual([messageText("bank_rule_number")]);
    expect(messageText("bank_rule_number")).toMatch(/4 \u0111\u1ebfn 30/u);
    for (const rule of ["format", "holder", "bank"] as const) {
      const other = fakeServer();
      answering(other, { kind: "invalid", rule });
      expect(await sentFor(other, privately("/stk x 1 y"))).toEqual([messageText(`bank_rule_${rule}`)]);
    }
    const long = fakeServer();
    expect(await sentFor(long, privately(`/stk Vietcombank 0123456789 ${"A".repeat(250)}`))).toEqual([messageText("bank_rule_format")]);
    expect(long.callsTo(ASSISTANT_BANK_PATH)).toEqual([]);
  });

  it("AC4: the change message the server enqueues is sent with the new last four digits only", () => {
    const message = notificationMessage({ id: 1, dedupKey: "bank_account:P1.1:changed", zaloUserId: "70001", messageKey: "bank_changed", params: { bank: "Techcombank", lastFour: "6789" }, link: null });
    expect(message?.text).toBe(messageText("bank_changed", { bank: "Techcombank", lastFour: "6789" }));
    expect(message?.text).toContain("\u2022\u2022 6789");
  });

  it("AC5: bank details sent in the group are refused with the pointer to the private chat and never reach the server", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: null, reply: { kind: "private_only" } });
    expect(await sentFor(server, inGroup(`/stk ${AC1_DETAILS}`))).toEqual([`@Lan\n${messageText("command_private_only")}`]);
    expect(server.callsTo(ASSISTANT_BANK_PATH)).toEqual([]);
    expect(server.callsTo(ASSISTANT_COMMAND_PATH)).toEqual([{ zaloUserId: "70001", displayName: "Lan", chat: "group", command: "bank" }]);
    const quoted = fakeServer();
    expect(await sentFor(quoted, inGroup(AC1_DETAILS, true))).toEqual([]);
    expect(JSON.stringify([...server.calls, ...quoted.calls])).not.toMatch(/0123|nguyen/i);
  });
});
