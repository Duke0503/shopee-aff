import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import {
  createSession,
  deleteSession,
  deleteSessionsForCustomer,
  findSessionCustomer,
} from "./session.repository";

const NOW = "2026-10-07T12:00:00";

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  db.run(
    sql`CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  );
  return db;
}

describe("session repository", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("creates a session and finds the customer by token", () => {
    createSession(db, "C1", "tok-abc", NOW, "2026-11-07T12:00:00");
    expect(findSessionCustomer(db, "tok-abc", NOW)).toBe("C1");
  });

  it("does not store the token itself", () => {
    createSession(db, "C1", "tok-abc", NOW, "2026-11-07T12:00:00");
    const hashes = db.all(sql`SELECT token_hash FROM sessions`) as { token_hash: string }[];
    expect(hashes[0]?.token_hash).not.toBe("tok-abc");
  });

  it("returns null for an unknown or expired token", () => {
    createSession(db, "C1", "tok-abc", NOW, "2026-10-01T00:00:00");
    expect(findSessionCustomer(db, "tok-abc", NOW)).toBeNull();
    expect(findSessionCustomer(db, "nope", NOW)).toBeNull();
    expect(findSessionCustomer(db, "", NOW)).toBeNull();
  });

  it("deletes one session, or all of a customer's sessions", () => {
    createSession(db, "C1", "a", NOW, "2026-11-07T12:00:00");
    createSession(db, "C1", "b", NOW, "2026-11-07T12:00:00");
    deleteSession(db, "a");
    expect(findSessionCustomer(db, "a", NOW)).toBeNull();
    expect(findSessionCustomer(db, "b", NOW)).toBe("C1");
    deleteSessionsForCustomer(db, "C1");
    expect(findSessionCustomer(db, "b", NOW)).toBeNull();
  });
});
