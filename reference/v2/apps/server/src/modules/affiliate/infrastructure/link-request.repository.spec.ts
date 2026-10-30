import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import {
  attachAffiliateUrl,
  findByShareCode,
  findOwnRequest,
  markLinkDelivered,
  recordLinkRequest,
  setShareCode,
} from "./link-request.repository";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
     customer_code TEXT, zalo_user_id TEXT, display_name TEXT, private_chat_id TEXT,
     bank_name TEXT, bank_account TEXT, account_holder TEXT, consent_at TEXT,
     status TEXT NOT NULL DEFAULT 'active', password_hash TEXT, password_set_at TEXT,
     failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
     role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT, login_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL
     REFERENCES customers(customer_id), created_at TEXT NOT NULL, source_url TEXT NOT NULL,
     affiliate_url TEXT, estimated_commission INTEGER, channel TEXT,
     status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT, estimate_source TEXT,
     estimate_detail TEXT, attempts INTEGER NOT NULL DEFAULT 0,
     platform TEXT NOT NULL DEFAULT 'shopee', share_code TEXT)`,
];

const NOW = "2026-10-07T12:00:00";
const URL_A = "https://shopee.vn/x-i.1.2";

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  for (const statement of DDL) db.run(sql.raw(statement));
  db.run(sql`INSERT INTO customers (customer_id, created_at) VALUES ('C1', '2026-01-01T00:00:00')`);
  db.run(sql`INSERT INTO customers (customer_id, created_at) VALUES ('C2', '2026-01-01T00:00:00')`);
  return db;
}

const request = (over: Partial<Parameters<typeof recordLinkRequest>[1]> = {}) => ({
  requestId: "R1",
  customerId: "C1",
  sourceUrl: URL_A,
  platform: "shopee",
  createdAt: "2026-10-05T12:00:00",
  ...over,
});

describe("link-request repository", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("reuses the same customer's recent request, and nobody else's", () => {
    recordLinkRequest(db, request());
    expect(
      findOwnRequest(db, { customerId: "C1", sourceUrls: [URL_A], attributionDays: 7, nowIso: NOW })?.requestId,
    ).toBe("R1");
    expect(
      findOwnRequest(db, { customerId: "C2", sourceUrls: [URL_A], attributionDays: 7, nowIso: NOW }),
    ).toBeNull();
  });

  it("does not reuse a request past the window", () => {
    recordLinkRequest(db, request({ createdAt: "2026-09-01T12:00:00" }));
    expect(
      findOwnRequest(db, { customerId: "C1", sourceUrls: [URL_A], attributionDays: 7, nowIso: NOW }),
    ).toBeNull();
  });

  it("never reuses a failed request", () => {
    recordLinkRequest(db, request());
    db.run(sql`UPDATE link_requests SET status='failed' WHERE request_id='R1'`);
    expect(
      findOwnRequest(db, { customerId: "C1", sourceUrls: [URL_A], attributionDays: 7, nowIso: NOW }),
    ).toBeNull();
  });

  it("marks a link delivered", () => {
    recordLinkRequest(db, request());
    markLinkDelivered(db, "R1", NOW);
    const own = findOwnRequest(db, {
      customerId: "C1",
      sourceUrls: [URL_A],
      attributionDays: 7,
      nowIso: NOW,
    });
    expect(own?.notifiedAt).toBe(NOW);
  });

  it("stores a share code and finds it back", () => {
    recordLinkRequest(db, request());
    attachAffiliateUrl(db, "R1", "https://s.shopee.vn/aff");
    setShareCode(db, "R1", "aZ3k9QpL");
    expect(findByShareCode(db, "aZ3k9QpL")?.requestId).toBe("R1");
    expect(findByShareCode(db, "short")).toBeNull();
  });

  it("refuses an invalid share code", () => {
    recordLinkRequest(db, request());
    expect(() => setShareCode(db, "R1", "has-dash")).toThrow(/invalid share code/);
  });
});
