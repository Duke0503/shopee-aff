import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInternalApp } from "../src/create-app";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
     private_chat_id TEXT, display_name TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT,
     consent_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
     password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
     locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
     login_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE customer_aliases (alias TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE campaigns (campaign_id TEXT PRIMARY KEY, name TEXT NOT NULL, starts_at TEXT NOT NULL,
     ends_at TEXT NOT NULL, slots INTEGER NOT NULL, bonus_vnd INTEGER NOT NULL,
     min_order_value INTEGER NOT NULL DEFAULT 0,
     platforms TEXT NOT NULL DEFAULT 'shopee,shopeefood,tiktok',
     excluded_customers TEXT NOT NULL DEFAULT '', per_customer INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL)`,
  `CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
     customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT, voided_at TEXT, notified_status TEXT)`,
];

const WIDE_END = "2999-01-01T00:00:00";
const TOKEN = "test-assistant-token";
const dbPath = join(tmpdir(), `cashback-campaign-offer-${randomBytes(6).toString("hex")}.db`);
let app: NestFastifyApplication;
let server: FastifyInstance;

const auth = { "x-assistant-token": TOKEN };

async function offer(customerId: string | null, platform: string) {
  const query = customerId === null ? `platform=${platform}` : `customer_id=${customerId}&platform=${platform}`;
  return server.inject({ method: "GET", url: `/internal/campaigns/offer?${query}`, headers: auth });
}

beforeAll(async () => {
  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);

  const addCustomer = raw.prepare(
    "INSERT INTO customers (customer_id, display_name, role, created_at) VALUES (?,?,?,?)",
  );
  addCustomer.run("C1", "Lan", "user", "2026-01-01T00:00:00");
  addCustomer.run("C2", "Mai", "user", "2026-01-01T00:00:00");
  addCustomer.run("C3", "Hoa", "user", "2026-01-01T00:00:00");
  addCustomer.run("HOUSE", "House", "house", "2026-01-01T00:00:00");
  addCustomer.run("EMP", "Staff", "employee", "2026-01-01T00:00:00");
  raw
    .prepare("INSERT INTO customer_aliases (alias, customer_id, created_at) VALUES (?,?,?)")
    .run("OLD1", "C1", "2026-01-01T00:00:00");

  const addCampaign = raw.prepare(
    "INSERT INTO campaigns (campaign_id, name, starts_at, ends_at, slots, bonus_vnd, min_order_value," +
      " platforms, excluded_customers, per_customer, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  );
  addCampaign.run("CMP_ALL", "Tet Sale", "2026-01-01T00:00:00", WIDE_END, 5, 20_000, 0,
    "shopee,tiktok", "C2", 0, "2026-01-01T00:00:00");
  addCampaign.run("CMP_CAP", "Food Week", "2026-02-01T00:00:00", WIDE_END, 10, 5_000, 0,
    "shopeefood", "", 1, "2026-02-01T00:00:00");
  addCampaign.run("CMP_OLD", "Last Year", "2020-01-01T00:00:00", "2020-02-01T00:00:00", 10, 9_000, 0,
    "lazada", "", 0, "2020-01-01T00:00:00");

  const addAward = raw.prepare(
    "INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, created_at)" +
      " VALUES (?,?,?,?,?,?)",
  );
  addAward.run("CMP_ALL", "C1", "O1", 20_000, "held", "2026-01-02T00:00:00");
  addAward.run("CMP_CAP", "C3", "O2", 5_000, "confirmed", "2026-02-02T00:00:00");

  raw.close();

  process.env.DB_PATH = dbPath;
  process.env.ASSISTANT_TOKEN = TOKEN;
  app = await createInternalApp();
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
});

afterAll(async () => {
  await app?.close();
});

describe("GET /internal/campaigns/offer", () => {
  it("needs the assistant token", async () => {
    const res = await server.inject({ method: "GET", url: "/internal/campaigns/offer?customer_id=C1&platform=shopee" });
    expect(res.statusCode).toBe(401);
  });

  it("needs a customer", async () => {
    expect((await offer(null, "shopee")).statusCode).toBe(400);
  });

  it("offers the running event and its remaining slots", async () => {
    const res = await offer("C1", "shopee");
    expect(res.json()).toEqual({
      ok: true,
      offer: { name: "Tet Sale", bonus: 20_000, slots: 5, left: 4, minOrderValue: 0, perCustomer: 0 },
    });
  });

  it("resolves the customer through an alias", async () => {
    expect((await offer("OLD1", "shopee")).json().offer).toMatchObject({ name: "Tet Sale" });
  });

  it("stays quiet for staff and the house account", async () => {
    expect((await offer("HOUSE", "shopee")).json()).toEqual({ ok: true, offer: null });
    expect((await offer("EMP", "shopee")).json()).toEqual({ ok: true, offer: null });
  });

  it("stays quiet for an excluded customer", async () => {
    expect((await offer("C2", "shopee")).json()).toEqual({ ok: true, offer: null });
  });

  it("stays quiet when the customer is already at their cap", async () => {
    expect((await offer("C3", "shopeefood")).json()).toEqual({ ok: true, offer: null });
  });

  it("stays quiet for a platform no running event covers", async () => {
    expect((await offer("C1", "lazada")).json()).toEqual({ ok: true, offer: null });
  });

  it("stays quiet for a key nobody owns", async () => {
    expect((await offer("NOPE", "shopee")).json()).toEqual({ ok: true, offer: null });
  });
});
