import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInternalApp } from "../src/create-app";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
     private_chat_id TEXT, display_name TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT,
     consent_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
     password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
     locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
     login_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE customer_aliases (alias TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE customer_code_counter (id INTEGER PRIMARY KEY CHECK (id = 1), last INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO customer_code_counter (id, last) VALUES (1, 0)`,
  `CREATE TRIGGER trg_customer_code AFTER INSERT ON customers
     WHEN NEW.customer_code IS NULL AND COALESCE(NEW.role, 'user') NOT IN ('admin','employee','house')
   BEGIN
     UPDATE customer_code_counter SET last = last + 1 WHERE id = 1;
     UPDATE customers SET customer_code = 'DP' || printf('%05d',
       (SELECT last FROM customer_code_counter WHERE id = 1))
     WHERE rowid = NEW.rowid;
   END`,
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT, request_id TEXT,
     order_value INTEGER, estimated_commission INTEGER, approved_commission INTEGER,
     cashback_amount INTEGER, status TEXT NOT NULL, rejection_reason TEXT, recorded_at TEXT,
     approved_at TEXT, paid_at TEXT, updated_at TEXT NOT NULL, notified_status TEXT,
     platform TEXT NOT NULL DEFAULT 'shopee', settlement_status TEXT NOT NULL DEFAULT 'unsettled',
     payout_batch_id TEXT, settled_at TEXT)`,
];

const TOKEN = "test-assistant-token";
const dbPath = join(tmpdir(), `cashback-internal-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;

const auth = { "x-assistant-token": TOKEN };

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const addCustomer = raw.prepare(
    "INSERT INTO customers (customer_id, customer_code, display_name, role, created_at)" +
      " VALUES (?,?,?,?,?)",
  );
  addCustomer.run("C1", "DP00012", "Lan", "user", "2026-01-01T00:00:00");
  addCustomer.run("HOUSE", null, null, "house", "2026-01-01T00:00:00");
  raw
    .prepare("INSERT INTO customer_aliases (alias, customer_id, created_at) VALUES (?,?,?)")
    .run("OLD1", "C1", "2026-01-01T00:00:00");

  const addOrder = raw.prepare(
    "INSERT INTO orders (order_id, customer_id, order_value, approved_commission, cashback_amount," +
      " status, recorded_at, paid_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  addOrder.run("O1", "C1", 450_000, null, null, "awaiting_approval", "2026-10-05T09:00:00", null, "2026-10-05T09:00:00");
  addOrder.run("O2", "C1", 600_000, 12_000, 9_506, "approved", "2026-10-06T09:00:00", null, "2026-10-06T09:00:00");
  addOrder.run("O3", "C1", 200_000, 5_000, 3_960, "paid", "2026-10-04T09:00:00", "2026-10-07T09:00:00", "2026-10-07T09:00:00");
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

describe("the internal assistant listener", () => {
  it("refuses a call with no token", async () => {
    expect((await server.inject({ method: "GET", url: "/internal/customers/DP00012" })).statusCode).toBe(401);
  });

  it("refuses a wrong token", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/internal/customers/DP00012",
      headers: { "x-assistant-token": "nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("resolves a customer from a DP code", async () => {
    const res = await server.inject({ method: "GET", url: "/internal/customers/DP00012", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      customerId: "C1",
      customerCode: "DP00012",
      displayName: "Lan",
      role: "user",
    });
  });

  it("resolves an old id through the alias table", async () => {
    const res = await server.inject({ method: "GET", url: "/internal/customers/OLD1", headers: auth });
    expect(res.json().customerId).toBe("C1");
  });

  it("404s on a code nobody owns", async () => {
    const res = await server.inject({ method: "GET", url: "/internal/customers/DP99999", headers: auth });
    expect(res.statusCode).toBe(404);
  });

  it("registers a person the assistant has just met, with a code from the database", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/internal/customers",
      headers: auth,
      payload: { zaloUserId: "555000111", displayName: "New Person" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      customerId: "555000111",
      customerCode: "DP00001",
      role: "user",
      created: true,
    });
  });

  it("returns the same customer on a second contact, never a second row", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/internal/customers",
      headers: auth,
      payload: { zaloUserId: "555000111", displayName: "New Person" },
    });
    expect(res.json()).toMatchObject({ customerId: "555000111", created: false });
  });

  it("needs a Zalo id to register anyone", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/internal/customers",
      headers: auth,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("issues a password that is returned once and never stored in the clear", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/internal/customers/DP00012/password",
      headers: auth,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { password: string };
    expect(body.password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

    const raw = new Database(dbPath, { readonly: true });
    const row = raw
      .prepare("SELECT password_hash, password_set_at FROM customers WHERE customer_id = 'C1'")
      .get() as { password_hash: string; password_set_at: string | null };
    raw.close();
    expect(row.password_hash.startsWith("pbkdf2$")).toBe(true);
    expect(row.password_hash).not.toContain(body.password);
    expect(row.password_set_at).not.toBeNull();
  });

  it("returns the customer's orders, newest purchase first", async () => {
    const res = await server.inject({ method: "GET", url: "/internal/customers/DP00012/orders", headers: auth });
    const orders = res.json();
    expect(orders.map((order: { orderId: string }) => order.orderId)).toEqual(["O2", "O1", "O3"]);
    expect(orders[0]).toMatchObject({ status: "approved", cashbackVnd: 9506, orderValueVnd: 600000 });
  });

  it("returns the customer's balance", async () => {
    const res = await server.inject({ method: "GET", url: "/internal/customers/DP00012/balance", headers: auth });
    expect(res.json().approvedWaitingVnd).toBe(9506);
  });

  it("saves bank details for a real customer", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/internal/customers/DP00012/bank",
      headers: auth,
      payload: { bankName: "VCB", bankAccount: "123", accountHolder: "LAN" },
    });
    expect(res.statusCode).toBe(201);
    const raw = new Database(dbPath, { readonly: true });
    const saved = raw.prepare("SELECT bank_account, consent_at FROM customers WHERE customer_id = 'C1'").get();
    raw.close();
    expect(saved).toMatchObject({ bank_account: "123" });
    expect((saved as { consent_at: string }).consent_at).not.toBeNull();
  });

  it("refuses to store bank details for the guest account", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/internal/customers/HOUSE/bank",
      headers: auth,
      payload: { bankName: "VCB", bankAccount: "123" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("reads back the bank details it stored", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/internal/customers/DP00012/bank",
      headers: auth,
    });
    expect(res.json()).toMatchObject({ hasBank: true, bankName: "VCB", bankAccount: "123" });
  });

  it("reports no bank details for someone who has none", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/internal/customers/HOUSE/bank",
      headers: auth,
    });
    expect(res.json()).toMatchObject({ hasBank: false, bankAccount: null });
  });
});
