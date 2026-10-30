import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import { hasPrivateChat, registerFromZalo } from "./register-from-zalo.use-case";

const CUSTOMERS_DDL = `
CREATE TABLE customers (
  customer_id TEXT PRIMARY KEY, zalo_user_id TEXT, private_chat_id TEXT, display_name TEXT,
  bank_name TEXT, bank_account TEXT, account_holder TEXT, consent_at TEXT,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
  password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
  login_count INTEGER NOT NULL DEFAULT 0, customer_code TEXT
)`;
const ALIASES_DDL = `
CREATE TABLE customer_aliases (alias TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
  created_at TEXT NOT NULL, note TEXT)`;

const NOW = "2026-10-07T12:00:00";

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  db.run(sql.raw(CUSTOMERS_DDL));
  db.run(sql.raw(ALIASES_DDL));
  return db;
}

describe("registerFromZalo", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("creates a customer whose id is the Zalo UID", () => {
    const result = registerFromZalo(db, {
      zaloUserId: "8461",
      displayName: "Lan",
      privateChatId: "chat-1",
      nowIso: NOW,
    });
    expect(result).toEqual({ customerId: "8461", created: true });
    expect(hasPrivateChat(db, "8461")).toBe(true);
  });

  it("returns the existing customer instead of creating a duplicate", () => {
    const first = registerFromZalo(db, { zaloUserId: "8461", displayName: "Lan", privateChatId: "c1", nowIso: NOW });
    const second = registerFromZalo(db, { zaloUserId: "8461", displayName: "Lan", privateChatId: "c1", nowIso: NOW });
    expect(second).toEqual({ customerId: first.customerId, created: false });
  });

  it("never creates a new row for an alias", () => {
    registerFromZalo(db, { zaloUserId: "8461", displayName: "Lan", privateChatId: "c1", nowIso: NOW });
    db.run(sql`INSERT INTO customer_aliases (alias, customer_id, created_at) VALUES ('OLD9', '8461', ${NOW})`);
    const result = registerFromZalo(db, { zaloUserId: "OLD9", displayName: "Lan", privateChatId: "c2", nowIso: NOW });
    expect(result).toEqual({ customerId: "8461", created: false });
  });
});
