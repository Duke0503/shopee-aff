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
  `CREATE TABLE payment_transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL,
     amount INTEGER NOT NULL, transfer_code TEXT, note TEXT, proof_image TEXT, order_ids TEXT,
     created_at TEXT NOT NULL, created_by TEXT, notify_mode TEXT, notified_at TEXT, target_group TEXT, bill_token TEXT)`,
];

const dbPath = join(tmpdir(), `cashback-transfers-${randomBytes(6).toString("hex")}.db`);
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
      "INSERT INTO payment_transfers (customer_id, amount, note, order_ids, created_at) VALUES (?,?,?,?,?)",
    )
    .run("C1", 39608, "DP00012", "O1,O2", "2026-10-05T09:00:00");
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

describe("GET /api/admin/transfers", () => {
  it("requires an admin", async () => {
    expect((await server.inject({ method: "GET", url: "/api/admin/transfers" })).statusCode).toBe(401);
  });

  it("lists transfers with their orders decoded", async () => {
    const res = await server.inject({ method: "GET", url: "/api/admin/transfers", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ customerId: "C1", amountVnd: 39608, orderIds: ["O1", "O2"] });
  });
});
