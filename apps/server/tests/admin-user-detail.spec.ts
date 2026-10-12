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
  `CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, source_url TEXT NOT NULL, affiliate_url TEXT, estimated_commission INTEGER,
     channel TEXT, status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT, estimate_source TEXT,
     estimate_detail TEXT, attempts INTEGER NOT NULL DEFAULT 0, platform TEXT NOT NULL DEFAULT 'shopee',
     share_code TEXT)`,
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT, request_id TEXT, order_value INTEGER,
     estimated_commission INTEGER, approved_commission INTEGER, cashback_amount INTEGER,
     status TEXT NOT NULL, rejection_reason TEXT, recorded_at TEXT, approved_at TEXT, paid_at TEXT,
     updated_at TEXT NOT NULL, notified_status TEXT, platform TEXT NOT NULL DEFAULT 'shopee',
     settlement_status TEXT NOT NULL DEFAULT 'unsettled', payout_batch_id TEXT, settled_at TEXT)`,
  `CREATE TABLE payment_transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL,
     amount INTEGER NOT NULL, transfer_code TEXT, note TEXT, proof_image TEXT, order_ids TEXT,
     created_at TEXT NOT NULL, created_by TEXT, notify_mode TEXT, notified_at TEXT, target_group TEXT,
     bill_token TEXT)`,
  `CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
     customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT, voided_at TEXT, notified_status TEXT)`,
  `CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT, action TEXT NOT NULL,
     path TEXT, ip_address TEXT, user_agent TEXT, detail TEXT, created_at TEXT NOT NULL)`,
];

const dbPath = join(tmpdir(), `cashback-admin-user-detail-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let adminCookie: string;
let employeeCookie: string;

const ORIGINAL_WITHHELD = process.env.PAYOUT_PERIOD_WITHHELD;

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);

  const add = raw.prepare(
    "INSERT INTO customers (customer_id, customer_code, display_name, bank_name, bank_account, account_holder, role, created_at, password_hash)" +
      " VALUES (?,?,?,?,?,?,?,?,?)",
  );
  add.run(
    "ADMIN",
    null,
    "Owner",
    null,
    null,
    null,
    "admin",
    "2026-01-01T00:00:00",
    hashPassword("ADMINPASS", "s1"),
  );
  add.run(
    "EMP",
    null,
    "Nhan vien",
    null,
    null,
    null,
    "employee",
    "2026-01-01T00:00:00",
    hashPassword("EMPPASS", "s1"),
  );
  add.run(
    "C1",
    "DP00012",
    "Lan",
    "Vietcombank",
    "0123456789",
    "NGUYEN THI LAN",
    "user",
    "2026-01-01T00:00:00",
    null,
  );
  add.run("C9", "DP00099", "Minh", null, null, null, "user", "2026-01-02T00:00:00", null);

  raw
    .prepare(
      "INSERT INTO link_requests (request_id, customer_id, created_at, source_url, estimate_detail, platform)" +
        " VALUES (?,?,?,?,?,?)",
    )
    .run(
      "R1",
      "C1",
      "2026-09-30T07:00:00",
      "https://shopee.vn/ao-i.1.2",
      '{"name":"Ao thun nam"}',
      "shopee",
    );

  const addOrder = raw.prepare(
    "INSERT INTO orders (order_id, customer_id, request_id, order_value, estimated_commission, approved_commission, cashback_amount, status, recorded_at, approved_at, updated_at, platform)" +
      " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  // Approved at 31,500 commission -> saved cashback 24,953.
  addOrder.run(
    "O1",
    "C1",
    "R1",
    450000,
    31500,
    31500,
    24953,
    "approved",
    "2026-10-01T08:00:00",
    "2026-10-02T08:00:00",
    "2026-10-02T08:00:00",
    "shopee",
  );
  addOrder.run(
    "O2",
    "C1",
    null,
    700000,
    50000,
    null,
    null,
    "awaiting_approval",
    "2026-10-03T08:00:00",
    null,
    "2026-10-03T08:00:00",
    "shopee",
  );
  addOrder.run(
    "O3",
    "C1",
    null,
    300000,
    20000,
    null,
    null,
    "rejected",
    "2026-10-04T08:00:00",
    null,
    "2026-10-04T08:00:00",
    "shopee",
  );

  raw
    .prepare(
      "INSERT INTO payment_transfers (customer_id, amount, transfer_code, note, order_ids, created_at, created_by, bill_token, proof_image)" +
        " VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "C1",
      20000,
      "TX1",
      "DP00012",
      "O1",
      "2026-10-05T09:00:00",
      "admin",
      "tok-1",
      "/uploads/proofs/p.jpg",
    );

  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;

  const login = async (name: string, password: string): Promise<string> => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { name, password },
    });
    const header = res.headers["set-cookie"];
    return String(Array.isArray(header) ? header[0] : header).split(";")[0] ?? "";
  };
  adminCookie = await login("ADMIN", "ADMINPASS");
  employeeCookie = await login("EMP", "EMPPASS");
});

afterAll(async () => {
  if (ORIGINAL_WITHHELD === undefined) delete process.env.PAYOUT_PERIOD_WITHHELD;
  else process.env.PAYOUT_PERIOD_WITHHELD = ORIGINAL_WITHHELD;
  await app?.close();
});

interface DetailBody {
  user: Record<string, unknown>;
  stats: Record<string, unknown>;
  orders: Array<{ orderId: string; breakdown: Record<string, unknown> }>;
  transfers: Array<Record<string, unknown>>;
  linkRequests: Array<Record<string, unknown>>;
}

const get = (id: string, cookie = adminCookie) =>
  server.inject({ method: "GET", url: `/api/admin/users/${id}`, headers: { cookie } });

describe("GET /api/admin/users/:id", () => {
  it("requires a signed-in staff member", async () => {
    expect((await server.inject({ method: "GET", url: "/api/admin/users/C1" })).statusCode).toBe(
      401,
    );
  });

  it("answers 404 for a customer we do not have", async () => {
    expect((await get("NOPE")).statusCode).toBe(404);
  });

  it("opens for an employee too, as the old console did", async () => {
    expect((await get("C1", employeeCookie)).statusCode).toBe(200);
  });

  it("brings the customer, their money and their transfers together", async () => {
    const res = await get("C1");
    expect(res.statusCode).toBe(200);

    const body = res.json() as DetailBody;
    expect(body.user).toMatchObject({
      customerId: "C1",
      customerCode: "DP00012",
      displayName: "Lan",
      bankAccount: "0123456789",
    });
    expect(body.stats).toMatchObject({
      readyVnd: 24_953,
      awaitingVnd: 35_608,
      paidVnd: 0,
      totalOrders: 3,
      totalRequests: 1,
      totalTransferredVnd: 20_000,
      periodIsWithheld: false,
    });
    expect(body.orders).toHaveLength(3);
    const approved = body.orders.find((order) => order.orderId === "O1");
    expect(approved?.breakdown).toMatchObject({
      basis: "approved",
      serviceFeeVnd: 309,
      withheldTaxVnd: 0,
      cashbackVnd: 24_953,
    });
    expect(body.transfers[0]).toMatchObject({
      amountVnd: 20_000,
      orderIds: ["O1"],
      billPath: "/b/tok-1",
      proofPath: "/api/proofs/tok-1",
    });
  });

  it("lists the customer's link requests", async () => {
    const body = (await get("C1")).json() as DetailBody;
    expect(body.linkRequests[0]).toMatchObject({
      requestId: "R1",
      productName: "Ao thun nam",
      sourceUrl: "https://shopee.vn/ao-i.1.2",
    });
  });

  it("shows an empty page for a customer with nothing yet", async () => {
    const body = (await get("C9")).json() as DetailBody;
    expect(body.orders).toEqual([]);
    expect(body.transfers).toEqual([]);
    expect(body.stats).toMatchObject({ totalCashbackVnd: 0, readyVnd: 0, totalOrders: 0 });
  });

  it("explains the tax only when the period is withheld", async () => {
    process.env.PAYOUT_PERIOD_WITHHELD = "true";
    const body = (await get("C1")).json() as DetailBody;
    process.env.PAYOUT_PERIOD_WITHHELD = ORIGINAL_WITHHELD ?? "false";

    const approved = body.orders.find((order) => order.orderId === "O1");
    expect(body.stats.periodIsWithheld).toBe(true);
    expect(approved?.breakdown).toMatchObject({ withheldTaxVnd: 3_150, netVnd: 28_041 });
    // Money already owed does not move because a period changed.
    expect(body.stats.readyVnd).toBe(24_953);
  });
});
