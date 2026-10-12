import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createInternalApp } from "../src/create-app";
import { escapeHtml, loadMessages, render } from "../src/notifications";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
     display_name TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT, consent_at TEXT,
     status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, password_hash TEXT,
     password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
     role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT, login_count INTEGER NOT NULL DEFAULT 0)`,
];

const MESSAGES_PATH = fileURLToPath(new URL("../../../resources/messages.vi.json", import.meta.url));
const messages = loadMessages(MESSAGES_PATH);

const TOKEN = "test-assistant-token";
const DEV_CHAT = "111";
const BUSINESS_CHAT = "222";

const dbPath = join(tmpdir(), `cashback-alerts-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let realFetch: typeof fetch;
let previousEnv: Record<string, string | undefined>;

interface TelegramCall {
  url: string;
  chatId: string;
  text: string;
}

const sent: TelegramCall[] = [];

/** The message Telegram was just asked to deliver. */
function justSent(): TelegramCall {
  const call = sent[sent.length - 1];
  if (!call) throw new Error("nothing was sent to Telegram");
  return call;
}

async function alert(payload: object) {
  return server.inject({
    method: "POST",
    url: "/internal/alerts/telegram",
    headers: { "x-assistant-token": TOKEN },
    payload,
  });
}

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const addCustomer = raw.prepare("INSERT INTO customers (customer_id, display_name, created_at) VALUES (?,?,?)");
  addCustomer.run("C1", "Lan", "2026-01-01T00:00:00");
  addCustomer.run("C2", "Mai", "2026-01-01T00:00:00");
  raw.close();

  process.env.DB_PATH = dbPath;
  process.env.ASSISTANT_TOKEN = TOKEN;
  previousEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_DEV_CHAT_ID: process.env.TELEGRAM_DEV_CHAT_ID,
    TELEGRAM_BUSINESS_CHAT_ID: process.env.TELEGRAM_BUSINESS_CHAT_ID,
  };
  process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
  process.env.TELEGRAM_DEV_CHAT_ID = DEV_CHAT;
  process.env.TELEGRAM_BUSINESS_CHAT_ID = BUSINESS_CHAT;

  // The delivery port calls the real Telegram API; the test stands in for it.
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id?: unknown; text?: unknown };
    sent.push({ url: String(url), chatId: String(body.chat_id ?? ""), text: String(body.text ?? "") });
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  }) as typeof fetch;

  app = await createInternalApp();
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await app?.close();
});

beforeEach(() => {
  sent.length = 0;
});

describe("POST /internal/alerts/telegram", () => {
  it("needs the assistant token", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/internal/alerts/telegram",
      payload: { alert_type: "bug_report" },
    });
    expect(res.statusCode).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("refuses an alert type it does not know", async () => {
    const res = await alert({ alert_type: "not_a_thing" });
    expect(res.statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("sends a bug report to the dev group, escaped", async () => {
    const res = await alert({
      alert_type: "bug_report",
      title: "Worker crashed",
      details: "<script>alert(1)</script>",
      severity: "CRITICAL",
      source: "zalo_assistant/assistant_worker.js",
      action_needed: "restart the worker",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, sent: true });
    expect(sent).toHaveLength(1);

    const call = justSent();
    expect(call.url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    expect(call.chatId).toBe(DEV_CHAT);
    expect(call.text).toContain(render(messages, "telegram_bug_critical", { title: "Worker crashed" }));
    expect(call.text).toContain(
      render(messages, "telegram_bug_source", { source: "zalo_assistant/assistant_worker.js" }),
    );
    expect(call.text).toContain(
      render(messages, "telegram_bug_details", { details: escapeHtml("<script>alert(1)</script>") }),
    );
    expect(call.text).toContain(render(messages, "telegram_bug_action", { action: "restart the worker" }));
    expect(call.text).not.toContain("<script>");
  });

  it("pauses a repeated alert, and lets force through", async () => {
    const payload = { alert_type: "bug_report", title: "Flaky", details: "keeps happening", severity: "HIGH" };
    expect((await alert(payload)).json()).toEqual({ ok: true, sent: true });

    const again = await alert(payload);
    expect(again.json()).toEqual({ ok: true, suppressed: true });
    expect(sent).toHaveLength(1);

    const forced = await alert({ ...payload, force: true });
    expect(forced.json()).toEqual({ ok: true, sent: true });
    expect(sent).toHaveLength(2);
  });

  it("falls back to a generic warning when no type is given", async () => {
    const res = await alert({ details: "something odd" });
    expect(res.statusCode).toBe(201);
    expect(justSent().chatId).toBe(DEV_CHAT);
    expect(justSent().text).toContain(
      render(messages, "telegram_bug_warning", { title: render(messages, "telegram_custom_default_title") }),
    );
  });

  it("sends a new member to the business group with the customer count", async () => {
    const res = await alert({
      alert_type: "member_joined",
      display_name: "Hoa",
      member_rank: 7,
      group_name: "Nhom Chinh",
      zalo_uid: "Z900",
    });
    expect(res.statusCode).toBe(201);
    expect(justSent().chatId).toBe(BUSINESS_CHAT);

    const text = justSent().text;
    expect(text).toContain(render(messages, "telegram_member_header"));
    expect(text).toContain(render(messages, "telegram_member_name", { name: "Hoa" }));
    expect(text).toContain(render(messages, "telegram_member_rank", { rank: 7, group: "Nhom Chinh" }));
    expect(text).toContain(render(messages, "telegram_member_total", { total: 2 }));
    expect(text).toContain(render(messages, "telegram_member_uid", { uid: "Z900" }));
  });

  it("stays quiet about a recovery when nothing was broken", async () => {
    const res = await alert({ alert_type: "zalo_recovered" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, suppressed: true });
    expect(sent).toHaveLength(0);
  });

  it("reports a Zalo conflict, then the recovery, then stays quiet", async () => {
    const conflict = await alert({ alert_type: "zalo_conflict", reconnect_count: 4, reason: "session stolen" });
    expect(conflict.statusCode).toBe(201);
    expect(justSent().chatId).toBe(DEV_CHAT);
    expect(justSent().text).toContain(render(messages, "telegram_conflict_title"));
    expect(justSent().text).toContain(
      render(messages, "telegram_conflict_details", { count: 4, reason: "session stolen" }),
    );

    const recovered = await alert({ alert_type: "zalo_recovered" });
    expect(recovered.json()).toEqual({ ok: true, sent: true });
    expect(sent).toHaveLength(2);
    expect(justSent().text).toContain(render(messages, "telegram_conflict_recovered_title"));

    const again = await alert({ alert_type: "zalo_recovered" });
    expect(again.json()).toEqual({ ok: true, suppressed: true });
    expect(sent).toHaveLength(2);
  });

  it("alerts the owner when the Chrome bridge drops", async () => {
    const res = await alert({ alert_type: "shopee_bridge" });
    expect(res.statusCode).toBe(201);
    expect(justSent().chatId).toBe(DEV_CHAT);
    expect(justSent().text).toContain(render(messages, "telegram_bridge_title"));
  });

  it("accepts a captcha report with the page it happened on", async () => {
    const res = await alert({ alert_type: "shopee_captcha", current_url: "https://affiliate.shopee.vn/verify/1" });
    expect(res.statusCode).toBe(201);
    expect(justSent().text).toContain(render(messages, "telegram_captcha_title"));
    expect(justSent().text).toContain(
      render(messages, "telegram_captcha_details", { url: "https://affiliate.shopee.vn/verify/1" }),
    );
  });

  it("sends a caller-defined alert under its own key", async () => {
    const res = await alert({
      alert_type: "custom",
      key: "disk_full",
      title: "Disk nearly full",
      details: "89% used",
      force: true,
    });
    expect(res.statusCode).toBe(201);
    expect(justSent().chatId).toBe(DEV_CHAT);
    expect(justSent().text).toContain(render(messages, "telegram_bug_warning", { title: "Disk nearly full" }));
  });
});
