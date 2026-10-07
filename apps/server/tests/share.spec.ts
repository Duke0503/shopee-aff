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
  `CREATE TABLE link_clicks (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL,
     clicked_at TEXT NOT NULL, agent TEXT NOT NULL)`,
];

const CODE = "aZ3k9QpL";
const dbPath = join(tmpdir(), `cashback-share-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;

const clickCount = (): number => {
  const raw = new Database(dbPath, { readonly: true });
  const row = raw.prepare("SELECT COUNT(*) AS n FROM link_clicks").get() as { n: number };
  raw.close();
  return row.n;
};

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  raw.exec("INSERT INTO customers (customer_id, created_at) VALUES ('C1', '2026-01-01T00:00:00')");
  raw
    .prepare(
      "INSERT INTO link_requests (request_id, customer_id, created_at, source_url, affiliate_url, status, estimate_detail, share_code)" +
        " VALUES (?,?,?,?,?,?,?,?)",
    )
    .run("R1", "C1", "2026-10-05T12:00:00", "https://shopee.vn/x-i.1.2", "https://s.shopee.vn/aff", "pending", '{"name":"Chuot Razer"}', CODE);
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
});

afterAll(async () => {
  await app?.close();
});

describe("share link /s/<code>", () => {
  it("shows the product page to everyone", async () => {
    const res = await server.inject({ method: "GET", url: `/s/${CODE}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Chuot Razer");
  });

  it("does not log a link-preview bot", async () => {
    const before = clickCount();
    await server.inject({
      method: "GET",
      url: `/s/${CODE}`,
      headers: { "user-agent": "facebookexternalhit/1.1" },
    });
    expect(clickCount()).toBe(before);
  });

  it("logs a real visit", async () => {
    const before = clickCount();
    await server.inject({ method: "GET", url: `/s/${CODE}`, headers: { "user-agent": "Mozilla/5.0" } });
    expect(clickCount()).toBe(before + 1);
  });

  it("redirects the buy button to the affiliate link", async () => {
    const res = await server.inject({ method: "GET", url: `/s/${CODE}/go` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://s.shopee.vn/aff");
  });

  it("404s an unknown code", async () => {
    expect((await server.inject({ method: "GET", url: "/s/zzzzzzzz" })).statusCode).toBe(404);
  });
});
