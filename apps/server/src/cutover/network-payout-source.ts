/**
 * Reading the live network payouts (D59, Story 4.21): each `payout_batches` row the live payout
 * sync saved (payout_sync.py: one Shopee payout record, status paid, processing or failed, its
 * total and eligible amounts already in dong) becomes one network settlement. The live status is
 * mapped to status-flows.md section 7; a platform that names no network, an unknown status or an
 * amount that is not whole dong is listed in the report and not imported. Times follow the
 * column rules of time-table.ts.
 */
import type BetterSqlite3 from "better-sqlite3";

import type { ImportedNetworkSettlement } from "../modules/payouts/index";
import type { ImportReport } from "./import-report";
import { convertLiveTime } from "./live-time";
import { blank, wholeDong } from "./live-values";

interface LiveBatch {
  batch_id: string;
  platform: string | null;
  status: string | null;
  amount: unknown;
  eligible_amount: unknown;
  created_time: unknown;
  paid_time: unknown;
}

const STATUS: Readonly<Record<string, ImportedNetworkSettlement["status"]>> = { paid: "PAID", processing: "PROCESSING", failed: "FAILED" };
const NETWORK: Readonly<Record<string, ImportedNetworkSettlement["network"]>> = { shopee: "shopee", accesstrade: "accesstrade" };

const hasTable = (source: BetterSqlite3.Database): boolean => source.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payout_batches'").get() !== undefined;

export function readLiveNetworkPayouts(source: BetterSqlite3.Database, report: ImportReport): ImportedNetworkSettlement[] {
  if (!hasTable(source)) return [];
  const rows = source.prepare("SELECT batch_id, platform, status, amount, eligible_amount, created_time, paid_time FROM payout_batches ORDER BY batch_id").all() as LiveBatch[];
  return rows.flatMap((row) => {
    const note = (kind: ImportReport["notes"][number]["kind"], detail: string): [] => {
      report.notes.push({ kind, table: "payout_batches", key: row.batch_id, detail });
      return [];
    };
    const network = NETWORK[(blank(row.platform, { trim: true }) ?? "").toLowerCase()];
    if (network === undefined) return note("network_payout_unknown_platform", String(row.platform));
    const status = STATUS[(blank(row.status, { trim: true }) ?? "").toLowerCase()];
    if (status === undefined) return note("network_payout_unknown_status", String(row.status));
    const amount = wholeDong(row.amount, { allowZero: true });
    if (amount === null) return note("network_payout_amount_not_whole_dong", "amount");
    const time = (column: string, value: unknown) => convertLiveTime(value, { table: "payout_batches", column, key: row.batch_id }, report).instant;
    return [{ network, networkPayoutId: row.batch_id, status, amount, eligibleAmount: wholeDong(row.eligible_amount, { allowZero: true }), createdAt: time("created_time", row.created_time), paidAt: time("paid_time", row.paid_time) }];
  });
}
