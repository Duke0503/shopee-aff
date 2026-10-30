/**
 * Story 2.2: customers, aliases, codes and bank accounts imported unchanged from a read-only
 * copy of the live ledger (fixtures/live-schema.sql + fixtures/live-rows.sql).
 */
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sortKey } from "@cashback/core";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { runCutoverImport } from "../src/cutover/import-run";
import { openReadOnly } from "../src/cutover/live-source";
import { CutoverRefusedError } from "../src/cutover/live-time";
import { issueCustomerCode } from "../src/modules/identity/index";
import { openLedger } from "../src/platform/db/ledger";
import { createLogger } from "../src/platform/log/logger";
import { buildLiveCopy, FINGERPRINT_KEY, importOnce, rows, tempDir, TEST_CLOCK } from "./helpers/live-fixture";

const IDENTITY_TABLES = ["customers", "customer_aliases", "customer_code_counter", "bank_accounts"] as const;
const silent = { warn: () => undefined };

function dump(path: string): Record<string, unknown[]> {
  return Object.fromEntries(IDENTITY_TABLES.map((t) => [t, rows(path, `SELECT * FROM ${t} ORDER BY 1`)]));
}

/** Wraps an opener so the test can count the statements prepared on the source. */
function counting(open: (path: string) => Database.Database): { open: (path: string) => Database.Database; prepared: () => number } {
  let prepared = 0;
  return {
    prepared: () => prepared,
    open: (path) => {
      const db = open(path);
      const prepare = db.prepare.bind(db);
      db.prepare = ((query: string) => {
        prepared++;
        return prepare(query);
      }) as typeof db.prepare;
      return db;
    },
  };
}

const source = buildLiveCopy();
/** A live text field, read from the fixture so this file holds no Vietnamese (code.md section 2). */
const liveField = (customerId: string, column: string): string =>
  String((rows(source, `SELECT ${column} AS v FROM customers WHERE customer_id = '${customerId}'`)[0] as { v: string }).v);
const run = importOnce(source);

describe("Story 2.2 acceptance criteria", () => {
  it("AC1: every customer id, customer code and alias equals the source, row by row in the report", () => {
    expect(run.report.outcome).toEqual({ ok: true, reason: null, error: null });
    expect(run.report.comparison["customers"]).toEqual({ source: 9, imported: 9, mismatches: [] });
    expect(run.report.comparison["customer_aliases"]).toEqual({ source: 3, imported: 2, mismatches: [] });
    const ids = "SELECT customer_id, NULLIF(customer_code, '') AS customer_code FROM customers ORDER BY customer_id";
    expect(rows(run.targetPath, ids)).toEqual(rows(source, ids));
    expect(rows(run.targetPath, "SELECT alias, customer_id FROM customer_aliases ORDER BY alias")).toEqual(
      rows(source, "SELECT alias, customer_id FROM customer_aliases WHERE customer_id != 'ghost' ORDER BY alias"),
    );
    // The alias whose customer row is gone cannot be written; the report names it.
    expect(run.report.notes).toContainEqual({ kind: "alias_target_missing", table: "customer_aliases", key: "DP00009" });
  });

  it("AC2: after the highest live code DP00412 the next code is DP00413, and no code is reissued", () => {
    expect(run.report.counter).toEqual({ liveCounterLast: 412, highestAliasCode: "DP00009", importedCounterLast: 412, nextCode: "DP00413" });
    const { targetPath } = importOnce(source);
    const ledger = openLedger(targetPath);
    try {
      expect(ledger.tx((db) => issueCustomerCode(db, silent))).toBe("DP00413");
      expect(ledger.tx((db) => issueCustomerCode(db, silent))).toBe("DP00414");
      expect(() => ledger.sqlite.exec("UPDATE customer_code_counter SET last = 1")).toThrow("never goes down");
      expect(() => ledger.sqlite.exec("DELETE FROM customer_code_counter")).toThrow("never deleted");
      const insert = (id: string, code: string) => ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status) VALUES (?, ?, 'USER', 'ACTIVE')").run(id, code);
      expect(() => insert("NEW1", "DP00002")).toThrow("retired alias");
      expect(() => insert("NEW2", "DP00412")).toThrow("UNIQUE");
      expect(() => ledger.sqlite.exec("UPDATE customers SET customer_code = 'DP00999' WHERE customer_id = '1000000000000000001'")).toThrow("never changes");
      expect(() => ledger.sqlite.exec("UPDATE customers SET customer_id = 'X' WHERE customer_id = 'HOUSE'")).toThrow("never changes");
    } finally {
      ledger.close();
    }
  });

  it("AC2: a code can never be set to a retired alias by UPDATE either", () => {
    const { targetPath } = importOnce(source);
    const ledger = openLedger(targetPath);
    try {
      expect(() => ledger.sqlite.exec("UPDATE customers SET customer_code = 'DP00002' WHERE customer_id = 'nv01'")).toThrow("retired alias");
      expect(() => ledger.sqlite.exec("UPDATE customers SET customer_code = '9000000000000000002' WHERE customer_id = 'admin'")).toThrow("retired alias");
    } finally {
      ledger.close();
    }
  });

  it("AC2: the report keeps the live counter and the highest alias code apart from the raised value", () => {
    const copy = buildLiveCopy({ extraSql: "INSERT INTO customer_aliases (alias, customer_id, created_at) VALUES ('DP00500', '1000000000000000001', '2026-10-01T00:00:00+07:00');" });
    expect(importOnce(copy).report.counter).toEqual({ liveCounterLast: 412, highestAliasCode: "DP00500", importedCounterLast: 500, nextCode: "DP00501" });
  });

  it("AC3: the configured live production path is refused before any row is read", () => {
    const opener = counting(openReadOnly);
    const target = join(tempDir("cashback-cutover-"), "ledger.sqlite");
    const attempt = () => runCutoverImport({ sourcePath: source, targetPath: target, fingerprintKey: FINGERPRINT_KEY, liveLedgerPath: source, clock: TEST_CLOCK, logger: createLogger({ level: "fatal" }), openSource: opener.open });
    expect(attempt).toThrow(expect.objectContaining({ code: "live_production_file" }));
    expect(opener.prepared()).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  it("AC3: a source opened writable is refused before any row is read", () => {
    const opener = counting((path) => new Database(path));
    expect(() => importOnce(source, { openSource: opener.open })).toThrow(expect.objectContaining({ code: "source_writable" }));
    expect(opener.prepared()).toBe(0);
  });

  it("AC3: without LIVE_LEDGER_PATH the import refuses to run, so the production check is never skipped", () => {
    const opener = counting(openReadOnly);
    expect(() => importOnce(source, { liveLedgerPath: null, openSource: opener.open })).toThrow(expect.objectContaining({ code: "live_ledger_path_missing" }));
    expect(() => importOnce(source, { liveLedgerPath: "data/prod/ledger.sqlite" })).toThrow(expect.objectContaining({ code: "live_ledger_path_missing" }));
    expect(opener.prepared()).toBe(0);
  });

  it("AC3: the import refuses an existing target, the live file as target, and a missing or short fingerprint key", () => {
    expect(() => importOnce(source, { targetPath: source })).toThrow(expect.objectContaining({ code: "target_exists" }));
    const fresh = join(tempDir("cashback-cutover-"), "ledger.sqlite");
    expect(() => importOnce(source, { targetPath: fresh, liveLedgerPath: fresh })).toThrow(expect.objectContaining({ code: "live_production_file" }));
    expect(() => importOnce(source, { fingerprintKey: null })).toThrow(expect.objectContaining({ code: "fingerprint_key_missing" }));
    expect(() => importOnce(source, { fingerprintKey: "short" })).toThrow(expect.objectContaining({ code: "fingerprint_key_too_short" }));
    expect(() => importOnce(join(tempDir("cashback-cutover-"), "missing.sqlite"))).toThrow(CutoverRefusedError);
  });

  it("AC4: number, bank and upper-case holder are kept with consent time; log and report show only the last four", () => {
    const accounts = rows(run.targetPath, "SELECT customer_id, bank_name, account_number, holder_name, consent_at, fingerprint, pending_confirmation FROM bank_accounts ORDER BY customer_id");
    const fingerprint = (n: string) => createHmac("sha256", FINGERPRINT_KEY).update(n).digest("hex");
    expect(accounts).toEqual([
      { customer_id: "1000000000000000001", bank_name: "VCB", account_number: "0011 2233 4455", holder_name: "NGUYEN VAN AN", consent_at: "2026-09-01T03:00:00.000Z", fingerprint: fingerprint("001122334455"), pending_confirmation: 0 },
      { customer_id: "1000000000000000002", bank_name: "TPB", account_number: "1234-5678-90", holder_name: liveField("1000000000000000002", "account_holder").toUpperCase(), consent_at: "2026-09-25T01:30:00.000Z", fingerprint: fingerprint("1234567890"), pending_confirmation: 0 },
      { customer_id: "1000000000000000003", bank_name: null, account_number: "9988776655", holder_name: null, consent_at: null, fingerprint: fingerprint("9988776655"), pending_confirmation: 0 },
    ]);
    expect(run.report.bankAccounts).toEqual({ imported: 3, lastFour: ["4455", "7890", "6655"] });
    const reportFile = readFileSync(`${run.targetPath}.import-report.json`, "utf8");
    for (const text of [run.lines.join("\n"), JSON.stringify(run.report), reportFile]) {
      for (const full of ["0011 2233 4455", "001122334455", "1234-5678-90", "1234567890", "9988776655"]) expect(text).not.toContain(full);
    }
    expect(run.lines.filter((l) => l.includes("cutover.bank_account.imported")).map((l) => (JSON.parse(l) as { lastFour: string }).lastFour)).toEqual(["4455", "7890", "6655"]);
    expect(run.report.notes).toEqual(
      expect.arrayContaining([
        { kind: "bank_account_incomplete", table: "customers", key: "1000000000000000003", detail: "...6655" },
        { kind: "bank_consent_missing", table: "customers", key: "1000000000000000003", detail: "...6655" },
        { kind: "bank_account_incomplete", table: "customers", key: "1000000000000000005", detail: "no account number" },
      ]),
    );
  });

  it("AC5: the same source imported twice into two fresh ledgers gives identical ledgers", () => {
    const [first, second] = [importOnce(source), importOnce(source)];
    expect(dump(second.targetPath)).toEqual(dump(first.targetPath));
    expect(second.report).toEqual(first.report);
    expect(second.report).toEqual(run.report);
  });
});

describe("Story 2.2: the rest of each customer row", () => {
  type Customer = Record<string, string | number | null>;
  const byId = new Map((rows(run.targetPath, "SELECT * FROM customers") as Customer[]).map((c) => [c["customer_id"], c]));

  it("converts every time by its column rule and reports what fits none (Story 2.1 AC5)", () => {
    expect(byId.get("1000000000000000001")).toMatchObject({ created_at: "2026-08-01T02:00:00.000Z", password_set_at: "2026-09-02T03:00:00.000Z", last_sign_in_at: "2026-10-01T01:02:03.000Z" });
    expect(byId.get("1000000000000000002")?.["created_at"]).toBe("2026-09-24T08:15:00.000Z");
    expect(byId.get("1000000000000000004")?.["created_at"]).toBeNull();
    expect(byId.get("1000000000000000009")?.["last_sign_in_at"]).toBeNull();
    expect(run.report.timeProblems.filter((p) => p.table === "customers")).toEqual([
      { table: "customers", key: "1000000000000000004", column: "created_at" },
      { table: "customers", key: "1000000000000000009", column: "last_login_at" },
    ]);
  });

  it("maps the live HOUSE row and staff to roles without codes, and keeps statuses, sign-in state and the erased-like row", () => {
    expect(byId.get("HOUSE")).toMatchObject({ role: "HOUSE", customer_code: null, status: "ACTIVE" });
    expect(byId.get("admin")).toMatchObject({ role: "ADMIN", customer_code: null, password_hash: "pbkdf2_sha256$fake$hash-admin" });
    expect(byId.get("nv01")).toMatchObject({ role: "EMPLOYEE", status: "DISABLED" });
    expect(byId.get("1000000000000000001")).toMatchObject({ role: "USER" });
    expect(byId.get("1000000000000000005")).toMatchObject({ failed_sign_ins: 5, locked_until: "2026-10-30T05:15:00.000Z" });
    expect(byId.get("1000000000000000004")).toMatchObject({ display_name: null, zalo_user_id: null, status: "DISABLED", search_text: "dp00007", customer_code: "DP00007" });
  });

  it("builds search_text and sort_key from the name", () => {
    expect(byId.get("1000000000000000001")).toMatchObject({ search_text: "nguyenvanan|dp00001" });
    expect(byId.get("1000000000000000005")?.["sort_key"]).toBe(sortKey(liveField("1000000000000000005", "display_name")));
  });

  it("never writes the live copy", () => {
    const before = readFileSync(source);
    importOnce(source);
    expect(readFileSync(source).equals(before)).toBe(true);
  });
});
