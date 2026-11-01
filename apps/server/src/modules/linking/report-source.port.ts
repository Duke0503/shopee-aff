/**
 * Where report rows come from (AD-8, AD-22, FR-12): a `ReportSource` yields one network's
 * normalized rows, each with a stable fingerprint and its purchase time. The shadow run reads
 * files the operator saved (decision H10); reconciliation will read the AccessTrade API through
 * the same port. A read is all or nothing: a source that hits its page cap, or whose saved
 * pages say rows are missing, throws `report_page_cap` and hands the caller no partial set
 * (D43), so nothing is ever frozen or changed from half a report.
 *
 * Reconciliation (Stories 3.7, 3.8) reads through `WindowedReportSource`: the same all-or-nothing
 * read, asked for one purchase-time window (the hourly 7 days, or one day of the nightly sweep).
 * AccessTrade answers it from its API; Shopee in production from its report pages through the
 * browser bridge (shopee-bridge.adapter.ts, Story 5.9), in rehearsals and dev from a saved file.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { instantFromMs, toMs, type Instant } from "@cashback/core";
import type { AffiliateNetwork } from "@cashback/money";

import type { ReportRow } from "./domain/report-row";

export interface SourcedRow extends ReportRow {
  /** sha256 over everything reconciliation reads from the row; equal rows give equal fingerprints. */
  readonly fingerprint: string;
  /** When the buyer purchased, when the report says; places the row in the report window. */
  readonly purchasedAt: Instant | null;
}

export interface SourcedReport {
  readonly network: AffiliateNetwork;
  /** A short description of the input (file name or endpoint), never a secret. */
  readonly source: string;
  readonly rows: readonly SourcedRow[];
  /** Input lines the source skipped as the live reader does (an export line with no order id). */
  readonly skippedLines: number;
  /** sha256 of the exact bytes the rows were parsed from; null for a live API read. */
  readonly sha256: string | null;
  /** A file source's modification time; absent or null for a live API read. */
  readonly modifiedAt?: Instant | null;
}

export interface ReportSource {
  readonly network: AffiliateNetwork;
  read(): Promise<SourcedReport>;
}

/** A purchase-time window, half-open: `since` included, `until` excluded. */
export interface ReportWindow {
  readonly since: Instant;
  readonly until: Instant;
}

export interface WindowedReportSource {
  readonly network: AffiliateNetwork;
  /** Reads every row purchased inside the window, or throws `ReportSourceError`; never a partial set. */
  read(window: ReportWindow, signal?: AbortSignal): Promise<SourcedReport>;
}

/**
 * The rows of a whole report that fall inside the window, for a source that cannot ask the network
 * for a window (a saved file). A row without a purchase time is kept: it cannot be placed, and
 * applying it again is a fingerprint skip.
 */
/**
 * A saved file read, parsed and hashed once while it is unchanged (same modification time and
 * size): every run and every day slice of the sweep cuts its window from the one parse in memory.
 * The report carries the file's modification time, so a run can tell a stale file (D43).
 */
export function cachedFileReport(path: string, read: () => SourcedReport): () => SourcedReport {
  let cached: { key: string; report: SourcedReport } | null = null;
  return () => {
    let key: string;
    let modifiedAt: Instant;
    try {
      const stat = statSync(path);
      key = `${stat.mtimeMs}:${stat.size}`;
      modifiedAt = instantFromMs(Math.trunc(stat.mtimeMs));
    } catch (error) {
      throw new ReportSourceError("report_file_unreadable", `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (cached?.key !== key) cached = { key, report: { ...read(), modifiedAt } };
    return cached.report;
  };
}

export function withinWindow(report: SourcedReport, window: ReportWindow): SourcedReport {
  const since = toMs(window.since);
  const until = toMs(window.until);
  const inside = (row: SourcedRow) => row.purchasedAt === null || (toMs(row.purchasedAt) >= since && toMs(row.purchasedAt) < until);
  return { ...report, rows: report.rows.filter(inside) };
}

export type ReportSourceErrorCode =
  | "report_page_cap"
  | "report_page_missing"
  | "report_duplicate_page"
  | "report_file_unreadable"
  | "report_mapping_incomplete"
  | "report_fetch_failed"
  | "report_window_too_long"
  | "report_source_unavailable";

export class ReportSourceError extends Error {
  constructor(
    readonly code: ReportSourceErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ReportSourceError";
  }
}

/** A file read once: its bytes' sha256 and its text, so the checksum names exactly what was parsed. */
export function readReportFile(path: string): { text: string; sha256: string } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new ReportSourceError("report_file_unreadable", `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return { text: bytes.toString("utf8"), sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** The row's fingerprint: its network, ids, raw and mapped statuses, amounts, sub_ids and problems. */
export function fingerprintRow(row: ReportRow): string {
  const items = row.items.map((i) => [i.itemId, i.rawStatus, i.status, i.commissionParts, i.value]);
  const content = [row.network, row.orderId, row.rawOrderStatus, row.orderStatus, items, row.subIds, row.problems];
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export const sourced = (row: ReportRow, purchasedAt: Instant | null): SourcedRow => ({ ...row, fingerprint: fingerprintRow(row), purchasedAt });

/** The pages of a saved or fetched report: refuses with `report_page_cap` when they hold fewer rows than the report's total. */
export function assertComplete(collected: number, total: number | null, what: string): void {
  if (total !== null && collected < total) {
    throw new ReportSourceError("report_page_cap", `${what}: ${collected} of ${total} rows read; save or fetch every page before the run`);
  }
}
