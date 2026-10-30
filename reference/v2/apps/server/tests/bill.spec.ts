import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
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
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(customer_id),
     request_id TEXT, order_value INTEGER, estimated_commission INTEGER, approved_commission INTEGER,
     cashback_amount INTEGER, status TEXT NOT NULL, rejection_reason TEXT, recorded_at TEXT,
     approved_at TEXT, paid_at TEXT, updated_at TEXT NOT NULL, notified_status TEXT,
     platform TEXT NOT NULL DEFAULT 'shopee', settlement_status TEXT NOT NULL DEFAULT 'unsettled',
     payout_batch_id TEXT, settled_at TEXT)`,
  `CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL
     REFERENCES customers(customer_id), created_at TEXT NOT NULL, source_url TEXT NOT NULL,
     affiliate_url TEXT, estimated_commission INTEGER, channel TEXT,
     status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT, estimate_source TEXT,
     estimate_detail TEXT, attempts INTEGER NOT NULL DEFAULT 0,
     platform TEXT NOT NULL DEFAULT 'shopee', share_code TEXT)`,
  `CREATE TABLE payment_transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL,
     amount INTEGER NOT NULL, transfer_code TEXT, note TEXT, proof_image TEXT, order_ids TEXT,
     created_at TEXT NOT NULL, created_by TEXT, notify_mode TEXT, notified_at TEXT,
     target_group TEXT, bill_token TEXT)`,
  `CREATE TABLE campaigns (campaign_id TEXT PRIMARY KEY, name TEXT NOT NULL)`,
  `CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
     customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT, voided_at TEXT, notified_status TEXT)`,
];

const PROOF_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PROOF_NAME = "proof_1.jpg";

const dbPath = join(tmpdir(), `cashback-bill-${randomBytes(6).toString("hex")}.db`);
const proofsDir = join(tmpdir(), `cashback-proofs-${randomBytes(6).toString("hex")}`);
const proofUrl = `https://hoantiendp.com/uploads/proofs/${PROOF_NAME}`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let ownerCookie: string;
let otherCookie: string;
let adminCookie: string;

async function signIn(name: string, password: string): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { name, password },
  });
  const header = res.headers["set-cookie"];
  return String(Array.isArray(header) ? header[0] : header).split(";")[0] ?? "";
}

beforeAll(async () => {
  mkdirSync(proofsDir, { recursive: true });
  writeFileSync(join(proofsDir, PROOF_NAME), PROOF_BYTES);
  process.env.PROOFS_DIR = proofsDir;

  const raw = new Database(dbPath);
  for (const statement of DDL) raw.exec(statement);

  const addCustomer = raw.prepare(
    "INSERT INTO customers (customer_id, customer_code, display_name, bank_name, bank_account, role, created_at, password_hash)" +
      " VALUES (?,?,?,?,?,?,?,?)",
  );
  addCustomer.run(
    "C1",
    "DP00005",
    "Pham Thi E",
    "Vietcombank",
    "0123456789",
    "user",
    "2026-01-01T00:00:00",
    hashPassword("PASSC1", "s1"),
  );
  addCustomer.run(
    "C2",
    "DP00006",
    '"><script>alert(1)</script>',
    null,
    null,
    "user",
    "2026-01-01T00:00:00",
    hashPassword("PASSC2", "s2"),
  );
  addCustomer.run(
    "ADMIN",
    null,
    "Chu shop",
    null,
    null,
    "admin",
    "2026-01-01T00:00:00",
    hashPassword("PASSADM", "s3"),
  );

  const addTransfer = raw.prepare(
    "INSERT INTO payment_transfers (customer_id, amount, transfer_code, order_ids, proof_image, bill_token, created_at)" +
      " VALUES (?,?,?,?,?,?,?)",
  );
  addTransfer.run("C1", 10000, null, null, null, "older-token", "2026-10-01T09:00:00");
  addTransfer.run("C1", 67164, "FT999", "O1", proofUrl, "bill-token-abc", "2026-10-03T10:16:00");
  addTransfer.run(
    "C2",
    5000,
    null,
    null,
    "https://drive.google.com/file/d/1C2-4qDrJlcw/view",
    "other-token",
    "2026-10-04T09:00:00",
  );

  raw
    .prepare(
      "INSERT INTO orders (order_id, customer_id, request_id, order_value, cashback_amount, status, paid_at, recorded_at, updated_at)" +
        " VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run("O1", "C1", "R1", 300000, 62164, "paid", "2026-10-03T10:00:00", "2026-10-02T09:00:00", "2026-10-03T10:00:00");
  raw
    .prepare(
      "INSERT INTO link_requests (request_id, customer_id, created_at, source_url, estimate_detail)" +
        " VALUES (?,?,?,?,?)",
    )
    .run("R1", "C1", "2026-10-02T08:00:00", "https://shopee.vn/ao-i.1.2", '{"name":"Ao thun nam"}');
  raw.prepare("INSERT INTO campaigns (campaign_id, name) VALUES (?,?)").run("CAMP1", "Chao san 20k");
  raw
    .prepare(
      "INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, created_at)" +
        " VALUES (?,?,?,?,?,?)",
    )
    .run("CAMP1", "C1", "O1", 5000, "confirmed", "2026-10-03T10:00:00");
  raw.close();

  process.env.DB_PATH = dbPath;
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;

  ownerCookie = await signIn("C1", "PASSC1");
  otherCookie = await signIn("C2", "PASSC2");
  adminCookie = await signIn("ADMIN", "PASSADM");
});

afterAll(async () => {
  await app?.close();
  delete process.env.PROOFS_DIR;
});

describe("GET /b/:billToken", () => {
  it("shows the receipt to anyone holding the token", async () => {
    const res = await server.inject({ method: "GET", url: "/b/bill-token-abc" });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/html");
    const body = res.body;
    expect(body).toContain("Pham Thi E");
    expect(body).toContain("DP00005");
    expect(body).toContain("67.164đ");
    expect(body).toContain("77.164đ");
    expect(body).toContain("03/10/2026 10:16");
    expect(body).toContain("FT999");
    expect(body).toContain("Ao thun nam");
    expect(body).toContain("Mã đơn: O1");
    expect(body).toContain("Chao san 20k");
  });

  it("masks the bank account", async () => {
    const res = await server.inject({ method: "GET", url: "/b/bill-token-abc" });
    expect(res.body).toContain("01****6789");
    expect(res.body).not.toContain("0123456789");
  });

  it("escapes what the customer is called", async () => {
    const res = await server.inject({ method: "GET", url: "/b/other-token" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("<script>alert(1)</script>");
    expect(res.body).toContain("&lt;script&gt;");
  });

  it("sends an old numbered link to the sign-in page instead of a receipt", async () => {
    const res = await server.inject({ method: "GET", url: "/b/2" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Vui lòng đăng nhập");
    expect(res.body).not.toContain("Pham Thi E");
  });

  it("answers an unknown token with not-found", async () => {
    const res = await server.inject({ method: "GET", url: "/b/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("Không tìm thấy biên lai");
  });
});

describe("GET /api/proofs/:billToken", () => {
  it("refuses a caller with no session", async () => {
    const res = await server.inject({ method: "GET", url: "/api/proofs/bill-token-abc" });
    expect(res.statusCode).toBe(404);
  });

  it("serves the proof to the customer it belongs to", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/proofs/bill-token-abc",
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("image/jpeg");
    expect(String(res.headers["cache-control"])).toContain("private");
    expect(Buffer.from(res.rawPayload).equals(PROOF_BYTES)).toBe(true);
  });

  it("serves the proof to staff", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/proofs/bill-token-abc",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("refuses another customer, looking exactly like a missing bill", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/proofs/bill-token-abc",
      headers: { cookie: otherCookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("proof");
  });

  it("refuses a proof held somewhere else, and one that is not there", async () => {
    const elsewhere = await server.inject({
      method: "GET",
      url: "/api/proofs/other-token",
      headers: { cookie: otherCookie },
    });
    expect(elsewhere.statusCode).toBe(404);

    const none = await server.inject({
      method: "GET",
      url: "/api/proofs/older-token",
      headers: { cookie: ownerCookie },
    });
    expect(none.statusCode).toBe(404);
  });
});
