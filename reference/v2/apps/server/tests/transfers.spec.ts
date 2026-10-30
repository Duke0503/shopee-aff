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
  `CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL
     REFERENCES customers(customer_id), created_at TEXT NOT NULL, source_url TEXT NOT NULL,
     affiliate_url TEXT, estimated_commission INTEGER, channel TEXT,
     status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT, estimate_source TEXT,
     estimate_detail TEXT, attempts INTEGER NOT NULL DEFAULT 0,
     platform TEXT NOT NULL DEFAULT 'shopee', share_code TEXT)`,
  `CREATE TABLE payment_transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL,
     amount INTEGER NOT NULL, transfer_code TEXT, note TEXT, proof_image TEXT, order_ids TEXT,
     created_at TEXT NOT NULL, created_by TEXT, notify_mode TEXT, notified_at TEXT, target_group TEXT, bill_token TEXT)`,
  `CREATE TABLE campaigns (campaign_id TEXT PRIMARY KEY, name TEXT NOT NULL)`,
  `CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
     customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT, voided_at TEXT, notified_status TEXT)`,
];

const dbPath = join(tmpdir(), `cashback-transfers-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let cookie: string;
let seededTransferId: number;

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);

  const addCustomer = raw.prepare(
    "INSERT INTO customers (customer_id, customer_code, display_name, bank_name, bank_account, role, created_at, password_hash)" +
      " VALUES (?,?,?,?,?,?,?,?)",
  );
  addCustomer.run("ADMIN", null, "Chu shop", null, null, "admin", "2026-01-01T00:00:00", hashPassword("ADMINPASS", "s1"));
  addCustomer.run(
    "C1",
    "DP00005",
    "Pham Thi E",
    "Vietcombank",
    "0123456789",
    "user",
    "2026-01-01T00:00:00",
    null,
  );
  for (const id of ["C2", "C3", "C4", "C5"]) {
    addCustomer.run(id, null, null, null, null, "user", "2026-01-01T00:00:00", null);
  }

  const addOrder = raw.prepare(
    "INSERT INTO orders (order_id, customer_id, request_id, order_value, cashback_amount, status, recorded_at, approved_at, updated_at)" +
      " VALUES (?,?,?,?,?,?,?,?,?)",
  );
  const approved = (orderId: string, customerId: string, cashback: number, requestId: string | null = null) =>
    addOrder.run(orderId, customerId, requestId, 450_000, cashback, "approved", "2026-10-01T08:00:00", "2026-10-02T08:00:00", "2026-10-02T08:00:00");
  approved("O1", "C1", 25_200, "R1");
  approved("O2", "C1", 10_000);
  addOrder.run("O3", "C1", null, 450_000, null, "awaiting_approval", "2026-10-04T08:00:00", null, "2026-10-04T08:00:00");
  approved("O4", "C2", 5_000);
  approved("O5", "C3", 7_000);
  addOrder.run("O6", "C5", null, 450_000, null, "awaiting_approval", "2026-10-04T08:00:00", null, "2026-10-04T08:00:00");

  raw
    .prepare(
      "INSERT INTO link_requests (request_id, customer_id, created_at, source_url, estimate_detail)" +
        " VALUES (?,?,?,?,?)",
    )
    .run("R1", "C1", "2026-10-01T07:00:00", "https://shopee.vn/ao-i.1.2", '{"name":"Ao thun nam"}');
  raw.prepare("INSERT INTO campaigns (campaign_id, name) VALUES (?,?)").run("CAMP1", "Chao san 20k");
  raw
    .prepare(
      "INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, created_at)" +
        " VALUES (?,?,?,?,?,?)",
    )
    .run("CAMP1", "C1", "O1", 5000, "confirmed", "2026-10-02T08:00:00");

  seededTransferId = Number(
    raw
      .prepare(
        "INSERT INTO payment_transfers (customer_id, amount, note, order_ids, created_at) VALUES (?,?,?,?,?)",
      )
      .run("C1", 39608, "DP00012", "O1,O2", "2026-10-05T09:00:00").lastInsertRowid,
  );
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

interface TransferRow {
  id: number;
  customerId: string;
  amountVnd: number;
  orderIds: string[];
  createdAt: string;
}

interface RecordResult {
  ok: boolean;
  transferId: number;
  amountVnd: number;
  billToken: string;
  billPath: string;
}

const recordTransfer = (payload: Record<string, unknown>) =>
  server.inject({ method: "POST", url: "/api/admin/transfers", headers: { cookie }, payload });

describe("GET /api/admin/transfers", () => {
  it("requires an admin", async () => {
    expect((await server.inject({ method: "GET", url: "/api/admin/transfers" })).statusCode).toBe(401);
  });

  it("lists transfers with their orders decoded, newest first", async () => {
    const res = await server.inject({ method: "GET", url: "/api/admin/transfers", headers: { cookie } });
    expect(res.statusCode).toBe(200);

    const rows = res.json() as TransferRow[];
    expect(rows.find((row) => row.id === seededTransferId)).toMatchObject({
      customerId: "C1",
      amountVnd: 39608,
      orderIds: ["O1", "O2"],
    });
    const dates = rows.map((row) => row.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe("POST /api/admin/transfers", () => {
  it("requires an admin", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/transfers",
      payload: { customer_id: "C1" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a request without a customer", async () => {
    expect((await recordTransfer({})).statusCode).toBe(400);
  });

  it("refuses an unknown customer", async () => {
    expect((await recordTransfer({ customer_id: "NOPE" })).statusCode).toBe(404);
  });

  it("refuses an amount that is not a number", async () => {
    expect((await recordTransfer({ customer_id: "C4", amount: "lots" })).statusCode).toBe(400);
  });

  it("refuses when there is nothing payable", async () => {
    const res = await recordTransfer({ customer_id: "C4" });
    expect(res.statusCode).toBe(400);
    expect(String(res.json().message)).toMatch(/no approved, unpaid orders/);
  });

  it("refuses an order that is not payable", async () => {
    const res = await recordTransfer({ customer_id: "C5", order_ids: ["O6"] });
    expect(res.statusCode).toBe(400);
    expect(String(res.json().message)).toMatch(/not payable/);
  });

  it("records everything payable, computes the amount, and hands back a reachable bill", async () => {
    const res = await recordTransfer({ customer_id: "C1", note: "DP00005" });
    expect(res.statusCode).toBe(201);

    const body = res.json() as RecordResult;
    expect(body.ok).toBe(true);
    expect(body.amountVnd).toBe(40_200); // 25,200 cashback + 5,000 confirmed bonus + 10,000
    expect(body.billPath).toBe(`/b/${body.billToken}`);

    const bill = await server.inject({ method: "GET", url: body.billPath });
    expect(bill.statusCode).toBe(200);
    expect(bill.body).toContain("40.200đ");
    expect(bill.body).toContain("79.808đ"); // 39,608 already sent + 40,200 now
    expect(bill.body).toContain("Ao thun nam");
    expect(bill.body).toContain("Chao san 20k");
    expect(bill.body).toContain("01****6789");
  });

  it("pays only the named orders, and accepts a matching expected amount", async () => {
    const res = await recordTransfer({ customer_id: "C2", order_ids: ["O4"], amount: 5000 });
    expect(res.statusCode).toBe(201);
    expect((res.json() as RecordResult).amountVnd).toBe(5000);
  });

  it("refuses an expected amount that does not match the orders, recording nothing", async () => {
    const res = await recordTransfer({ customer_id: "C3", amount: 6000 });
    expect(res.statusCode).toBe(400);
    expect(String(res.json().message)).toMatch(/does not match/);

    // The order is still payable, so a correct request goes through.
    const retry = await recordTransfer({ customer_id: "C3", amount: 7000 });
    expect(retry.statusCode).toBe(201);
    expect((retry.json() as RecordResult).amountVnd).toBe(7000);
  });
});
