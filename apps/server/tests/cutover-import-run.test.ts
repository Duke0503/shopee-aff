/**
 * Story 2.2, review follow-up: how the import run stops and what it leaves behind. Duplicate
 * live identities stop it before writing; codes and Zalo ids are normalised and every change
 * recorded; the new ledger appears only on success, and the report is written either way.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ImportReport } from "../src/cutover/import-report";
import { partialPathFor, reportPathFor } from "../src/cutover/import-run";
import { MIGRATIONS_DIR } from "../src/platform/db/migrations";
import { buildLiveCopy, importOnce, rows, tempDir } from "./helpers/live-fixture";

const readReport = (target: string): ImportReport => JSON.parse(readFileSync(reportPathFor(target), "utf8")) as ImportReport;
const freshTarget = () => join(tempDir("cashback-cutover-"), "ledger.sqlite");

/** Live rows whose ids differ but whose normalised Zalo id or code is the same. */
const DUPLICATES = `
INSERT INTO customers (customer_id, zalo_user_id, display_name, status, created_at, role, customer_code) VALUES
  ('2000000000000000001', ' 3000000000000000001', 'Dup One', 'active', '2026-10-01T00:00:00+07:00', 'user', 'DP00100'),
  ('2000000000000000002', '3000000000000000001 ', 'Dup Two', 'active', '2026-10-01T00:00:00+07:00', 'user', 'DP00101'),
  ('2000000000000000003', NULL, 'Dup Three', 'active', '2026-10-01T00:00:00+07:00', 'user', 'dp00200'),
  ('2000000000000000004', NULL, 'Dup Four', 'active', '2026-10-01T00:00:00+07:00', 'user', 'DP00200 ');
`;

describe("duplicate live identities (review item 1)", () => {
  it("stops with duplicate_identity before writing, and the report names the rows", () => {
    const target = freshTarget();
    expect(() => importOnce(buildLiveCopy({ extraSql: DUPLICATES }), { targetPath: target })).toThrow(expect.objectContaining({ code: "duplicate_identity" }));
    expect(existsSync(target)).toBe(false);
    expect(existsSync(partialPathFor(target))).toBe(false);
    const report = readReport(target);
    expect(report.outcome).toMatchObject({ ok: false, reason: "duplicate_identity" });
    expect(report.duplicates).toEqual([
      { column: "zalo_user_id", keys: ["2000000000000000001", "2000000000000000002"] },
      { column: "customer_code", keys: ["2000000000000000003", "2000000000000000004"] },
    ]);
    // A Zalo id is personal data: the report names rows, never the shared value.
    expect(JSON.stringify(report)).not.toContain("3000000000000000001");
  });
});

describe("normalised codes and Zalo ids (review item 9)", () => {
  const extra = `
INSERT INTO customers (customer_id, zalo_user_id, display_name, status, created_at, role, customer_code) VALUES
  ('2000000000000000010', ' 3000000000000000010 ', 'Spaced', 'active', '2026-10-01T00:00:00+07:00', 'user', ' dp00300 ');`;
  const run = importOnce(buildLiveCopy({ extraSql: extra }));

  it("trims and upper-cases codes, trims Zalo ids, and records each change", () => {
    expect(rows(run.targetPath, "SELECT customer_code, zalo_user_id FROM customers WHERE customer_id = '2000000000000000010'")).toEqual([
      { customer_code: "DP00300", zalo_user_id: "3000000000000000010" },
    ]);
    expect(run.report.normalised).toEqual([
      { table: "customers", key: "2000000000000000010", column: "customer_code", from: " dp00300 ", to: "DP00300" },
      { table: "customers", key: "2000000000000000010", column: "zalo_user_id" },
    ]);
  });

  it("compares the normalised values row by row", () => {
    expect(run.report.comparison["customers"]).toEqual({ source: 10, imported: 10, mismatches: [] });
  });
});

describe("the new ledger appears only on success (review item 5)", () => {
  it("a failure deletes the partial files, keeps no target, writes the report with the reason, and a retry works", () => {
    const source = buildLiveCopy();
    const broken = join(tempDir("cashback-migrations-"), "migrations");
    mkdirSync(broken, { recursive: true });
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) writeFileSync(join(broken, file), readFileSync(join(MIGRATIONS_DIR, file)));
    writeFileSync(join(broken, "0999_broken.sql"), "CREATE TABLE half_done (id INTEGER PRIMARY KEY);\nTHIS IS NOT SQL;\n");

    const target = freshTarget();
    expect(() => importOnce(source, { targetPath: target, migrationsDir: broken })).toThrow();
    expect(readdirSync(dirname(target))).toEqual([`${"ledger.sqlite"}.import-report.json`]);
    expect(readReport(target).outcome).toMatchObject({ ok: false, reason: "failed" });
    expect(readReport(target).outcome.error).toContain("0999_broken.sql");

    const retry = importOnce(source, { targetPath: target });
    expect(retry.report.outcome.ok).toBe(true);
    expect(readdirSync(dirname(target)).sort()).toEqual(["ledger.sqlite", "ledger.sqlite.import-report.json"]);
    expect(readReport(target).outcome).toEqual({ ok: true, reason: null, error: null });
  });

  it("a stale partial file from an earlier crash is cleared before the run", () => {
    const target = freshTarget();
    writeFileSync(partialPathFor(target), "left over");
    writeFileSync(`${partialPathFor(target)}-wal`, "left over");
    expect(importOnce(buildLiveCopy(), { targetPath: target }).report.outcome.ok).toBe(true);
    expect(existsSync(`${partialPathFor(target)}-wal`)).toBe(false);
  });
});
