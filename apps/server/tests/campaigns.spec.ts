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
  `CREATE TABLE campaigns (campaign_id TEXT PRIMARY KEY, name TEXT NOT NULL, starts_at TEXT NOT NULL,
     ends_at TEXT NOT NULL, slots INTEGER NOT NULL, bonus_vnd INTEGER NOT NULL,
     min_order_value INTEGER NOT NULL DEFAULT 0,
     platforms TEXT NOT NULL DEFAULT 'shopee,shopeefood,tiktok',
     excluded_customers TEXT NOT NULL DEFAULT '', per_customer INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL)`,
];

const dbPath = join(tmpdir(), `cashback-campaigns-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  raw
    .prepare("INSERT INTO customers (customer_id, role, created_at, password_hash) VALUES (?,?,?,?)")
    .run("ADMIN", "admin", "2026-01-01T00:00:00", hashPassword("ADMINPASS", "s1"));
  raw
    .prepare(
      "INSERT INTO campaigns (campaign_id, name, starts_at, ends_at, slots, bonus_vnd, created_at)" +
        " VALUES (?,?,?,?,?,?,?)",
    )
    .run("CMP1", "Trung Thu", "2026-10-01T00:00:00", "2026-10-03T23:59:59", 20, 20000, "2026-09-30T00:00:00");
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

describe("GET /api/admin/campaigns", () => {
  it("requires an admin", async () => {
    expect((await server.inject({ method: "GET", url: "/api/admin/campaigns" })).statusCode).toBe(401);
  });

  it("lists campaigns", async () => {
    const res = await server.inject({ method: "GET", url: "/api/admin/campaigns", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ campaignId: "CMP1", name: "Trung Thu", slots: 20, bonusVnd: 20000 });
  });
});
