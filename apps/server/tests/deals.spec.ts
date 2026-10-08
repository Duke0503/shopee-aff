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
  `CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  `CREATE TABLE customer_aliases (alias TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE featured_deals (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, name TEXT NOT NULL,
     platform TEXT NOT NULL DEFAULT 'Shopee Mall', category TEXT NOT NULL,
     original_price INTEGER NOT NULL, sale_price INTEGER NOT NULL, commission_rate REAL NOT NULL,
     cashback INTEGER NOT NULL, image_url TEXT NOT NULL, url TEXT NOT NULL,
     is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
];

const dbPath = join(tmpdir(), `cashback-deals-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const add = raw.prepare(
    "INSERT INTO featured_deals (id, item_id, name, category, original_price, sale_price," +
      " commission_rate, cashback, image_url, url, is_active, sort_order, created_at, updated_at)" +
      " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  add.run("D2", "i2", "Second", "Home", 200, 100, 0.05, 4000, "i.png", "u2", 1, 2, "t", "t");
  add.run("D1", "i1", "First", "Home", 300, 150, 0.05, 6000, "i.png", "u1", 1, 1, "t", "t");
  add.run("D3", "i3", "Hidden", "Home", 300, 150, 0.05, 6000, "i.png", "u3", 0, 0, "t", "t");
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
});

afterAll(async () => {
  await app?.close();
});

describe("GET /api/deals", () => {
  it("is public", async () => {
    expect((await server.inject({ method: "GET", url: "/api/deals" })).statusCode).toBe(200);
  });

  it("lists only active deals, in the owner's order", async () => {
    const res = await server.inject({ method: "GET", url: "/api/deals" });
    expect(res.json().map((deal: { id: string }) => deal.id)).toEqual(["D1", "D2"]);
  });

  it("sends whole-dong amounts and the link", async () => {
    const res = await server.inject({ method: "GET", url: "/api/deals" });
    expect(res.json()[0]).toMatchObject({ cashbackVnd: 6000, salePriceVnd: 150, url: "u1" });
  });
});
