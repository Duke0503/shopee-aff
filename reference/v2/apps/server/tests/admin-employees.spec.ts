import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
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
];

const dbPath = join(tmpdir(), `cashback-admin-employees-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;
let adminCookie: string;
let employeeCookie: string;

async function login(name: string, password: string): Promise<string> {
  const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { name, password } });
  const header = res.headers["set-cookie"];
  return String(Array.isArray(header) ? header[0] : header).split(";")[0] ?? "";
}

async function post(
  url: string,
  cookie: string | null,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return await server.inject({ method: "POST", url, payload, headers: cookie ? { cookie } : {} });
}

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const addCustomer = raw.prepare(
    "INSERT INTO customers (customer_id, display_name, bank_account, role, status, created_at, password_hash)" +
      " VALUES (?,?,?,?,?,?,?)",
  );
  addCustomer.run("admin", "Owner", null, "admin", "active", "2026-01-01T00:00:00", hashPassword("ADMINPASS", "s1"));
  addCustomer.run("EMP1", "Helper", null, "employee", "active", "2026-01-02T00:00:00", hashPassword("EMPPASS", "s2"));
  addCustomer.run("C1", "Lan", null, "user", "active", "2026-01-03T00:00:00", null);
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
  adminCookie = await login("admin", "ADMINPASS");
  employeeCookie = await login("EMP1", "EMPPASS");
});

afterAll(async () => {
  await app?.close();
});

describe("POST /api/admin/employees", () => {
  it("is admin only", async () => {
    const body = { username: "EMP2", password: "secret1" };
    expect((await post("/api/admin/employees", null, body)).statusCode).toBe(401);
    expect((await post("/api/admin/employees", employeeCookie, body)).statusCode).toBe(403);
  });

  it("creates a staff login that can sign in", async () => {
    const res = await post("/api/admin/employees", adminCookie, {
      username: "EMP2",
      password: "secret1",
      display_name: "Helper Two",
      role: "employee",
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ok: true,
      customerId: "EMP2",
      displayName: "Helper Two",
      role: "employee",
    });
    expect(await login("EMP2", "secret1")).not.toBe("");
  });

  it("refuses a duplicate login and a short password", async () => {
    expect((await post("/api/admin/employees", adminCookie, { username: "EMP1", password: "secret1" })).statusCode).toBe(400);
    expect((await post("/api/admin/employees", adminCookie, { username: "EMP7", password: "123" })).statusCode).toBe(400);
  });
});

describe("POST /api/admin/employees/update", () => {
  it("requires admin and a customer id", async () => {
    expect((await post("/api/admin/employees/update", employeeCookie, { customer_id: "EMP1" })).statusCode).toBe(403);
    expect((await post("/api/admin/employees/update", adminCookie, {})).statusCode).toBe(400);
  });

  it("changes role, status and password, and the list reflects it", async () => {
    const res = await post("/api/admin/employees/update", adminCookie, {
      customer_id: "EMP2",
      role: "admin",
      status: "disabled",
      new_password: "newpass1",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, updated: true });

    const list = await server.inject({
      method: "GET",
      url: "/api/admin/employees?search=EMP2",
      headers: { cookie: adminCookie },
    });
    expect(list.json().employees[0]).toMatchObject({ customerId: "EMP2", role: "admin", status: "disabled" });
  });

  it("never demotes or disables the root admin", async () => {
    expect((await post("/api/admin/employees/update", adminCookie, { customer_id: "admin", role: "employee" })).statusCode).toBe(400);
    expect((await post("/api/admin/employees/update", adminCookie, { customer_id: "admin", status: "disabled" })).statusCode).toBe(400);
  });

  it("reports an unknown employee", async () => {
    expect(
      (await post("/api/admin/employees/update", adminCookie, { customer_id: "nobody", role: "employee" })).statusCode,
    ).toBe(404);
  });
});
