/**
 * The Telegram notice to the DP Business group when someone joins the Zalo group (D64): the live
 * wording, escaped, sent per member behind the assistant token, with nothing stored or logged.
 */
import { ASSISTANT_GROUP_JOIN_PATH } from "@cashback/contracts";
import { parseInstant, type Clock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { assistantGroupJoinRoutes } from "../src/modules/operations/index";
import { memberJoinedText } from "../src/modules/operations/member-joined-notice.query";
import { ASSISTANT_TOKEN_HEADER, INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { memoryLogger } from "./helpers/link-ledger";
import { closeLedgers, freshLedger } from "./helpers/order-ledger";

const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);
const AT = parseInstant("2026-10-30T07:00:00.000Z");
const CLOCK = { now: () => AT } as unknown as Clock;

/** Rendered by the live `notify_new_member_joined` at 14:00:00 on 30/10/2026 (Vietnam time). */
const LIVE =
  "🎉 <b>[THÀNH VIÊN MỚI GIA NHẬP ZALO]</b>\n\n👤 <b>Tên:</b> <b>Nguyen &lt;Lan&gt;</b>\n👥 <b>Thứ tự trong nhóm:</b> Là thành viên thứ <b>#42</b> của nhóm <i>Hoàn Tiền Shopee</i>\n🌐 <b>Tổng khách hệ thống:</b> <b>7</b> khách hàng\n🆔 <b>Zalo UID:</b> <code>70001</code>\n⏱ <b>Thời gian:</b> <code>14:00:00 - 30/10/2026</code>";

const FACTS = { name: "Nguyen <Lan>", userId: "70001", groupName: "Hoàn Tiền Shopee", memberCount: 42, totalCustomers: 7, at: AT };
const BODY = { groupName: "Hoàn Tiền Shopee", memberCount: 42, members: [{ userId: "70001", name: "Lan" }, { userId: "70002", name: "Minh" }] };

let servers: Servers | null = null;
afterEach(async () => {
  if (servers !== null) await close(servers);
  servers = null;
  closeLedgers();
});

function build(send: ((text: string) => Promise<void>) | null) {
  servers = buildServers({ clock: CLOCK, internalToken: INTERNAL, assistantToken: ASSISTANT, internal: [assistantGroupJoinRoutes({ ledger: freshLedger(), clock: CLOCK, sender: send === null ? null : { send } })] });
  const post = (headers: Record<string, string>, payload: unknown = BODY) => (servers as Servers).internalApp.inject({ method: "POST", url: ASSISTANT_GROUP_JOIN_PATH, headers, payload: payload as object });
  return { post };
}

const TOKEN = { [ASSISTANT_TOKEN_HEADER]: ASSISTANT };

describe("the member joined text (D64)", () => {
  it("is the live text, character for character, with the name escaped", () => {
    expect(memberJoinedText(FACTS)).toBe(LIVE);
  });

  it("keeps a name on one line, so it cannot add lines that look like the notice's own", () => {
    const text = memberJoinedText({ ...FACTS, name: "Lan\n🆔 Zalo UID: 999\u2028x" });
    expect(text).toContain("<b>Lan 🆔 Zalo UID: 999 x</b>");
    expect(text.split("\n")).toHaveLength(LIVE.split("\n").length);
  });

  it("leaves out the rank when the count is unknown and the total when zero", () => {
    const text = memberJoinedText({ ...FACTS, memberCount: null, totalCustomers: 0 });
    expect(text).not.toContain("#");
    expect(text).not.toContain("<i>");
    expect(text).not.toContain("</b> khách hàng");
    expect(text).toContain("<code>70001</code>");
  });
});

describe("POST group-joins (D64)", () => {
  it("sends one message per member and counts them", async () => {
    const sent: string[] = [];
    const { post } = build(async (text) => void sent.push(text));
    const response = await post(TOKEN);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sent: 2 });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("<b>Lan</b>");
    expect(sent[1]).toContain("<code>70002</code>");
  });

  it("sends nothing without the bot or the chat", async () => {
    const { post } = build(null);
    expect((await post(TOKEN)).json()).toEqual({ sent: 0 });
  });

  it("a failed send answers 200, counts only the sent and goes on to the next member", async () => {
    const sent: string[] = [];
    const { post } = build(async (text) => {
      if (text.includes("Lan")) throw new Error("telegram: HTTP 403");
      sent.push(text);
    });
    const response = await post(TOKEN);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sent: 1 });
    expect(sent).toHaveLength(1);
  });

  it("a failed send logs its status, and no name or Zalo id reaches a log line", async () => {
    const { logger, lines } = memoryLogger();
    const failing = Object.assign(new Error("telegram"), { status: 403 });
    servers = buildServers({ clock: CLOCK, internalToken: INTERNAL, assistantToken: ASSISTANT, logger, internal: [assistantGroupJoinRoutes({ ledger: freshLedger(), clock: CLOCK, sender: { send: async () => Promise.reject(failing) } })] });
    await servers.internalApp.inject({ method: "POST", url: ASSISTANT_GROUP_JOIN_PATH, headers: TOKEN, payload: BODY });
    expect(lines.some((l) => l.includes("operations.member_joined.delivery_failed") && l.includes('"status":403'))).toBe(true);
    for (const secret of ["Lan", "Minh", "70001", "70002"]) expect(lines.join("")).not.toContain(secret);
  });

  it("needs the assistant token: without it, or with the internal one, nothing is sent", async () => {
    const sent: string[] = [];
    const { post } = build(async (text) => void sent.push(text));
    expect((await post({})).statusCode).toBe(401);
    expect((await post({ [INTERNAL_TOKEN_HEADER]: INTERNAL })).statusCode).toBe(401);
    expect(sent).toEqual([]);
  });

  it("refuses a body that is not the contract", async () => {
    const sent: string[] = [];
    const { post } = build(async (text) => void sent.push(text));
    expect((await post(TOKEN, { ...BODY, members: [] })).statusCode).toBe(400);
    expect((await post(TOKEN, { ...BODY, extra: 1 })).statusCode).toBe(400);
    expect(sent).toEqual([]);
  });
});
