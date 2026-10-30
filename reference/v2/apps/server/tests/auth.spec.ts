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

const CUSTOMER_DDL = `
CREATE TABLE customers (
  customer_id TEXT PRIMARY KEY, zalo_user_id TEXT, private_chat_id TEXT, display_name TEXT,
  bank_name TEXT, bank_account TEXT, account_holder TEXT, consent_at TEXT,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
  password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
  login_count INTEGER NOT NULL DEFAULT 0, customer_code TEXT
)`;
const SESSIONS_DDL = `
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`;
const ALIASES_DDL = `
CREATE TABLE customer_aliases (alias TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
  created_at TEXT NOT NULL, note TEXT)`;

const UID = "8461752093318820417";
const dbPath = join(tmpdir(), `cashback-auth-${randomBytes(6).toString("hex")}.db`);

let app: NestFastifyApplication;
let server: FastifyInstance;

beforeAll(async () => {
  const raw = new Database(dbPath);
  raw.exec(CUSTOMER_DDL);
  raw.exec(SESSIONS_DDL);
  raw.exec(ALIASES_DDL);
  raw
    .prepare(
      "INSERT INTO customers (customer_id, customer_code, display_name, role, status, created_at, password_hash)" +
        " VALUES (?,?,?,?,?,?,?)",
    )
    .run(UID, "DP00012", "Lan", "user", "active", "2026-01-01T00:00:00", hashPassword("ABCDEFGH", "salt-1"));
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
});

afterAll(async () => {
  await app?.close();
});

const login = (payload: Record<string, string>) =>
  server.inject({ method: "POST", url: "/api/auth/login", payload });

describe("POST /api/auth/login", () => {
  it("signs in with the right password and sets the session cookie", async () => {
    const res = await login({ name: "DP00012", password: "ABCDEFGH" });
    expect(res.statusCode).toBe(201);
    expect(res.headers["set-cookie"]).toContain("cashback_session=");
    expect(res.json().customerId).toBe(UID);
  });

  it("accepts the code lower-cased and spaced", async () => {
    const res = await login({ name: " dp 00012 ", password: "ABCDEFGH" });
    expect(res.statusCode).toBe(201);
  });

  it("rejects a wrong password with 401", async () => {
    expect((await login({ name: "DP00012", password: "WRONG" })).statusCode).toBe(401);
  });

  it("rejects an unknown code with 401 (never a guest)", async () => {
    expect((await login({ name: "DP99999", password: "x" })).statusCode).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie", async () => {
    const res = await server.inject({ method: "POST", url: "/api/auth/logout", payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.headers["set-cookie"]).toContain("Max-Age=0");
  });
});
