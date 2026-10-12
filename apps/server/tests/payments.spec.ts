import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
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
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT, request_id TEXT,
     order_value INTEGER, estimated_commission INTEGER, approved_commission INTEGER,
     cashback_amount INTEGER, status TEXT NOT NULL, rejection_reason TEXT, recorded_at TEXT,
     approved_at TEXT, paid_at TEXT, updated_at TEXT NOT NULL, notified_status TEXT,
     platform TEXT NOT NULL DEFAULT 'shopee', settlement_status TEXT NOT NULL DEFAULT 'unsettled',
     payout_batch_id TEXT, settled_at TEXT)`,
  `CREATE TABLE state_history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL,
     from_status TEXT, to_status TEXT NOT NULL, changed_at TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE payment_transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL,
     amount INTEGER NOT NULL, transfer_code TEXT, note TEXT, proof_image TEXT, order_ids TEXT,
     created_at TEXT NOT NULL, created_by TEXT, notify_mode TEXT, notified_at TEXT, target_group TEXT, bill_token TEXT)`,
  `CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
     customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT, voided_at TEXT, notified_status TEXT)`,
];

const dbPath = join(tmpdir(), `cashback-payments-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let cookie: string;
let fakeAssistant: Server;
const assistantCalls: Array<{ url?: string; token?: unknown; body: unknown }> = [];

async function login(name: string, password: string): Promise<string> {
  const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { name, password } });
  const header = res.headers["set-cookie"];
  return String(Array.isArray(header) ? header[0] : header).split(";")[0] ?? "";
}

beforeAll(async () => {
  fakeAssistant = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      assistantCalls.push({
        url: req.url,
        token: req.headers["x-assistant-token"],
        body: raw ? JSON.parse(raw) : null,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => fakeAssistant.listen(0, "127.0.0.1", resolve));
  const address = fakeAssistant.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.env.ASSISTANT_URL = `http://127.0.0.1:${port}`;
  process.env.ASSISTANT_TOKEN = "test-token";

  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const addCustomer = raw.prepare(
    "INSERT INTO customers (customer_id, customer_code, display_name, zalo_user_id, bank_name," +
      " bank_account, account_holder, role, status, created_at, password_hash)" +
      " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  );
  addCustomer.run(
    "ADMIN",
    null,
    null,
    null,
    null,
    null,
    null,
    "admin",
    "active",
    "2026-01-01T00:00:00",
    hashPassword("ADMINPASS", "s1"),
  );
  addCustomer.run("C1", "DP1", "An", "Z1", "Vietcombank", "123", "AN", "user", "active", "2026-01-02T00:00:00", null);
  addCustomer.run("C2", null, null, null, null, null, null, "user", "active", "2026-01-03T00:00:00", null);

  const addOrder = raw.prepare(
    "INSERT INTO orders (order_id, customer_id, cashback_amount, status, updated_at) VALUES (?,?,?,?,?)",
  );
  addOrder.run("O1", "C1", 9506, "approved", "2026-10-05T09:00:00");
  addOrder.run("O2", "C1", 5000, "approved", "2026-10-05T09:00:00");
  addOrder.run("O3", "C2", 4000, "approved", "2026-10-05T09:00:00");
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
  cookie = await login("ADMIN", "ADMINPASS");
});

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => fakeAssistant.close(() => resolve()));
});

describe("GET /api/admin/payments", () => {
  it("requires staff", async () => {
    expect((await server.inject({ method: "GET", url: "/api/admin/payments" })).statusCode).toBe(401);
  });

  it("shows who can be paid and who is blocked", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/payments",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    // The row carries the identity the owner must check before sending money.
    expect(res.json().payables.ready).toEqual([
      {
        customerId: "C1",
        customerCode: "DP1",
        displayName: "An",
        bankName: "Vietcombank",
        bankAccount: "123",
        accountHolder: "AN",
        amountVnd: 14506,
        blockedReason: null,
        bankChangedRecently: false,
      },
    ]);
    expect(res.json().payables.blocked.map((p: { customerId: string }) => p.customerId)).toEqual(["C2"]);
    expect(res.json().transfers).toEqual([]);
  });
});

describe("GET /api/admin/payments/plan", () => {
  interface PlanOrder {
    orderId: string;
  }

  interface PlanBody {
    customerId: string;
    customerCode: string | null;
    displayName: string | null;
    orders: PlanOrder[];
    ordersVnd: number;
    bonusVnd: number;
    totalVnd: number;
    memo: string;
    qr: { bankBin: string; accountNumber: string; amountVnd: number; note: string } | null;
  }

  const plan = async (customerId: string): Promise<PlanBody> => {
    const res = await server.inject({
      method: "GET",
      url: `/api/admin/payments/plan?customer_id=${customerId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as PlanBody;
  };

  it("requires staff", async () => {
    const res = await server.inject({ method: "GET", url: "/api/admin/payments/plan?customer_id=C1" });
    expect(res.statusCode).toBe(401);
  });

  it("404s an unknown customer, and 400s without one", async () => {
    const missing = await server.inject({ method: "GET", url: "/api/admin/payments/plan", headers: { cookie } });
    expect(missing.statusCode).toBe(400);
    const unknown = await server.inject({
      method: "GET",
      url: "/api/admin/payments/plan?customer_id=NOPE",
      headers: { cookie },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("works out what a payout covers, and the memo to write", async () => {
    const body = await plan("C1");
    expect(body).toMatchObject({
      customerId: "C1",
      customerCode: "DP1",
      displayName: "An",
      ordersVnd: 14506,
      bonusVnd: 0,
      totalVnd: 14506,
      memo: "DP1",
    });
    expect(body.orders.map((o: { orderId: string }) => o.orderId)).toEqual(["O1", "O2"]);
    // The bank matches for certain, so the owner can scan instead of typing.
    expect(body.qr).toEqual({ bankBin: "970436", accountNumber: "123", amountVnd: 14506, note: "DP1" });
  });

  it("offers no QR when there is no account to pay into", async () => {
    const body = await plan("C2");
    expect(body).toMatchObject({ totalVnd: 4000, qr: null });
  });
});

describe("POST /api/admin/payments/confirm", () => {
  it("rejects a missing order list", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/payments/confirm",
      headers: { cookie },
      payload: { customer_id: "C1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses an order that belongs to another customer", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/payments/confirm",
      headers: { cookie },
      payload: { customer_id: "C1", order_ids: ["O3"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("computes the amount from the orders and marks them paid", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/payments/confirm",
      headers: { cookie },
      payload: { customer_id: "C1", order_ids: ["O1", "O2"], transfer_code: "FT1" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, amountVnd: 14506 });
    expect(typeof res.json().transferId).toBe("number");
  });

  it("never pays the same orders twice", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/payments/confirm",
      headers: { cookie },
      payload: { customer_id: "C1", order_ids: ["O1", "O2"] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/admin/payments/ask-bank", () => {
  it("sends the need-bank wording through the assistant", async () => {
    const before = assistantCalls.length;
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/payments/ask-bank",
      headers: { cookie },
      payload: { customer_id: "C1" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });
    const call = assistantCalls[before];
    expect(call?.url).toBe("/api/notify");
    expect(call?.token).toBe("test-token");
    expect(call?.body).toMatchObject({ targetId: "Z1", type: "user" });
    expect(JSON.stringify(call?.body)).toContain("CÀI ĐẶT TÀI KHOẢN");
  });

  it("refuses a customer with no Zalo id", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/payments/ask-bank",
      headers: { cookie },
      payload: { customer_id: "C2" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s an unknown customer", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/payments/ask-bank",
      headers: { cookie },
      payload: { customer_id: "NOPE" },
    });
    expect(res.statusCode).toBe(404);
  });
});
