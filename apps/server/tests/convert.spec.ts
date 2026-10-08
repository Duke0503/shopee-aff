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

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
     private_chat_id TEXT, display_name TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT,
     consent_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
     password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
     locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
     login_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL
     REFERENCES customers(customer_id), created_at TEXT NOT NULL, source_url TEXT NOT NULL,
     affiliate_url TEXT, estimated_commission INTEGER, channel TEXT,
     status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT, estimate_source TEXT,
     estimate_detail TEXT, attempts INTEGER NOT NULL DEFAULT 0,
     platform TEXT NOT NULL DEFAULT 'shopee', share_code TEXT)`,
];

const SHOPEE = "https://shopee.vn/x-i.1.2";
const dbPath = join(tmpdir(), `cashback-convert-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let raw: Database.Database;

beforeAll(async () => {
  raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const addCustomer = raw.prepare("INSERT INTO customers (customer_id, created_at) VALUES (?, ?)");
  addCustomer.run("HOUSE", "2026-01-01T00:00:00");
  addCustomer.run("C1", "2026-01-01T00:00:00");
  const recent = new Date(Date.now() - 3_600_000).toISOString().slice(0, 19);
  raw
    .prepare(
      "INSERT INTO link_requests (request_id, customer_id, created_at, source_url, affiliate_url, status)" +
        " VALUES (?,?,?,?,?,?)",
    )
    .run("R26100100001", "C1", recent, SHOPEE, "https://s.shopee.vn/aff", "pending");

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
});

afterAll(async () => {
  await app?.close();
  raw.close();
});

const convert = (payload: Record<string, string>) =>
  server.inject({ method: "POST", url: "/api/shopee/convert", payload });

describe("POST /api/shopee/convert", () => {
  it("reuses the customer's own recent link for the same product", async () => {
    const res = await convert({ url: SHOPEE, customerId: "C1" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ready: true,
      affiliate_url: "https://s.shopee.vn/aff",
      request_id: "R26100100001",
      house: false,
    });
  });

  it("creates a new request for a different product", async () => {
    const res = await convert({ url: "https://shopee.vn/other-i.9.9", customerId: "C1" });
    expect(res.statusCode).toBe(201);
    expect(res.json().ready).toBe(false);
    expect(res.json().request_id).toMatch(/^R\d{11}$/);
  });

  it("treats a visitor with no code as a guest", async () => {
    const res = await convert({ url: "https://shopee.vn/guest-i.1.1" });
    expect(res.json().house).toBe(true);
  });

  it("refuses an unsupported link", async () => {
    expect((await convert({ url: "https://example.com/x" })).statusCode).toBe(400);
  });

  it("refuses an empty body", async () => {
    expect((await convert({})).statusCode).toBe(400);
  });
});

describe("GET /api/shopee/link-status", () => {
  it("reports a request that is ready", async () => {
    const res = await server.inject({ method: "GET", url: "/api/shopee/link-status?request_id=R26100100001" });
    expect(res.json().ready).toBe(true);
  });

  it("404s an unknown request", async () => {
    expect((await server.inject({ method: "GET", url: "/api/shopee/link-status?request_id=R999" })).statusCode).toBe(404);
  });
});
