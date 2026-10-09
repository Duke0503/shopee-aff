import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
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

const TIKTOK = "https://www.tiktok.com/@shop/video/123";
const LAZADA = "https://www.lazada.vn/products/x-i123.html";
const dbPath = join(tmpdir(), `cashback-convert-at-${randomBytes(6).toString("hex")}.db`);
let accessTrade: Server;
let app: NestFastifyApplication;
let server: FastifyInstance;
let raw: Database.Database;

beforeAll(async () => {
  accessTrade = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/v2/tiktokshop_product_feeds/create_link") {
        response.end(
          JSON.stringify({
            status: true,
            aff_short_url: "https://shorten.accesstrade.vn/t/abc",
            product_name: "Ao thun",
            product_price: { amount: 100_000 },
            product_commission: { amount: 10_000 },
          }),
        );
      } else if (request.url === "/v1/product_link/create") {
        response.end(JSON.stringify({ data: [{ short_url: "https://shorten.asia/lazada/xyz" }] }));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "not found" }));
      }
    });
  });
  await new Promise<void>((resolve) => accessTrade.listen(0, "127.0.0.1", resolve));
  const address = accessTrade.address();
  const port = typeof address === "object" && address ? address.port : 0;

  process.env.ACCESSTRADE_API_KEY = "test-key";
  process.env.ACCESSTRADE_BASE_URL = `http://127.0.0.1:${port}`;

  raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  raw.prepare("INSERT INTO customers (customer_id, created_at) VALUES (?, ?)").run("HOUSE", "2026-01-01T00:00:00");

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
});

afterAll(async () => {
  await app?.close();
  raw.close();
  await new Promise<void>((resolve) => accessTrade.close(() => resolve()));
  delete process.env.ACCESSTRADE_API_KEY;
  delete process.env.ACCESSTRADE_BASE_URL;
});

const convert = (url: string) =>
  server.inject({ method: "POST", url: "/api/shopee/convert", payload: { url, customerId: "HOUSE" } });

describe("POST /api/shopee/convert with AccessTrade", () => {
  it("makes a TikTok link synchronously and stores it for polling", async () => {
    const res = await convert(TIKTOK);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ready: true,
      affiliate_url: "https://shorten.accesstrade.vn/t/abc",
      house: true,
    });

    const requestId = res.json().request_id as string;
    const status = await server.inject({ method: "GET", url: `/api/shopee/link-status?request_id=${requestId}` });
    expect(status.json()).toMatchObject({ ready: true, affiliate_url: "https://shorten.accesstrade.vn/t/abc" });
  });

  it("makes a Lazada link as well", async () => {
    const res = await convert(LAZADA);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ready: true, affiliate_url: "https://shorten.asia/lazada/xyz" });
  });
});
