import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { hashPassword } from "../src/modules/identity/domain/password-hash";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
     private_chat_id TEXT, display_name TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT,
     consent_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
     password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
     locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
     login_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  `CREATE TABLE customer_aliases (alias TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(customer_id),
     request_id TEXT, order_value INTEGER, estimated_commission INTEGER, approved_commission INTEGER,
     cashback_amount INTEGER, status TEXT NOT NULL, rejection_reason TEXT, recorded_at TEXT,
     approved_at TEXT, paid_at TEXT, updated_at TEXT NOT NULL, notified_status TEXT,
     platform TEXT NOT NULL DEFAULT 'shopee', settlement_status TEXT NOT NULL DEFAULT 'unsettled',
     payout_batch_id TEXT, settled_at TEXT)`,
  `CREATE TABLE state_history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL,
     from_status TEXT, to_status TEXT NOT NULL, changed_at TEXT NOT NULL, note TEXT)`,
];

const dbPath = join(tmpdir(), `cashback-orders-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const addCustomer = raw.prepare(
    "INSERT INTO customers (customer_id, role, status, created_at, password_hash) VALUES (?,?,?,?,?)",
  );
  addCustomer.run("ADMIN", "admin", "active", "2026-01-01T00:00:00", hashPassword("ADMINPASS", "s1"));
  addCustomer.run("C1", "user", "active", "2026-01-01T00:00:00", null);
  addCustomer.run("C2", "user", "active", "2026-01-01T00:00:00", null);

  const addOrder = raw.prepare(
    "INSERT INTO orders (order_id, customer_id, order_value, cashback_amount, status, recorded_at, updated_at)" +
      " VALUES (?,?,?,?,?,?,?)",
  );
  addOrder.run("O1", "C1", 450000, 9506, "approved", "2026-10-05T09:00:00", "2026-10-05T09:00:00");
  addOrder.run("O2", "C1", 300000, null, "awaiting_approval", "2026-10-06T09:00:00", "2026-10-06T09:00:00");
  addOrder.run("O3", "C2", 200000, null, "rejected", "2026-10-04T09:00:00", "2026-10-04T09:00:00");
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;

  const res = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { name: "ADMIN", password: "ADMINPASS" },
  });
  const header = res.headers["set-cookie"];
  cookie = String(Array.isArray(header) ? header[0] : header).split(";")[0] ?? "";
});

afterAll(async () => {
  await app?.close();
});

describe("GET /api/admin/orders", () => {
  it("requires an admin", async () => {
    expect((await server.inject({ method: "GET", url: "/api/admin/orders" })).statusCode).toBe(401);
  });

  it("lists orders newest first", async () => {
    const res = await server.inject({ method: "GET", url: "/api/admin/orders", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((o: { orderId: string }) => o.orderId)).toEqual(["O2", "O1", "O3"]);
  });

  it("filters by status", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/orders?status=approved",
      headers: { cookie },
    });
    expect(res.json().map((o: { orderId: string }) => o.orderId)).toEqual(["O1"]);
  });
});

describe("POST /api/admin/orders/mark-paid", () => {
  it("requires an admin", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/orders/mark-paid",
      payload: { customer_id: "C1", order_ids: ["O1"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("marks the approved orders and skips the rest", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/orders/mark-paid",
      headers: { cookie },
      payload: { customer_id: "C1", order_ids: ["O1", "O2", "MISSING"] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, paid: 1 });
    expect(res.json().skipped).toEqual(["O2", "MISSING"]);
  });

  it("never pays the same order twice", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/orders/mark-paid",
      headers: { cookie },
      payload: { customer_id: "C1", order_ids: ["O1"] },
    });

    expect(res.json()).toMatchObject({ ok: false, paid: 0 });
  });

  it("refuses an order that belongs to another customer", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/orders/mark-paid",
      headers: { cookie },
      payload: { customer_id: "C2", order_ids: ["O1"] },
    });

    expect(res.json()).toMatchObject({ ok: false, paid: 0 });
  });
});

describe("POST /api/admin/orders/settle", () => {
  it("requires an admin", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/orders/settle",
      payload: { batch_id: "B1", order_ids: ["O1"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("settles the given orders and never re-settles them", async () => {
    const payload = { batch_id: "B1", platform: "shopee", order_ids: ["O1"] };
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/orders/settle",
      headers: { cookie },
      payload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, settledCount: 1 });

    const again = await server.inject({
      method: "POST",
      url: "/api/admin/orders/settle",
      headers: { cookie },
      payload,
    });
    expect(again.json().settledCount).toBe(0);
  });
});
