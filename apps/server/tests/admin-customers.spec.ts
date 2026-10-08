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
];

const dbPath = join(tmpdir(), `cashback-admin-customers-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const add = raw.prepare(
    "INSERT INTO customers (customer_id, customer_code, display_name, role, created_at, password_hash, bank_account)" +
      " VALUES (?,?,?,?,?,?,?)",
  );
  add.run("ADMIN", null, "Owner", "admin", "2026-01-01T00:00:00", hashPassword("ADMINPASS", "s1"), null);
  add.run("C1", "DP00012", "Lan", "user", "2026-01-01T00:00:00", null, "123");
  add.run("C2", "DP00013", "Minh", "user", "2026-01-01T00:00:00", null, null);
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

describe("GET /api/admin/customers", () => {
  it("requires an admin", async () => {
    expect((await server.inject({ method: "GET", url: "/api/admin/customers" })).statusCode).toBe(401);
  });

  it("lists customers with their code and bank flag", async () => {
    const res = await server.inject({ method: "GET", url: "/api/admin/customers", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const lan = res.json().find((c: { customerId: string }) => c.customerId === "C1");
    expect(lan).toMatchObject({ customerCode: "DP00012", hasBankDetails: true });
  });

  it("filters by code or name", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/customers?q=dp00013",
      headers: { cookie },
    });
    expect(res.json().map((c: { customerId: string }) => c.customerId)).toEqual(["C2"]);
  });
});
