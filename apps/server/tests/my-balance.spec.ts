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
  `CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
     customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT, voided_at TEXT, notified_status TEXT)`,
];

const dbPath = join(tmpdir(), `cashback-balance-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  raw
    .prepare("INSERT INTO customers (customer_id, created_at, password_hash) VALUES (?,?,?)")
    .run("C1", "2026-01-01T00:00:00", hashPassword("PASSC1", "s1"));
  raw
    .prepare("INSERT INTO customers (customer_id, role, created_at) VALUES (?,?,?)")
    .run("HOUSE", "house", "2026-01-01T00:00:00");
  const addOrder = raw.prepare(
    "INSERT INTO orders (order_id, customer_id, cashback_amount, estimated_commission, status, paid_at, recorded_at, updated_at)" +
      " VALUES (?,?,?,?,?,?,?,?)",
  );
  addOrder.run("O1", "C1", 9506, null, "approved", null, "2026-10-05T09:00:00", "2026-10-05T09:00:00");
  addOrder.run("O2", "C1", null, 50000, "awaiting_approval", null, "2026-10-06T09:00:00", "2026-10-06T09:00:00");
  addOrder.run("O3", "C1", 5000, null, "paid", "2026-10-01T09:00:00", "2026-10-01T09:00:00", "2026-10-01T09:00:00");
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;

  const res = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { name: "C1", password: "PASSC1" },
  });
  const header = res.headers["set-cookie"];
  cookie = String(Array.isArray(header) ? header[0] : header).split(";")[0] ?? "";
});

afterAll(async () => {
  await app?.close();
});

describe("GET /api/me/balance", () => {
  it("requires a session", async () => {
    expect((await server.inject({ method: "GET", url: "/api/me/balance" })).statusCode).toBe(401);
  });

  it("splits approved, still-with-the-shop and already paid", async () => {
    const res = await server.inject({ method: "GET", url: "/api/me/balance", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    // 50,000d estimate at 80% shows 35,608d while waiting.
    expect(res.json()).toEqual({
      approvedWaitingVnd: 9506,
      stillWithShopVnd: 35608,
      alreadyPaidVnd: 5000,
    });
  });
});
