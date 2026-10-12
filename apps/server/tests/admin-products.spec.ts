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
  `CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, source_url TEXT NOT NULL, affiliate_url TEXT, estimate_detail TEXT,
     status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
     platform TEXT NOT NULL DEFAULT 'shopee')`,
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT, request_id TEXT,
     order_value INTEGER, estimated_commission INTEGER, approved_commission INTEGER,
     cashback_amount INTEGER, status TEXT NOT NULL, recorded_at TEXT, approved_at TEXT,
     updated_at TEXT NOT NULL)`,
  `CREATE TABLE products_cache (item_id TEXT PRIMARY KEY, shop_id TEXT, name TEXT, price INTEGER,
     price_formatted TEXT, shopee_rate REAL, seller_rate REAL, shopee_part INTEGER,
     shopee_part_formatted TEXT, seller_part INTEGER, seller_part_formatted TEXT,
     total_commission INTEGER, commission_formatted TEXT, cashback INTEGER, cashback_formatted TEXT,
     rate_percent TEXT, affiliate_url TEXT, canonical_url TEXT, request_count INTEGER DEFAULT 1,
     first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL, image_url TEXT)`,
];

const dbPath = join(tmpdir(), `cashback-admin-products-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let staffCookie: string;
let userCookie: string;

async function login(name: string, password: string): Promise<string> {
  const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { name, password } });
  const header = res.headers["set-cookie"];
  return String(Array.isArray(header) ? header[0] : header).split(";")[0] ?? "";
}

async function products(query = "") {
  return server.inject({ method: "GET", url: `/api/admin/products${query}`, headers: { cookie: staffCookie } });
}

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);

  const addCustomer = raw.prepare(
    "INSERT INTO customers (customer_id, customer_code, display_name, bank_name, bank_account," +
      " account_holder, role, created_at, password_hash) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  const created = "2026-01-01T00:00:00";
  addCustomer.run("ADMIN", null, "Owner", null, null, null, "admin", created, hashPassword("ADMINPASS", "s1"));
  addCustomer.run("EMP", null, "Helper", null, null, null, "employee", created, hashPassword("EMPPASS", "s2"));
  addCustomer.run("USER", null, "Looker", null, null, null, "user", created, hashPassword("USERPASS", "s3"));
  addCustomer.run("C1", "DP00012", "Lan", "VCB", "123", "LAN", "user", created, null);
  addCustomer.run("C2", "DP00013", "Mai", null, null, null, "user", created, null);

  raw
    .prepare(
      "INSERT INTO products_cache (item_id, name, price, price_formatted, shopee_rate, seller_rate," +
        " shopee_part, seller_part, total_commission, commission_formatted, cashback," +
        " cashback_formatted, rate_percent, affiliate_url, canonical_url, request_count," +
        " first_seen_at, updated_at, image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run("111", "Ao thun nam", 200_000, "200.000", 0.05, 0.03, 8_000, 2_000, 10_000, "10.000",
      8_000, "8.000", "80%", "https://aff.example/111", "https://shopee.vn/p/111", 1,
      created, "2026-10-01T00:00:00", "https://img/111.jpg");
  raw
    .prepare(
      "INSERT INTO products_cache (item_id, name, price, request_count, first_seen_at, updated_at)" +
        " VALUES (?,?,?,?,?,?)",
    )
    .run("222", "Quan jean", 300_000, 3, created, "2026-10-05T00:00:00");

  raw
    .prepare(
      "INSERT INTO link_requests (request_id, customer_id, created_at, source_url, affiliate_url, platform)" +
        " VALUES (?,?,?,?,?,?)",
    )
    .run("R1", "C1", "2026-10-02T00:00:00", "https://shopee.vn/product/111", "https://aff.example/111", "shopee");

  const addOrder = raw.prepare(
    "INSERT INTO orders (order_id, customer_id, request_id, order_value, estimated_commission," +
      " approved_commission, cashback_amount, status, recorded_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  addOrder.run("O1", "C1", "R1", 200_000, null, 10_000, 8_000, "approved", "2026-10-03T00:00:00", "2026-10-03T00:00:00");
  addOrder.run("O2", "C2", "R1", 100_000, 10_000, null, null, "awaiting_approval", "2026-10-04T00:00:00", "2026-10-04T00:00:00");
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
  staffCookie = await login("EMP", "EMPPASS");
  userCookie = await login("USER", "USERPASS");
});

afterAll(async () => {
  await app?.close();
});

describe("GET /api/admin/products", () => {
  it("is staff only", async () => {
    expect((await server.inject({ method: "GET", url: "/api/admin/products" })).statusCode).toBe(401);
    expect(
      (await server.inject({ method: "GET", url: "/api/admin/products", headers: { cookie: userCookie } })).statusCode,
    ).toBe(403);
  });

  it("lists a product with who asked and who bought", async () => {
    const res = await products();
    expect(res.statusCode).toBe(200);

    const body = res.json() as { products: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(2);

    const product = body.products.find((row) => row.itemId === "111") as Record<string, unknown>;
    expect(product).toMatchObject({
      name: "Ao thun nam",
      price: 200_000,
      totalCommission: 10_000,
      cashback: 8_000,
      requestCount: 1,
      orderCount: 2,
      totalBoughtGmv: 300_000,
    });
    expect(product.requesters).toEqual([
      {
        customerId: "C1",
        customerCode: "DP00012",
        displayName: "Lan",
        zaloUserId: null,
        bankName: "VCB",
        bankAccount: "123",
        accountHolder: "LAN",
        lastRequestedAt: "2026-10-02T00:00:00",
        requestCount: 1,
      },
    ]);

    const buyers = product.buyers as Array<Record<string, unknown>>;
    expect(buyers.map((buyer) => buyer.orderId)).toEqual(["O2", "O1"]);
    expect(buyers[0]).toMatchObject({ orderId: "O2", cashbackAmount: 7_922, status: "awaiting_approval" });
    expect(buyers[1]).toMatchObject({ orderId: "O1", cashbackAmount: 8_000 });
  });

  it("computes a fallback cashback with the period's withholding flag", async () => {
    const original = process.env.PAYOUT_PERIOD_WITHHELD;
    process.env.PAYOUT_PERIOD_WITHHELD = "true";
    try {
      const body = (await products()).json() as { products: Array<Record<string, unknown>> };
      const product = body.products.find((row) => row.itemId === "111") as Record<string, unknown>;
      const buyers = product.buyers as Array<Record<string, unknown>>;
      // 10,000 commission: fee 98, tax 1,000 -> net 8,902 -> 80% = 7,122.
      expect(buyers[0]).toMatchObject({ orderId: "O2", cashbackAmount: 7_122 });
    } finally {
      if (original === undefined) delete process.env.PAYOUT_PERIOD_WITHHELD;
      else process.env.PAYOUT_PERIOD_WITHHELD = original;
    }
  });

  it("reports zeros for a product nobody has asked for", async () => {
    const body = (await products()).json() as { products: Array<Record<string, unknown>> };
    const product = body.products.find((row) => row.itemId === "222") as Record<string, unknown>;
    expect(product).toMatchObject({ requestCount: 0, orderCount: 0, totalBoughtGmv: 0, lastRequestedAt: null });
    expect(product.requesters).toEqual([]);
    expect(product.buyers).toEqual([]);
  });

  it("narrows the list by search and reports the matching total", async () => {
    const body = (await products("?search=111")).json() as {
      products: Array<Record<string, unknown>>;
      pagination: { total: number };
    };
    expect(body.pagination.total).toBe(1);
    expect(body.products.map((row) => row.itemId)).toEqual(["111"]);
  });

  it("sorts by the traced order count", async () => {
    const body = (await products("?sort_by=orders&sort_order=desc")).json() as {
      products: Array<Record<string, unknown>>;
    };
    expect(body.products.map((row) => row.itemId)).toEqual(["111", "222"]);
  });
});
