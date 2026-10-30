import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApiFnbDeals, ApiFnbVouchers } from "@mmo/contracts";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";

const DDL = [
  `CREATE TABLE fnb_vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT NOT NULL,
     title TEXT NOT NULL, description TEXT, voucher_type TEXT NOT NULL DEFAULT 'counter',
     code TEXT, barcode_url TEXT, affiliate_url TEXT, discount_text TEXT,
     min_order INTEGER DEFAULT 0, start_date TEXT, end_date TEXT,
     is_hot INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
];

const dbPath = join(tmpdir(), `cashback-fnb-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);
  const add = raw.prepare(
    "INSERT INTO fnb_vouchers (brand, title, description, voucher_type, code, discount_text," +
      " min_order, is_hot, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  );
  // The owner's own rows: the seed catalogue must leave them exactly as they are.
  add.run("highlands", "Voucher A", "", "counter", "HL1", "Giam 30K", 135_000, 1, 1, "t", "t");
  add.run("thecoffeehouse", "Voucher B", "", "counter", "TCH1", "Mua 2 tang 1", 0, 1, 1, "t", "t");
  add.run("highlands", "Voucher C", "", "counter", "HL2", "Da tat", 0, 0, 0, "t", "t");
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

const vouchers = async (query = "") => {
  const res = await server.inject({ method: "GET", url: `/api/fnb/vouchers${query}` });
  expect(res.statusCode).toBe(200);
  return res.json() as ApiFnbVouchers;
};

describe("GET /api/fnb/vouchers", () => {
  it("is public and lists only what is switched on", async () => {
    const body = await vouchers();
    expect(body.ok).toBe(true);
    expect(body.vouchers.map((voucher) => voucher.code)).toEqual(["HL1", "TCH1"]);
  });

  it("renders the amount the customer has to reach", async () => {
    const body = await vouchers();
    expect(body.vouchers[0]).toMatchObject({
      brand: "highlands",
      voucherType: "counter",
      minOrder: 135_000,
      minOrderFormatted: "135.000đ",
      isHot: true,
      barcodeUrl: "",
    });
  });

  it("filters by brand and by voucher type, in either case", async () => {
    const highlands = await vouchers("?brand=Highlands");
    expect(highlands.vouchers.every((voucher) => voucher.brand === "highlands")).toBe(true);
    expect(highlands.vouchers).toHaveLength(1);

    expect((await vouchers("?type=online")).vouchers).toEqual([]);
    expect((await vouchers("?brand=thecoffeehouse&type=counter")).vouchers).toHaveLength(1);
  });
});

describe("GET /api/fnb/deals-of-the-day", () => {
  it("lists the hot ones, brand by brand", async () => {
    const res = await server.inject({ method: "GET", url: "/api/fnb/deals-of-the-day" });
    const body = res.json() as ApiFnbDeals;
    expect(body.ok).toBe(true);
    expect(body.deals.map((deal) => deal.code)).toEqual(["HL1", "TCH1"]);
    expect(body.deals[0]).toMatchObject({ discountText: "Giam 30K" });
  });
});
