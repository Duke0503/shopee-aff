/**
 * Story 2.1: the per-column time conversion table (D45). Every entry has a fixture here: a value
 * in the form its live writer produces, and what a naive `2026-10-01 05:00:00` becomes in that
 * column (an instant, or reported when the column never had a naive writer).
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { emptyReport } from "../src/cutover/import-report";
import { assertEveryTimeColumnHasRule, columnsWithoutRule, convertLiveTime, CutoverRefusedError } from "../src/cutover/live-time";
import { LIVE_TIME_TABLE, TIME_COLUMN_NAME } from "../src/cutover/time-table";
import { buildLiveCopy, LIVE_SCHEMA_SQL } from "./helpers/live-fixture";

const VN = "2026-10-01T12:00:00+07:00";
const UTC_OFFSET = "2026-10-01T05:00:00+00:00";
const AT = "2026-10-01T05:00:00.000Z";
const NAIVE = "2026-10-01 05:00:00";
const NAIVE_AS_VN = "2026-09-30T22:00:00.000Z";

/** column -> [a value its writer produces, the instant], and what NAIVE becomes (null = reported). */
const FIXTURES: Record<string, { written: [string, string]; naive: string | null }> = {
  "customers.created_at": { written: [UTC_OFFSET, AT], naive: AT },
  "customers.consent_at": { written: [VN, AT], naive: null },
  "customers.password_set_at": { written: [UTC_OFFSET, AT], naive: null },
  "customers.locked_until": { written: [UTC_OFFSET, AT], naive: null },
  "customers.last_login_at": { written: [UTC_OFFSET, AT], naive: null },
  "customer_aliases.created_at": { written: [VN, AT], naive: null },
  "link_requests.created_at": { written: [VN, AT], naive: null },
  "link_requests.notified_at": { written: [VN, AT], naive: null },
  "orders.recorded_at": { written: ["2026-09-11T13:11:31+07:00", "2026-09-11T06:11:31.000Z"], naive: null },
  "orders.approved_at": { written: [VN, AT], naive: null },
  "orders.paid_at": { written: [VN, AT], naive: AT },
  "orders.updated_at": { written: [VN, AT], naive: AT },
  "orders.settled_at": { written: [VN, AT], naive: NAIVE_AS_VN },
  "state_history.changed_at": { written: [VN, AT], naive: null },
  "manual_review.created_at": { written: [VN, AT], naive: null },
  "reconciliation_runs.ran_at": { written: [VN, AT], naive: null },
  "reconciliation_runs.period_start": { written: [VN, AT], naive: null },
  "reconciliation_runs.period_end": { written: [VN, AT], naive: null },
  "products_cache.first_seen_at": { written: [VN, AT], naive: null },
  "products_cache.updated_at": { written: [VN, AT], naive: null },
  "sessions.created_at": { written: [UTC_OFFSET, AT], naive: null },
  "sessions.expires_at": { written: ["2031-10-01T05:00:00+00:00", "2031-10-01T05:00:00.000Z"], naive: null },
  "activity_logs.created_at": { written: [NAIVE, AT], naive: AT },
  "payment_transfers.created_at": { written: [NAIVE, AT], naive: AT },
  "payment_transfers.notified_at": { written: [NAIVE, AT], naive: AT },
  "group_info.updated_at": { written: [NAIVE, AT], naive: AT },
  "payout_batches.created_time": { written: [VN, AT], naive: null },
  "payout_batches.paid_time": { written: [VN, AT], naive: null },
  "payout_batches.created_at": { written: [VN, AT], naive: null },
  "payout_batches.updated_at": { written: [VN, AT], naive: null },
  "campaigns.starts_at": { written: ["2026-11-01T08:00", "2026-11-01T01:00:00.000Z"], naive: NAIVE_AS_VN },
  "campaigns.ends_at": { written: ["2026-11-11T00:00", "2026-11-10T17:00:00.000Z"], naive: NAIVE_AS_VN },
  "campaigns.created_at": { written: [VN, AT], naive: null },
  "campaign_awards.created_at": { written: [VN, AT], naive: null },
  "campaign_awards.confirmed_at": { written: [NAIVE, AT], naive: AT },
  "campaign_awards.paid_at": { written: [NAIVE, AT], naive: AT },
  "campaign_awards.voided_at": { written: [VN, AT], naive: null },
  "link_clicks.clicked_at": { written: [VN, AT], naive: null },
  "system_kv.updated_at": { written: [VN, AT], naive: null },
  "telegram_order_alerts.notified_at": { written: [VN, AT], naive: null },
};

const convert = (id: string, value: unknown, orderId?: string) => {
  const [table = "", column = ""] = id.split(".");
  const report = emptyReport();
  return { result: convertLiveTime(value, { table, column, key: "k1", orderId }, report), report };
};

describe("Story 2.1: every table entry has a fixture", () => {
  it("each instant entry has a fixture and each fixture an entry", () => {
    const instants = Object.entries(LIVE_TIME_TABLE).filter(([, rule]) => rule.kind === "instant").map(([id]) => id);
    expect(Object.keys(FIXTURES).sort()).toEqual(instants.sort());
  });

  for (const [id, fixture] of Object.entries(FIXTURES)) {
    it(`${id}: its writer's form converts to the UTC instant, and a naive value ${fixture.naive ? "reads in the column zone" : "is reported"}`, () => {
      expect(convert(id, fixture.written[0]).result.instant).toBe(fixture.written[1]);
      const naive = convert(id, NAIVE);
      expect(naive.result.instant).toBe(fixture.naive);
      expect(naive.report.timeProblems).toHaveLength(fixture.naive === null ? 1 : 0);
    });
  }

  it("every entry names its evidence in the live code", () => {
    for (const [id, rule] of Object.entries(LIVE_TIME_TABLE)) expect(rule.evidence, id).toMatch(/\.(py|tsx):\d+/);
  });

  it("not-imported columns refuse conversion instead of being read silently", () => {
    for (const [id] of Object.entries(LIVE_TIME_TABLE).filter(([, r]) => r.kind === "not-imported")) {
      expect(() => convert(id, VN), id).toThrow("is not imported");
    }
  });

  it("the table covers exactly the time columns of the live schema", () => {
    const db = new Database(":memory:");
    db.exec(LIVE_SCHEMA_SQL);
    expect(columnsWithoutRule(db)).toEqual([]);
    const live = new Set<string>();
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) {
      for (const c of db.prepare("SELECT name FROM pragma_table_info(?)").all(name) as { name: string }[]) live.add(`${name}.${c.name}`);
    }
    for (const id of Object.keys(LIVE_TIME_TABLE)) {
      expect(live.has(id), `${id} is not a live column`).toBe(true);
      expect(TIME_COLUMN_NAME.test(id.split(".")[1] ?? ""), id).toBe(true);
    }
    db.close();
  });
});

describe("Story 2.1 acceptance criteria", () => {
  it("AC1: 2026-10-01 05:00:00 in a CURRENT_TIMESTAMP column becomes 2026-10-01T05:00:00.000Z", () => {
    expect(convert("payment_transfers.created_at", "2026-10-01 05:00:00").result).toEqual({ instant: "2026-10-01T05:00:00.000Z", approximate: false });
    expect(convert("orders.paid_at", "2026-10-01 05:00:00").result.instant).toBe("2026-10-01T05:00:00.000Z");
  });

  it("AC2: a naive Vietnam campaign start 2026-11-01 08:00:00 becomes 2026-11-01T01:00:00.000Z", () => {
    expect(convert("campaigns.starts_at", "2026-11-01 08:00:00").result.instant).toBe("2026-11-01T01:00:00.000Z");
  });

  it("AC3: +07:00 and +00:00 values in the same column both become the right UTC instant", () => {
    for (const id of ["customers.created_at", "orders.paid_at", "orders.updated_at"]) {
      expect(convert(id, "2026-10-01T12:00:00+07:00").result.instant, id).toBe(AT);
      expect(convert(id, "2026-10-01T05:00:00+00:00").result.instant, id).toBe(AT);
    }
  });

  it("AC4: a recorded_at synthesized from the order SN prefix carries the approximate flag and is counted", () => {
    const report = emptyReport();
    const at = (orderId: string) => ({ table: "orders", column: "recorded_at", key: orderId, orderId });
    expect(convertLiveTime("2026-09-11T00:00:00+07:00", at("260911ABCD1234"), report)).toEqual({ instant: "2026-09-10T17:00:00.000Z", approximate: true });
    expect(convertLiveTime("2026-09-11T13:11:31+07:00", at("260911ABCD5678"), report).approximate).toBe(false);
    // Midnight on a different day than the SN prefix is a real report time.
    expect(convertLiveTime("2026-09-12T00:00:00+07:00", at("260911ABCD9999"), report).approximate).toBe(false);
    expect(report.approximate).toEqual({ "orders.recorded_at": 1 });
  });

  it("AC5: a value that fits no rule is listed with table, key and column and converts to no value", () => {
    const report = emptyReport();
    const result = convertLiveTime("not recorded", { table: "customers", column: "created_at", key: "1000000000000000004" }, report);
    expect(result.instant).toBeNull();
    expect(report.timeProblems).toEqual([{ table: "customers", key: "1000000000000000004", column: "created_at" }]);
    expect(convertLiveTime(1789107091, { table: "orders", column: "recorded_at", key: "o1" }, report).instant).toBeNull();
    expect(report.timeProblems).toHaveLength(2);
  });

  it("AC5: absent values stay absent and are not problems", () => {
    for (const value of [null, undefined, ""]) expect(convert("customers.consent_at", value)).toEqual({ result: { instant: null, approximate: false }, report: emptyReport() });
  });

  it("AC6: a live time column with no entry refuses the import and names the column", () => {
    const path = buildLiveCopy({ extraSql: "ALTER TABLE customers ADD COLUMN deleted_at TEXT; ALTER TABLE orders ADD COLUMN shipped_time TEXT;" });
    const db = new Database(path, { readonly: true });
    expect(() => assertEveryTimeColumnHasRule(db)).toThrow(CutoverRefusedError);
    expect(() => assertEveryTimeColumnHasRule(db)).toThrow("customers.deleted_at, orders.shipped_time");
    db.close();
  });
});
