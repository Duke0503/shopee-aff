/**
 * Message parity with the live system (owner requirement 2026-11-02, docs/operations/message-parity.md).
 * tests/fixtures/old-messages.json holds what the live bot and backend sent for fixed inputs,
 * composed by their own code on main, with the bold ranges the live bot computed and its mentions.
 * Each case is rendered here from the same facts through the new code: the text must be the same
 * string, every UTF-16 code unit the live bot made bold must be bold (and no other), and a group
 * reply's tag must be the same mention. Two cases differ on purpose and say so: the doubled word in
 * the live "recorded" notice, and the payout message's last line ("User: @name").
 */
import type { AssistantCommandReply, AssistantLinkReply, AssistantNotification } from "@cashback/contracts";
import { parseInstant, systemClock, toMs } from "@cashback/core";
import messages from "@cashback/labels/vi/messages.json" with { type: "json" };
import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { startAssistant } from "../src/assistant";
import { commandReplyMessage } from "../src/chat-command";
import { fakeZaloSession } from "../src/fake-zalo.adapter";
import { welcomeMessage } from "../src/group-welcome";
import { internalApi } from "../src/internal-api.adapter";
import { linkReplyMessage } from "../src/link-reply-text";
import { styledMessage, type MessageKey } from "../src/messages";
import { notificationMessage } from "../src/notification-text";
import { timerSleep } from "../src/pacer";
import { balancedMarkup, renderStyled, shiftStyles, type StyledText, type TextStyle } from "../src/styled-text";
import { BASE, fakeServer, ok, TOKEN } from "./fake-server";

interface OldCase {
  readonly name: string;
  readonly source: string;
  readonly kind: "link" | "key" | "command" | "notification" | "welcome";
  readonly text: string;
  readonly liveText?: string;
  readonly bold: readonly (readonly [number, number])[];
  readonly mentions: readonly { readonly userId?: string; readonly pos: number; readonly len: number }[];
  readonly tag?: { readonly userId: string; readonly name: string };
  readonly facts?: AssistantLinkReply & { shareUrl: string };
  readonly key?: string;
  readonly values?: Record<string, string>;
  readonly reply?: AssistantCommandReply;
  readonly context?: { readonly name: string; readonly now?: string };
  readonly notification?: AssistantNotification;
  readonly members?: readonly { readonly userId: string; readonly name: string | null }[];
}

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "old-messages.json"), "utf8")) as { cases: OldCase[] };
const DEV_GROUP = "8786316503449470342";

/** The UTF-16 code units the ranges cover: two style lists look the same when these match. */
const covered = (ranges: readonly (readonly [number, number])[]): number[] => [...new Set(ranges.flatMap(([start, len]) => Array.from({ length: len }, (_, i) => start + i)))].sort((a, b) => a - b);
const rangesOf = (styles: readonly TextStyle[]): [number, number][] => styles.map((s) => [s.start, s.len]);

/** What the assistant sends for one case: text, styles and mentions, the group tag written as assistant.ts writes it. */
function rendered(c: OldCase): { text: string; styles: readonly TextStyle[]; mentions: readonly { userId?: string; pos: number; len: number }[] } {
  if (c.kind === "welcome") {
    const { message, mentions } = welcomeMessage(c.members ?? [], c.key as MessageKey);
    return { text: message.text, styles: message.styles, mentions };
  }
  const reply =
    c.kind === "link" ? linkReplyMessage(c.facts as AssistantLinkReply & { shareUrl: string })
    : c.kind === "command" ? commandReplyMessage(c.reply as AssistantCommandReply, { name: c.context?.name ?? "", now: parseInstant(c.context?.now ?? "2026-11-01T03:00:00.000Z") })
    : c.kind === "notification" ? notificationMessage(c.notification as AssistantNotification)
    : { key: c.key as MessageKey, values: c.values ?? {} };
  if (reply === null) throw new Error(`${c.name}: no message`);
  const message: StyledText = styledMessage(reply.key, reply.values);
  if (c.tag === undefined) return { text: message.text, styles: message.styles, mentions: [] };
  const mark = `@${c.tag.name}`;
  return { text: `${mark}\n${message.text}`, styles: shiftStyles(message.styles, mark.length + 1), mentions: [{ pos: 0, len: mark.length }] };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("message parity: every message reads and looks as the live system's", () => {
  it("the fixture covers the link replies, refusals, commands, notices, the payout and the group welcomes", () => {
    expect(FIXTURE.cases.length).toBeGreaterThanOrEqual(35);
    expect(new Set(FIXTURE.cases.map((c) => c.kind))).toEqual(new Set(["link", "key", "command", "notification", "welcome"]));
  });

  for (const c of FIXTURE.cases) {
    it(`${c.name} (${c.source})`, () => {
      const out = rendered(c);
      expect(out.text).toBe(c.text);
      expect(covered(rangesOf(out.styles))).toEqual(covered(c.bold));
      expect(out.styles.every((s) => s.st === "b")).toBe(true);
      expect(out.mentions.map((m) => ({ pos: m.pos, len: m.len }))).toEqual(c.mentions.map((m) => ({ pos: m.pos, len: m.len })));
      if (c.kind === "welcome") expect(out.mentions.map((m) => m.userId)).toEqual(c.mentions.map((m) => m.userId));
    });
  }

  it("the two deliberate differences from the live text are only the doubled word and the payout's user line", () => {
    const recorded = FIXTURE.cases.find((c) => c.notification?.messageKey === "notice_order_recorded");
    expect(recorded?.liveText?.replace("kho\u1ea3ng kho\u1ea3ng", "kho\u1ea3ng")).toBe(recorded?.text);
    const payout = FIXTURE.cases.find((c) => c.notification?.messageKey === "payout_recorded");
    expect(payout?.liveText?.startsWith(`${payout.text}\n`)).toBe(true);
    expect(payout?.liveText?.split("\n").length).toBe((payout?.text.split("\n").length ?? 0) + 1);
  });
});

describe("text styles: bold from the label markup, in UTF-16 offsets, beside mentions", () => {
  it("every label has balanced bold markers and renders with all its placeholders", () => {
    for (const [key, template] of Object.entries(messages as Record<string, string>)) {
      expect(balancedMarkup(template), key).toBe(true);
      const styled = renderStyled(template, () => "x");
      expect(styled.text, key).not.toContain("**");
    }
  });

  it("offsets count UTF-16 code units: an emoji before a bold run moves it by two", () => {
    const styled = renderStyled("\ud83c\udf89 **ab** {v} **c{w}d**", (name) => (name === "v" ? "\u00e1\u00e1" : "XY"));
    expect(styled.text).toBe("\ud83c\udf89 ab \u00e1\u00e1 cXYd");
    expect(styled.styles).toEqual([
      { start: 3, len: 2, st: "b" },
      { start: 9, len: 4, st: "b" },
    ]);
  });

  it("a value can never open or close a style; a styled value keeps its ranges where it lands; broken markup throws", () => {
    expect(renderStyled("{v} **x**", () => "**not bold**").styles).toEqual([{ start: 13, len: 1, st: "b" }]);
    const inner: StyledText = { text: "ab", styles: [{ start: 1, len: 1, st: "b" }] };
    expect(renderStyled("12{v}", () => inner)).toEqual({ text: "12ab", styles: [{ start: 3, len: 1, st: "b" }] });
    expect(() => renderStyled("**open", () => "")).toThrow();
  });

  it("a group reply through the assistant carries the tag as a mention and the bold runs moved past it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(toMs(parseInstant("2026-11-01T03:00:00.000Z")));
    const server = fakeServer();
    server.routes["/internal/assistant/commands"] = () => ok({ registered: false, customerCode: "DP00001", reply: { kind: "help" } });
    const zalo = fakeZaloSession(systemClock);
    const assistant = startAssistant({ zalo, api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }), clock: systemClock, sleep: timerSleep, sendDelay: { minMs: 6_000, maxMs: 12_000 }, zaloGroupIds: [DEV_GROUP], friendRequestsPerDay: 30, onError: () => undefined, random: () => 0 });
    const done = zalo.deliver({ chat: { kind: "group", groupId: DEV_GROUP }, senderId: "70001", senderName: "Lan", text: "/help" });
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    await assistant.stop();
    const help = FIXTURE.cases.find((c) => c.key === "command_help");
    const sent = zalo.sent[0];
    expect(sent?.text).toBe(help?.text);
    expect(sent?.mentions).toEqual([{ userId: "70001", pos: 0, len: 4 }]);
    expect(covered(rangesOf(sent?.styles ?? []))).toEqual(covered(help?.bold ?? []));
  });
});
