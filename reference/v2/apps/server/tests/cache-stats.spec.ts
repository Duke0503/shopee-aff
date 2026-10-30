import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApiCacheStats } from "@mmo/contracts";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";

const DDL = [
  `CREATE TABLE products_cache (item_id TEXT PRIMARY KEY, shop_id TEXT, name TEXT, price INTEGER,
     price_formatted TEXT, shopee_rate REAL, seller_rate REAL, shopee_part INTEGER,
     shopee_part_formatted TEXT, seller_part INTEGER, seller_part_formatted TEXT,
     total_commission INTEGER, commission_formatted TEXT, is_capped INTEGER DEFAULT 0,
     cashback INTEGER, cashback_formatted TEXT, rate_percent TEXT, affiliate_url TEXT,
     canonical_url TEXT, request_count INTEGER DEFAULT 1, first_seen_at TEXT NOT NULL,
     updated_at TEXT NOT NULL, image_url TEXT)`,
];

const dbPath = join(tmpdir(), `cashback-cache-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const add = raw.prepare(
    "INSERT INTO products_cache (item_id, shop_id, name, price, price_formatted, cashback," +
      " cashback_formatted, rate_percent, affiliate_url, canonical_url, request_count," +
      " first_seen_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  add.run("i1", "s1", "Cold one", 100_000, "100.000đ", 8_000, "8.000đ", "80%", "https://aff/1", "https://shopee.vn/product/s1/i1", 3, "t1", "t3");
  add.run("i2", "s1", "Hot one", 200_000, "200.000đ", 16_000, "16.000đ", "80%", null, "https://shopee.vn/product/s1/i2", 9, "t1", "t2");
  add.run("i3", "s2", "Middle one", 50_000, "50.000đ", 4_000, "4.000đ", "80%", "https://aff/3", "https://shopee.vn/product/s2/i3", 5, "t1", "t1");
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

describe("GET /api/shopee/cache/stats", () => {
  it("counts the cache, and how much of it can be linked to", async () => {
    const res = await server.inject({ method: "GET", url: "/api/shopee/cache/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ApiCacheStats;
    expect(body.ok).toBe(true);
    expect(body.total_cached).toBe(3);
    expect(body.with_affiliate_url).toBe(2);
  });

  it("shows the most asked-for products first", async () => {
    const res = await server.inject({ method: "GET", url: "/api/shopee/cache/stats" });
    const body = res.json() as ApiCacheStats;
    expect(body.top_products.map((product) => product.item_id)).toEqual(["i2", "i3", "i1"]);
  });

  it("keeps the column names the bot already reads", async () => {
    const res = await server.inject({ method: "GET", url: "/api/shopee/cache/stats" });
    const body = res.json() as ApiCacheStats;
    expect(body.top_products[0]).toMatchObject({
      item_id: "i2",
      shop_id: "s1",
      name: "Hot one",
      price: 200_000,
      price_formatted: "200.000đ",
      cashback: 16_000,
      cashback_formatted: "16.000đ",
      affiliate_url: null,
      request_count: 9,
      updated_at: "t2",
    });
  });
});
