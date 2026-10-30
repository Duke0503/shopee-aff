import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApiTopDeals } from "@mmo/contracts";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
];

const dbPath = join(tmpdir(), `cashback-topdeal-${randomBytes(6).toString("hex")}.db`);
let accessTrade: Server;
let app: NestFastifyApplication;
let server: FastifyInstance;
let lastQuery = "";
let answer: unknown = {};
let status = 200;

beforeAll(async () => {
  accessTrade = createServer((request, response) => {
    lastQuery = request.url ?? "";
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => accessTrade.listen(0, "127.0.0.1", resolve));
  const address = accessTrade.address();
  const port = typeof address === "object" && address ? address.port : 0;

  process.env.ACCESSTRADE_API_KEY = "test-key";
  process.env.ACCESSTRADE_BASE_URL = `http://127.0.0.1:${port}`;

  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
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
  await new Promise<void>((resolve) => accessTrade.close(() => resolve()));
  delete process.env.ACCESSTRADE_API_KEY;
  delete process.env.ACCESSTRADE_BASE_URL;
});

const topDeal = async (query = "") => {
  const res = await server.inject({ method: "GET", url: `/api/tiktok/topdeal${query}` });
  expect(res.statusCode).toBe(200);
  return res.json() as ApiTopDeals;
};

describe("GET /api/tiktok/topdeal", () => {
  it("reads AccessTrade's feed and answers in the bot's own key names", async () => {
    answer = {
      status: true,
      data: {
        products: [
          {
            id: "1729",
            title: "Tai nghe bluetooth",
            detail_link: "https://www.tiktok.com/view/product/1729",
            original_price: { minimum_amount: "250.000", maximum_amount: "300.000" },
            commission: { rate: 1250, amount: "30.000" },
            main_image_url: "https://img.example/1729.jpg",
            units_sold: 4321,
            shop: { name: "Shop" },
          },
        ],
      },
    };

    const body = await topDeal("?q=tai%20nghe&limit=5");
    expect(body.ok).toBe(true);
    expect(body.products).toEqual([
      {
        title: "Tai nghe bluetooth",
        detail_link: "https://www.tiktok.com/view/product/1729",
        price: 250_000,
        price_formatted: "250.000đ",
        commission_rate: 0.125,
        commission_rate_pct: 12.5,
        commission_amount: 30_000,
        image_url: "https://img.example/1729.jpg",
        units_sold: 4321,
        shop_name: "Shop",
        product_id: "1729",
      },
    ]);
    expect(lastQuery).toContain("sort_field=units_sold");
    expect(lastQuery).toContain("limit=5");
    expect(lastQuery).toContain("title_keywords=tai+nghe");
  });

  it("shows nothing rather than an error when the feed has no products", async () => {
    status = 200;
    answer = { status: true, data: { products: [] } };
    expect(await topDeal()).toEqual({ ok: true, products: [] });
  });

  it("shows nothing when AccessTrade cannot be reached", async () => {
    status = 500;
    answer = { error: "boom" };
    expect(await topDeal()).toEqual({ ok: true, products: [] });
  });
});
