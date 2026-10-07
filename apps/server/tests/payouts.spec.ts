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
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT, cashback_amount INTEGER,
     status TEXT NOT NULL, paid_at TEXT)`,
];

const dbPath = join(tmpdir(), `cashback-payouts-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;

async function login(name: string, password: string): Promise<string> {
  const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { name, password } });
  const header = res.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  return String(value).split(";")[0] ?? "";
}

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const addCustomer = raw.prepare(
    "INSERT INTO customers (customer_id, display_name, role, status, created_at, password_hash, bank_account)" +
      " VALUES (?,?,?,?,?,?,?)",
  );
  addCustomer.run("ADMIN", "Owner", "admin", "active", "2026-01-01T00:00:00", hashPassword("ADMINPASS", "s1"), null);
  addCustomer.run("C1", "Lan", "user", "active", "2026-01-01T00:00:00", hashPassword("PASSC1", "s2"), "123");
  addCustomer.run("C2", "Minh", "user", "active", "2026-01-01T00:00:00", hashPassword("PASSC2", "s3"), null);

  const addOrder = raw.prepare(
    "INSERT INTO orders (order_id, customer_id, cashback_amount, status, paid_at) VALUES (?,?,?,?,?)",
  );
  addOrder.run("O1", "C1", 6000, "approved", null);
  addOrder.run("O2", "C2", 9000, "approved", null);
  addOrder.run("O3", "C1", 5000, "approved", "2026-10-01T00:00:00"); // already paid -> excluded
  addOrder.run("O4", "C1", 8000, "awaiting_approval", null); // not approved -> excluded
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
});

afterAll(async () => {
  await app?.close();
});

describe("GET /api/payouts (admin only)", () => {
  it("rejects an anonymous caller", async () => {
    expect((await server.inject({ method: "GET", url: "/api/payouts" })).statusCode).toBe(401);
  });

  it("rejects a non-admin customer", async () => {
    const cookie = await login("C1", "PASSC1");
    const res = await server.inject({ method: "GET", url: "/api/payouts", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("lists ready payables and those blocked by a missing bank account", async () => {
    const cookie = await login("ADMIN", "ADMINPASS");
    const res = await server.inject({ method: "GET", url: "/api/payouts", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ready.map((p: { customerId: string }) => p.customerId)).toEqual(["C1"]);
    expect(body.ready[0].amountVnd).toBe(6000);
    expect(body.blocked.map((p: { customerId: string }) => p.customerId)).toEqual(["C2"]);
  });
});
