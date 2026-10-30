import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";

import { BUSY_TIMEOUT_MS, openLedger, type Ledger, type LedgerDb } from "../src/platform/db/ledger";
import { AsyncTransactionError, LedgerBusyError, TransactionEndedError } from "../src/platform/db/transaction";
import { SERVER_DIR } from "./helpers/server-process";

/** A test table; business tables arrive with the stories that need them. */
const notes = sqliteTable("notes", { id: integer("id").primaryKey(), body: text("body").notNull() });

const opened: Ledger[] = [];

function freshLedger(): { ledger: Ledger; path: string } {
  const path = join(mkdtempSync(join(tmpdir(), "cashback-ledger-")), "data", "dev", "ledger.sqlite");
  const ledger = openLedger(path);
  ledger.sqlite.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  opened.push(ledger);
  return { ledger, path };
}

const count = (ledger: Ledger): number => (ledger.sqlite.prepare("SELECT count(*) AS n FROM notes").get() as { n: number }).n;

afterEach(() => {
  for (const ledger of opened.splice(0)) if (ledger.sqlite.open) ledger.close();
});

/** Holds the write lock from another process for `holdMs`, as a backup or reader might. */
async function holdWriteLock(path: string, holdMs: number): Promise<void> {
  const script = `const D=require("better-sqlite3");const d=new D(process.argv[1]);d.exec("BEGIN IMMEDIATE");console.log("held");setTimeout(()=>{d.exec("ROLLBACK");d.close()},Number(process.argv[2]));`;
  const child = spawn(process.execPath, ["-e", script, path, String(holdMs)], { cwd: SERVER_DIR, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("exit", (code) => reject(new Error(`lock holder exited early: ${code}`)));
  });
}

describe("ledger pragmas (Story 1.6 AC1, AD-2)", () => {
  it("opens on an empty data directory with WAL, foreign keys on, busy_timeout 1000 and synchronous NORMAL", () => {
    const { ledger } = freshLedger();
    expect(ledger.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(ledger.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(ledger.sqlite.pragma("busy_timeout", { simple: true })).toBe(BUSY_TIMEOUT_MS);
    expect(ledger.sqlite.pragma("synchronous", { simple: true })).toBe(1);
  });
});

describe("tx(fn) (Story 1.6 AC2, code.md §5)", () => {
  it("commits a synchronous write through Drizzle and returns its result", () => {
    const { ledger } = freshLedger();
    const id = ledger.tx((db) => db.insert(notes).values({ body: "a" }).returning({ id: notes.id }).get().id);
    expect(id).toBe(1);
    expect(count(ledger)).toBe(1);
  });

  it("AC2: throws and commits nothing when fn is async", async () => {
    const { ledger } = freshLedger();
    // eslint-disable-next-line no-restricted-syntax -- this test proves the runtime guard behind the lint rule
    expect(() => ledger.tx(async (db) => db.insert(notes).values({ body: "before await" }).run())).toThrow(AsyncTransactionError);
    expect(count(ledger)).toBe(0);
    expect(ledger.sqlite.inTransaction).toBe(false);
  });

  it("AC2: throws and commits nothing when fn returns a promise", () => {
    const { ledger } = freshLedger();
    expect(() =>
      ledger.tx((db) => {
        db.insert(notes).values({ body: "x" }).run();
        return Promise.resolve(1);
      }),
    ).toThrow(AsyncTransactionError);
    expect(count(ledger)).toBe(0);
  });

  it("review item 6: an async function passed by reference throws, and its code after await cannot write", async () => {
    const { ledger } = freshLedger();
    let lateError: unknown;
    async function writeAcrossAwait(db: LedgerDb): Promise<void> {
      db.insert(notes).values({ body: "before await" }).run();
      await Promise.resolve();
      try {
        db.insert(notes).values({ body: "after await" }).run();
      } catch (error) {
        lateError = error;
      }
    }
    expect(() => ledger.tx(writeAcrossAwait)).toThrow(AsyncTransactionError);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lateError).toBeInstanceOf(TransactionEndedError);
    expect(count(ledger)).toBe(0);
  });

  it("review item 6: a handle kept after the transaction ended refuses every use", () => {
    const { ledger } = freshLedger();
    let kept: LedgerDb | undefined;
    ledger.tx((db) => {
      kept = db;
      db.insert(notes).values({ body: "inside" }).run();
    });
    expect(() => kept?.insert(notes).values({ body: "outside" }).run()).toThrow(TransactionEndedError);
    expect(count(ledger)).toBe(1);
  });

  it("rolls back every write when fn throws", () => {
    const { ledger } = freshLedger();
    expect(() =>
      ledger.tx((db) => {
        db.insert(notes).values({ body: "x" }).run();
        throw new Error("rule broken");
      }),
    ).toThrow("rule broken");
    expect(count(ledger)).toBe(0);
  });

  it("refuses a nested transaction: one command is one transaction", () => {
    const { ledger } = freshLedger();
    expect(() => ledger.tx(() => ledger.tx(() => 1))).toThrow(/nested/);
    expect(ledger.sqlite.inTransaction).toBe(false);
  });

  it("runs in BEGIN IMMEDIATE, so the write lock is held from the start", () => {
    const { ledger, path } = freshLedger();
    const other = new Database(path, { timeout: 0 });
    try {
      ledger.tx(() => {
        expect(() => other.exec("BEGIN IMMEDIATE")).toThrow(/locked|busy/i);
      });
    } finally {
      other.close();
    }
  });
});

describe("busy ledger (Story 1.6 AC3)", () => {
  it("AC3: fails with a typed ledger_busy error after the timeout and one retry, leaving no partial write", async () => {
    const { ledger, path } = freshLedger();
    await holdWriteLock(path, 4_000);
    const started = performance.now();
    let error: unknown;
    try {
      ledger.tx((db) => db.insert(notes).values({ body: "x" }).run());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(LedgerBusyError);
    expect((error as LedgerBusyError).code).toBe("ledger_busy");
    expect(performance.now() - started).toBeGreaterThanOrEqual(2 * BUSY_TIMEOUT_MS - 100);
    expect(ledger.sqlite.inTransaction).toBe(false);
    expect(count(ledger)).toBe(0);
  }, 15_000);

  it("succeeds on the retry when the lock is released within the second wait", async () => {
    const { ledger, path } = freshLedger();
    await holdWriteLock(path, 1_400);
    ledger.tx((db) => db.insert(notes).values({ body: "x" }).run());
    expect(count(ledger)).toBe(1);
  }, 15_000);

  it("reads with plain SQL through the same Drizzle handle", () => {
    const { ledger } = freshLedger();
    expect(ledger.db.get<{ one: number }>(sql`SELECT 1 AS one`)).toEqual({ one: 1 });
  });
});
