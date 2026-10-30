/**
 * Converting live time values by their column's rule (D45, Story 2.1), and the start check that
 * every live time column has a rule. Absent values (NULL or empty text) stay absent. A value
 * that fits no rule is added to the report with its table, key and column and converts to
 * null: it is never guessed.
 */
import { parseLegacyTime, type Instant } from "@cashback/core";
import type BetterSqlite3 from "better-sqlite3";

import type { ImportReport } from "./import-report";
import { TIME_COLUMN_NAME, timeRule } from "./time-table";

export class CutoverRefusedError extends Error {
  constructor(
    readonly code:
      | "time_column_without_rule"
      | "live_production_file"
      | "live_ledger_path_missing"
      | "source_writable"
      | "source_missing"
      | "target_exists"
      | "fingerprint_key_missing"
      | "fingerprint_key_too_short"
      | "duplicate_identity",
    message: string,
  ) {
    super(message);
    this.name = "CutoverRefusedError";
  }
}

export interface ConvertedTime {
  instant: Instant | null;
  approximate: boolean;
}

/** `20YY-MM-DDT00:00:00+07:00` built from the order SN prefix, as live `parse_order_time` falls back. */
function isSnFallback(text: string, orderId: string): boolean {
  const m = /^20(\d{2})-(\d{2})-(\d{2})T00:00:00\+07:00$/.exec(text);
  return m !== null && orderId.startsWith(`${m[1]}${m[2]}${m[3]}`);
}

export interface TimeContext {
  table: string;
  column: string;
  /** The row's key, for the report. */
  key: string;
  /** For orders.recorded_at: the order id whose SN prefix may have produced the date. */
  orderId?: string;
}

/** Converts one live value by its column rule; a value that fits none is reported and becomes null. */
export function convertLiveTime(value: unknown, at: TimeContext, report: ImportReport): ConvertedTime {
  const rule = timeRule(at.table, at.column);
  if (!rule) throw new CutoverRefusedError("time_column_without_rule", `no time rule for ${at.table}.${at.column}`);
  if (rule.kind === "not-imported") throw new Error(`${at.table}.${at.column} is not imported: ${rule.reason}`);
  if (value === null || value === undefined || value === "") return { instant: null, approximate: false };
  const parsed = typeof value === "string" ? parseLegacyTime(value, rule.naive) : null;
  if (!parsed) {
    report.timeProblems.push({ table: at.table, key: at.key, column: at.column });
    return { instant: null, approximate: false };
  }
  const approximate = rule.approximateFromOrderSn === true && typeof value === "string" && isSnFallback(value.trim(), at.orderId ?? "");
  if (approximate) {
    const id = `${at.table}.${at.column}`;
    report.approximate[id] = (report.approximate[id] ?? 0) + 1;
  }
  return { instant: parsed.instant, approximate };
}

/** Every `table.column` of the live database that looks like a time and has no rule. */
export function columnsWithoutRule(source: BetterSqlite3.Database): string[] {
  const tables = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  const missing: string[] = [];
  for (const { name } of tables) {
    const columns = source.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid").all(name) as { name: string }[];
    for (const column of columns) {
      if (TIME_COLUMN_NAME.test(column.name) && !timeRule(name, column.name)) missing.push(`${name}.${column.name}`);
    }
  }
  return missing;
}

/** Refuses the import, naming the columns, when a live time column has no rule (Story 2.1 AC6). */
export function assertEveryTimeColumnHasRule(source: BetterSqlite3.Database): void {
  const missing = columnsWithoutRule(source);
  if (missing.length > 0) throw new CutoverRefusedError("time_column_without_rule", `live time columns without a conversion rule: ${missing.join(", ")}`);
}
