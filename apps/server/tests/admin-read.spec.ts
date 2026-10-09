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
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT, order_value INTEGER,
     estimated_commission INTEGER, approved_commission INTEGER, cashback_amount INTEGER,
     status TEXT NOT NULL, recorded_at TEXT, approved_at TEXT, paid_at TEXT, updated_at TEXT NOT NULL)`,
  `CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, source_url TEXT NOT NULL, affiliate_url TEXT)`,
  `CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT, action TEXT NOT NULL,
     path TEXT, ip_address TEXT, user_agent TEXT, detail TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE payout_batches (batch_id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT 'shopee',
     status TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, eligible_amount INTEGER NOT NULL DEFAULT 0,
     created_time TEXT, paid_time TEXT, raw_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
];

const dbPath = join(tmpdir(), `cashback-admin-read-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let adminCookie: string;
let employeeCookie: string;

async function login(name: string, password: string): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { name, password },
  });
  const header = res.headers["set-cookie"];
  return String(Array.isArray(header) ? header[0] : header).split(";")[0] ?? "";
}

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);

  const addCustomer = raw.prepare(
    "INSERT INTO customers (customer_id, display_name, bank_account, role, status, created_at, password_hash)" +
      " VALUES (?,?,?,?,?,?,?)",
  );
  addCustomer.run("ADMIN", "Owner", null, "admin", "active", "2026-01-01T00:00:00", hashPassword("ADMINPASS", "s1"));
  addCustomer.run("EMP1", "Helper", null, "employee", "active", "2026-01-02T00:00:00", hashPassword("EMPPASS", "s2"));
  addCustomer.run("C1", "Lan", "123", "user", "active", "2026-01-03T00:00:00", null);
  addCustomer.run("C2", "Mai", null, "user", "active", "2026-01-04T00:00:00", null);

  const addOrder = raw.prepare(
    "INSERT INTO orders (order_id, customer_id, order_value, cashback_amount, status, recorded_at, updated_at)" +
      " VALUES (?,?,?,?,?,?,?)",
  );
  addOrder.run("O1", "C1", 450000, 9506, "approved", "2026-10-05T09:00:00", "2026-10-05T09:00:00");
  addOrder.run("O2", "C1", 300000, 5000, "awaiting_approval", "2026-10-06T09:00:00", "2026-10-06T09:00:00");
  addOrder.run("O3", "C2", 200000, 4000, "paid", "2026-10-04T09:00:00", "2026-10-04T09:00:00");

  raw
    .prepare("INSERT INTO link_requests (request_id, customer_id, created_at, source_url) VALUES (?,?,?,?)")
    .run("R1", "C1", "2026-10-06T08:00:00", "https://shopee.vn/x");

  const addLog = raw.prepare(
    "INSERT INTO activity_logs (customer_id, action, path, created_at) VALUES (?,?,?,?)",
  );
  addLog.run("C1", "login", "/api/auth/login", "2026-10-06T08:30:00");
  addLog.run("C2", "view", "/api/me", "2026-10-06T08:31:00");

  raw
    .prepare(
      "INSERT INTO payout_batches (batch_id, platform, status, amount, eligible_amount, created_at, updated_at)" +
        " VALUES (?,?,?,?,?,?,?)",
    )
    .run("B1", "shopee", "paid", 12345, 10000, "2026-10-06T00:00:00", "2026-10-06T00:00:00");
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
  adminCookie = await login("ADMIN", "ADMINPASS");
  employeeCookie = await login("EMP1", "EMPPASS");
});

afterAll(async () => {
  await app?.close();
});

describe("GET /api/admin/metrics", () => {
  it("requires staff", async () => {
    expect((await server.inject({ method: "GET", url: "/api/admin/metrics" })).statusCode).toBe(401);
  });

  it("sums the stored ledger columns and never recalculates money", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/metrics",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({
      totalCustomers: 2,
      totalEmployees: 2,
      ordersTotal: 3,
      ordersAwaiting: 1,
      ordersApproved: 1,
      ordersPaid: 1,
      ordersRejected: 0,
      gmvVnd: 950000,
      cashbackPipelineVnd: 5000,
      cashbackReadyVnd: 9506,
      cashbackPaidVnd: 4000,
    });
    expect(res.json().trends).toHaveLength(3);
  });

  it("lets an employee look too", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/metrics",
      headers: { cookie: employeeCookie },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/admin/users", () => {
  it("lists customers with stored aggregates", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/users?search=c1",
      headers: { cookie: adminCookie },
    });
    expect(res.json().pagination.total).toBe(1);
    expect(res.json().users[0]).toMatchObject({
      customerId: "C1",
      orderCount: 2,
      totalCashback: 14506,
      awaitingAmount: 5000,
      readyAmount: 9506,
      paidAmount: 0,
    });
    expect(res.json().users[0].recentRequests).toHaveLength(1);
  });

  it("filters by whether a bank account is set", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/users?bank=has_bank",
      headers: { cookie: adminCookie },
    });
    expect(res.json().users.map((u: { customerId: string }) => u.customerId)).toEqual(["C1"]);
  });

  it("never lists staff in the customer list", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: adminCookie },
    });
    expect(res.json().pagination.total).toBe(2);
  });
});

describe("GET /api/admin/employees", () => {
  it("is admin-only", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/employees",
      headers: { cookie: employeeCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lists admin and employees", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/employees",
      headers: { cookie: adminCookie },
    });
    expect(res.json().pagination.total).toBe(2);
    expect(
      res.json().employees.map((e: { customerId: string }) => e.customerId).sort(),
    ).toEqual(["ADMIN", "EMP1"]);
  });
});

describe("GET /api/admin/logs", () => {
  it("lists newest first and filters by action", async () => {
    const all = await server.inject({
      method: "GET",
      url: "/api/admin/logs",
      headers: { cookie: adminCookie },
    });
    expect(all.json().pagination.total).toBe(2);

    const filtered = await server.inject({
      method: "GET",
      url: "/api/admin/logs?action=login",
      headers: { cookie: adminCookie },
    });
    expect(filtered.json().pagination.total).toBe(1);
    expect(filtered.json().logs[0]).toMatchObject({ customerId: "C1", action: "login" });
  });

  it("searches by display name", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/logs?search=mai",
      headers: { cookie: adminCookie },
    });
    expect(res.json().logs.map((l: { customerId: string }) => l.customerId)).toEqual(["C2"]);
  });
});

describe("GET /api/admin/payout-batches", () => {
  it("lists imported platform batches", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/payout-batches",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().batches[0]).toMatchObject({
      batchId: "B1",
      platform: "shopee",
      status: "paid",
      amountVnd: 12345,
      eligibleAmountVnd: 10000,
    });
  });
});
