/**
 * The rows the cutover numbers audit compares (Story 8.8, owner request of 2026-11-02): read once
 * from the live copy and from the new ledger, both read-only, with the live owner of each row
 * resolved through `customer_aliases` the way the import resolves it. The audit (cutover-audit.ts)
 * recomputes what the import should have written from these rows alone, so it checks the import
 * instead of repeating it.
 */
import type BetterSqlite3 from "better-sqlite3";

import { emptyReport, type ReportNote } from "./import-report";
import { convertLiveTime } from "./live-time";

export interface LiveOrderRow {
  readonly order_id: string;
  readonly customer_id: string | null;
  readonly request_id: string | null;
  readonly status: string;
  readonly order_value: number | null;
  readonly estimated_commission: number | null;
  readonly approved_commission: number | null;
  readonly cashback_amount: number | null;
  readonly paid_at: string | null;
  readonly platform: string | null;
}

export interface NewOrderRow {
  readonly order_id: string;
  readonly customer_id: string | null;
  readonly request_id: string | null;
  readonly status: string;
  readonly order_value: number | null;
  readonly estimated_commission: number | null;
  readonly approved_commission: number | null;
  readonly cashback: number | null;
  readonly paid_at: string | null;
  readonly platform: string | null;
  readonly network: string | null;
}

export interface LiveTransferRow {
  readonly id: number;
  readonly customer_id: string;
  readonly amount: number;
  readonly order_ids: string | null;
}

export interface LiveAwardRow {
  readonly id: number;
  readonly customer_id: string;
  readonly order_id: string;
  readonly amount: number;
  readonly status: string;
}

export interface PayoutItemRow {
  readonly payout_id: number;
  readonly kind: "ORDER" | "AWARD";
  readonly order_id: string | null;
  readonly award_id: number | null;
  readonly amount: number;
}

export interface AuditSources {
  readonly liveOrders: readonly LiveOrderRow[];
  readonly newOrders: ReadonlyMap<string, NewOrderRow>;
  readonly transfers: readonly LiveTransferRow[];
  readonly newPayouts: ReadonlyMap<number, { readonly customer_id: string; readonly transfer_amount: number; readonly status: string }>;
  readonly items: readonly PayoutItemRow[];
  readonly liveAwards: readonly LiveAwardRow[];
  /** Live customer id or alias to the surviving live customer id; null when neither exists. */
  readonly resolve: (id: string | null) => string | null;
  readonly houseIds: ReadonlySet<string>;
  /** Surviving customer id to its customer code (HOUSE and staff have none: their id is used). */
  readonly codeOf: (id: string | null) => string;
  /** The import report's notes by `table:key`, the documented reasons. */
  readonly notes: ReadonlyMap<string, readonly ReportNote["kind"][]>;
  readonly paidWithoutPayout: ReadonlySet<string>;
}

const all = <T>(db: BetterSqlite3.Database, query: string): T[] => db.prepare(query).all() as T[];

export function readAuditSources(source: BetterSqlite3.Database, target: BetterSqlite3.Database, notes: readonly ReportNote[], paidWithoutPayout: readonly string[]): AuditSources {
  const customers = all<{ customer_id: string; customer_code: string | null; role: string | null }>(source, "SELECT customer_id, customer_code, role FROM customers");
  const ids = new Set(customers.map((c) => c.customer_id));
  const aliases = new Map(all<{ alias: string; customer_id: string }>(source, "SELECT alias, customer_id FROM customer_aliases").map((a) => [a.alias, a.customer_id]));
  const resolve = (id: string | null): string | null => {
    if (id === null || id === "") return null;
    if (ids.has(id)) return id;
    const to = aliases.get(id);
    return to !== undefined && ids.has(to) ? to : null;
  };
  const codes = new Map(customers.map((c) => [c.customer_id, (c.customer_code ?? "").trim().toUpperCase() || c.customer_id]));
  const byKey = new Map<string, ReportNote["kind"][]>();
  for (const n of notes) byKey.set(`${n.table}:${n.key}`, [...(byKey.get(`${n.table}:${n.key}`) ?? []), n.kind]);
  return {
    liveOrders: all<LiveOrderRow>(source, "SELECT order_id, customer_id, request_id, status, order_value, estimated_commission, approved_commission, cashback_amount, paid_at, platform FROM orders ORDER BY order_id"),
    newOrders: new Map(all<NewOrderRow>(target, "SELECT order_id, customer_id, request_id, status, order_value, estimated_commission, approved_commission, cashback, paid_at, platform, network FROM orders").map((o) => [o.order_id, o])),
    transfers: all<LiveTransferRow>(source, "SELECT id, customer_id, amount, order_ids FROM payment_transfers ORDER BY id"),
    newPayouts: new Map(all<{ payout_id: number; customer_id: string; transfer_amount: number; status: string }>(target, "SELECT payout_id, customer_id, transfer_amount, status FROM payouts").map((p) => [p.payout_id, p])),
    items: all<PayoutItemRow>(target, "SELECT payout_id, kind, order_id, award_id, amount FROM payout_items ORDER BY payout_id, line_no"),
    liveAwards: all<LiveAwardRow>(source, "SELECT id, customer_id, order_id, amount, status FROM campaign_awards ORDER BY id"),
    resolve,
    houseIds: new Set(customers.filter((c) => (c.role ?? "").toLowerCase() === "house").map((c) => c.customer_id)),
    codeOf: (id) => (id === null ? "(none)" : (codes.get(id) ?? id)),
    notes: byKey,
    paidWithoutPayout: new Set(paidWithoutPayout),
  };
}

/** A live time as the import converts it (the same column rule), or null. */
export function liveInstant(column: string, key: string, value: unknown): string | null {
  return convertLiveTime(value, { table: "orders", column, key, orderId: key }, emptyReport()).instant;
}
