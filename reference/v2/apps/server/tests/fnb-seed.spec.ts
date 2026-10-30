import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApiFnbVouchers } from "@mmo/contracts";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { loadSeedVouchers } from "../src/modules/affiliate";

const DDL = [
  `CREATE TABLE fnb_vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT NOT NULL,
     title TEXT NOT NULL, description TEXT, voucher_type TEXT NOT NULL DEFAULT 'counter',
     code TEXT, barcode_url TEXT, affiliate_url TEXT, discount_text TEXT,
     min_order INTEGER DEFAULT 0, start_date TEXT, end_date TEXT,
     is_hot INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
];

const dbPath = join(tmpdir(), `cashback-fnb-seed-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;

beforeAll(async () => {
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
});

const list = async () => {
  const res = await server.inject({ method: "GET", url: "/api/fnb/vouchers" });
  expect(res.statusCode).toBe(200);
  return res.json() as ApiFnbVouchers;
};

describe("GET /api/fnb/vouchers on an empty database", () => {
  it("stocks the catalogue from the data file on the first read", async () => {
    const seed = loadSeedVouchers();
    expect(seed.length).toBeGreaterThan(0);

    const body = await list();
    expect(body.vouchers).toHaveLength(seed.length);
    expect(new Set(body.vouchers.map((voucher) => voucher.brand))).toEqual(
      new Set(["highlands", "thecoffeehouse"]),
    );
    expect(body.vouchers.some((voucher) => voucher.isHot)).toBe(true);
  });

  it("does not stock it twice", async () => {
    const first = await list();
    const second = await list();
    expect(second.vouchers).toHaveLength(first.vouchers.length);
  });
});
