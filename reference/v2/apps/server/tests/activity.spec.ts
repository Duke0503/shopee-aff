import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInternalApp } from "../src/create-app";
import { loadMessages, render } from "../src/notifications";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
     private_chat_id TEXT, display_name TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT,
     consent_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
     password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
     locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
     login_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE customer_aliases (alias TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT, action TEXT NOT NULL,
     path TEXT, ip_address TEXT, user_agent TEXT, detail TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE group_info (group_id TEXT PRIMARY KEY, group_name TEXT NOT NULL,
     total_members INTEGER NOT NULL, updated_at TEXT NOT NULL)`,
];

const MESSAGES_PATH = fileURLToPath(new URL("../../../resources/messages.vi.json", import.meta.url));
const messages = loadMessages(MESSAGES_PATH);

const TOKEN = "test-assistant-token";
const dbPath = join(tmpdir(), `cashback-activity-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;

const auth = { "x-assistant-token": TOKEN };

async function post(url: string, payload: object) {
  return server.inject({ method: "POST", url, headers: auth, payload });
}

function open(): Database.Database {
  return new Database(dbPath, { readonly: true });
}

function customer(id: string) {
  const db = open();
  const row = db.prepare("SELECT * FROM customers WHERE customer_id = ?").get(id) as Record<string, unknown>;
  db.close();
  return row;
}

function logs(customerId: string, action: string): number {
  const db = open();
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE customer_id = ? AND action = ?")
    .get(customerId, action) as { n: number };
  db.close();
  return row.n;
}

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  raw
    .prepare("INSERT INTO customers (customer_id, display_name, role, status, created_at) VALUES (?,?,?,?,?)")
    .run("C1", "Lan", "user", "active", "2026-01-01T00:00:00");
  raw.close();

  process.env.DB_PATH = dbPath;
  process.env.ASSISTANT_TOKEN = TOKEN;
  app = await createInternalApp();
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
});

afterAll(async () => {
  await app?.close();
});

describe("POST /internal/activity/log", () => {
  it("needs the assistant token", async () => {
    const res = await server.inject({ method: "POST", url: "/internal/activity/log", payload: { action: "x" } });
    expect(res.statusCode).toBe(401);
  });

  it("records one activity row, stringifying the detail", async () => {
    const res = await post("/internal/activity/log", {
      action: "link_created",
      customer_id: "C1",
      path: "/api/shopee/convert",
      detail: { link: "https://aff/x" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, action: "link_created" });

    const db = open();
    const row = db
      .prepare("SELECT action, customer_id, path, detail, created_at FROM activity_logs WHERE action = ?")
      .get("link_created") as Record<string, string>;
    db.close();
    expect(row).toMatchObject({
      customer_id: "C1",
      path: "/api/shopee/convert",
      detail: '{"link":"https://aff/x"}',
    });
    expect(row.created_at).not.toBe("");
  });

  it("needs an action", async () => {
    expect((await post("/internal/activity/log", { customer_id: "C1" })).statusCode).toBe(400);
  });

  it("remembers someone on a group join, and never overwrites them", async () => {
    const first = await post("/internal/activity/log", {
      action: "group_join",
      customer_id: "NEW1",
      display_name: "Nguoi Moi",
    });
    expect(first.statusCode).toBe(201);
    expect(customer("NEW1")).toMatchObject({
      display_name: "Nguoi Moi",
      zalo_user_id: "NEW1",
      role: "user",
      status: "active",
    });

    await post("/internal/activity/log", { action: "group_join", customer_id: "NEW1", display_name: "Other" });
    expect(customer("NEW1").display_name).toBe("Nguoi Moi");
  });
});

describe("POST /internal/activity/group-info", () => {
  it("records the group size and replaces it on the next report", async () => {
    const first = await post("/internal/activity/group-info", {
      group_id: "G1",
      group_name: "Nhom A",
      total_members: 10,
    });
    expect(first.json()).toEqual({ ok: true, groupId: "G1", groupName: "Nhom A", totalMembers: 10 });

    await post("/internal/activity/group-info", { group_id: "G1", group_name: "Nhom A", total_members: 12 });
    const db = open();
    const rows = db.prepare("SELECT group_name, total_members FROM group_info WHERE group_id = 'G1'").all();
    db.close();
    expect(rows).toEqual([{ group_name: "Nhom A", total_members: 12 }]);
  });

  it("falls back to the wording in the message file and the default size", async () => {
    const res = await post("/internal/activity/group-info", { group_id: "G2" });
    const expected = render(messages, "group_default_name");
    expect(res.json()).toEqual({ ok: true, groupId: "G2", groupName: expected, totalMembers: 33 });
  });

  it("needs a group id", async () => {
    expect((await post("/internal/activity/group-info", { group_name: "x" })).statusCode).toBe(400);
  });
});

describe("POST /internal/activity/sync-group-members", () => {
  it("needs a member list", async () => {
    expect((await post("/internal/activity/sync-group-members", { group_id: "G1", members: [] })).statusCode).toBe(400);
  });

  it("creates the new, fills a blank field once, and logs each join exactly once", async () => {
    const res = await post("/internal/activity/sync-group-members", {
      group_id: "G1",
      group_name: "Nhom A",
      members: [
        { uid: "C1", name: "Lan N." },
        { uid: "NEW2", name: "Mai" },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, syncedCount: 1, total: 2 });

    // A name that was already set is not overwritten; the missing Zalo id is filled.
    expect(customer("C1")).toMatchObject({ display_name: "Lan", zalo_user_id: "C1" });
    expect(customer("NEW2")).toMatchObject({ display_name: "Mai", zalo_user_id: "NEW2", role: "user" });

    const db = open();
    const group = db.prepare("SELECT total_members FROM group_info WHERE group_id = 'G1'").get() as {
      total_members: number;
    };
    db.close();
    expect(group.total_members).toBe(3);

    expect(logs("C1", "group_join")).toBe(1);
    expect(logs("NEW2", "group_join")).toBe(1);

    // A second sync is safe: nobody is duplicated and no log is written twice.
    const again = await post("/internal/activity/sync-group-members", {
      group_id: "G1",
      group_name: "Nhom A",
      members: [{ uid: "C1", name: "Lan N." }, { uid: "NEW2", name: "Mai" }],
    });
    expect(again.json()).toEqual({ ok: true, syncedCount: 0, total: 2 });
    expect(logs("C1", "group_join")).toBe(1);
    expect(logs("NEW2", "group_join")).toBe(1);
  });

  it("gives a nameless member a name from the message file", async () => {
    await post("/internal/activity/sync-group-members", {
      group_id: "G1",
      group_name: "Nhom A",
      members: [{ uid: "123456", name: "" }],
    });
    const expected = render(messages, "group_member_default_name", { suffix: "3456" });
    expect(customer("123456").display_name).toBe(expected);
  });
});
