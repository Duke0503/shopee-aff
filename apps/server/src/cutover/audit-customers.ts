/**
 * The customer and network-batch parts of the cutover numbers audit (cutover-audit.ts). Per
 * customer: the live paid total against the new `paid`; what the live payout screen
 * (`_admin_payments` in src/cashback/web/dashboard.py on main) shows as payable, waiting and as
 * its QR amount, against the new `getBalances` payable and waiting. Per network payout batch: the
 * imported HISTORIC settlement against the live row and its raw report. Customer codes only.
 */
import { differenceDong, fromNetworkUnits, roundHalfUp, sumDong } from "@cashback/money";
import type BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { allBalances, type Balance } from "../modules/payouts/index";
import type { AuditSources } from "./audit-sources";
import type { AuditDifference } from "./cutover-audit";

/** The live payout screen's advertised rate (CASHBACK_RATE, 0.80) and fee factors (dashboard.py). */
const LIVE_RATE_PERCENT = 80n;
const LIVE_FEE_FACTOR_BPS: Readonly<Record<string, bigint>> = { shopee: 8902n, other: 9000n };

export interface CustomerLine {
  readonly code: string;
  readonly livePaid: number;
  readonly newPaid: number;
  /** Approved unpaid cashback plus bonuses on the live screen (settled and unsettled). */
  readonly livePayable: number;
  readonly newPayable: number;
  readonly liveWaiting: number;
  readonly newWaiting: number;
  /** The amount the live screen put in its QR code. */
  readonly liveQr: number;
  readonly reasons: readonly string[];
}

interface ScreenRow {
  customer_id: string;
  order_id: string;
  status: string;
  platform: string;
  settlement_status: string;
  estimated_commission: number | null;
  approved_commission: number | null;
  cashback_amount: number | null;
}

/** The live screen's query: unpaid, not rejected, joined on the stored customer id, guests left out. */
const SCREEN_SQL = `
SELECT o.customer_id, o.order_id, o.status, COALESCE(o.platform, 'shopee') AS platform, COALESCE(o.settlement_status, 'unsettled') AS settlement_status,
       o.estimated_commission, o.approved_commission, o.cashback_amount
  FROM orders o JOIN customers c ON c.customer_id = o.customer_id
 WHERE o.status != 'rejected' AND o.paid_at IS NULL AND COALESCE(c.role, 'user') != 'house'`;

/** The live screen's cashback of one order: the stored one, else commission x fee factor x rate, each rounded. */
function screenCashback(r: ScreenRow): number {
  if (r.cashback_amount !== null) return r.cashback_amount;
  const commission = r.approved_commission || r.estimated_commission || 0;
  const net = roundHalfUp(BigInt(commission) * (LIVE_FEE_FACTOR_BPS[r.platform === "shopee" ? "shopee" : "other"] ?? 9000n), 10000n);
  return roundHalfUp(BigInt(net) * LIVE_RATE_PERCENT, 100n);
}

interface Screen {
  payable: number[];
  unsettled: number[];
  waiting: number[];
  listedUnpayable: number;
}

function liveScreen(source: BetterSqlite3.Database): Map<string, Screen> {
  const bonus = new Map((source.prepare("SELECT order_id, amount FROM campaign_awards WHERE status != 'void'").all() as { order_id: string; amount: number }[]).map((a) => [a.order_id, a.amount]));
  const screens = new Map<string, Screen>();
  for (const r of source.prepare(SCREEN_SQL).all() as ScreenRow[]) {
    const s = screens.get(r.customer_id) ?? { payable: [], unsettled: [], waiting: [], listedUnpayable: 0 };
    screens.set(r.customer_id, s);
    const amount = screenCashback(r) + (bonus.get(r.order_id) ?? 0);
    if (r.status === "approved") (r.settlement_status === "settled" ? s.payable : s.unsettled).push(amount);
    else if (r.status === "awaiting_approval") s.waiting.push(amount);
    else s.listedUnpayable += 1;
  }
  return screens;
}

const NO_SCREEN: Screen = { payable: [], unsettled: [], waiting: [], listedUnpayable: 0 };

function customerLine(src: AuditSources, id: string, livePaid: number, screen: Screen, balance: Balance | undefined, out: AuditDifference[]): CustomerLine {
  const code = src.codeOf(id);
  const reasons: string[] = [];
  const diff = (field: string, live: number, now: number, reason: string | null) => {
    out.push({ section: "customers", key: code, field, live, imported: now, reason: reason ?? "unexplained", explained: reason !== null });
    reasons.push(reason ?? `unexplained_${field}`);
  };
  const settled = sumDong(screen.payable, "payable");
  const livePayable = sumDong([settled, ...screen.unsettled], "payable");
  const liveWaiting = sumDong(screen.waiting, "waiting");
  const unsettled = sumDong(screen.unsettled, "unsettled");
  const liveQr = settled > 0 ? settled : unsettled > 0 ? unsettled : liveWaiting;
  const now = { paid: balance?.paid ?? 0, payable: balance?.payable ?? 0, waiting: balance?.waiting ?? 0 };
  if (livePaid !== now.paid) diff("paid", livePaid, now.paid, null);
  if (livePayable !== now.payable) diff("payable", livePayable, now.payable, null);
  // Waiting is an estimate, never owed (D3): the live screen's formula and bonuses on awaiting orders differ by design.
  if (liveWaiting !== now.waiting) diff("waiting", liveWaiting, now.waiting, "estimate_not_owed");
  // The live bug: with nothing approved, the QR fell back to the awaiting estimate.
  if (liveQr !== livePayable) diff("live_qr", liveQr, now.payable, "live_qr_showed_awaiting");
  if (screen.listedUnpayable > 0) diff("live_listed_unpayable", screen.listedUnpayable, 0, "live_listed_unpayable_status");
  return { code, livePaid, newPaid: now.paid, livePayable, newPayable: now.payable, liveWaiting, newWaiting: now.waiting, liveQr, reasons };
}

export function auditCustomers(src: AuditSources, source: BetterSqlite3.Database, target: BetterSqlite3.Database): { lines: CustomerLine[]; differences: AuditDifference[] } {
  const balances = allBalances(drizzle({ client: target }));
  const screens = liveScreen(source);
  const paid = new Map<string, number[]>();
  for (const t of src.transfers) {
    const owner = src.resolve(t.customer_id) ?? t.customer_id;
    paid.set(owner, [...(paid.get(owner) ?? []), t.amount]);
  }
  // The live screen groups by the stored id; an order stored under an alias joins no customer row and is not shown.
  const ids = new Set([...paid.keys(), ...screens.keys(), ...balances.keys()].filter((id) => !src.houseIds.has(id)));
  const differences: AuditDifference[] = [];
  const lines = [...ids].sort().map((id) => customerLine(src, id, sumDong(paid.get(id) ?? [], "paid"), screens.get(id) ?? NO_SCREEN, balances.get(id), differences));
  return { lines, differences };
}

export function statusTotals(source: BetterSqlite3.Database, target: BetterSqlite3.Database): { live: Record<string, { orders: number; cashback: number }>; imported: Record<string, { orders: number; cashback: number }> } {
  const group = (db: BetterSqlite3.Database, column: string) =>
    Object.fromEntries((db.prepare(`SELECT status, COUNT(*) AS orders, COALESCE(SUM(${column}), 0) AS cashback FROM orders GROUP BY status ORDER BY status`).all() as { status: string; orders: number; cashback: number }[]).map((r) => [r.status, { orders: r.orders, cashback: r.cashback }]));
  return { live: group(source, "cashback_amount"), imported: group(target, "cashback") };
}

interface LiveBatch {
  batch_id: string;
  amount: number;
  eligible_amount: number;
  raw_json: string | null;
}

interface NewBatch {
  network_payout_id: string;
  amount: number;
  eligible_amount: number | null;
  withheld: number | null;
  fee: number | null;
  tax: number | null;
  match: string;
}

/** The raw report gives both totals in 1/100000 dong. */
const RAW_SCALE = 100_000;

function rawTotals(raw: string | null): { eligible: number; amount: number } | null {
  try {
    const parsed = JSON.parse(raw ?? "") as { eligibleTotalAmount?: string | number; totalPaymentAmount?: string | number };
    if (parsed.eligibleTotalAmount === undefined || parsed.totalPaymentAmount === undefined) return null;
    return { eligible: fromNetworkUnits(parsed.eligibleTotalAmount, RAW_SCALE), amount: fromNetworkUnits(parsed.totalPaymentAmount, RAW_SCALE) };
  } catch {
    return null;
  }
}

export function auditBatches(source: BetterSqlite3.Database, target: BetterSqlite3.Database): { checked: number; differences: AuditDifference[]; received: { live: number; imported: number } } {
  const live = source.prepare("SELECT batch_id, amount, eligible_amount, raw_json FROM payout_batches ORDER BY batch_id").all() as LiveBatch[];
  const imported = new Map((target.prepare("SELECT network_payout_id, amount, eligible_amount, withheld, fee, tax, match FROM network_settlements").all() as NewBatch[]).map((b) => [b.network_payout_id, b]));
  const differences: AuditDifference[] = [];
  for (const b of live) {
    const diff = (field: string, l: string | number | null, n: string | number | null, reason: string | null) => differences.push({ section: "batches", key: b.batch_id, field, live: l, imported: n, reason: reason ?? "unexplained", explained: reason !== null });
    const now = imported.get(b.batch_id);
    if (now === undefined) {
      diff("batch", b.amount, null, null);
      continue;
    }
    const raw = rawTotals(b.raw_json);
    if (raw === null) diff("raw_json", null, null, "raw_json_unreadable");
    else {
      if (raw.amount !== b.amount || raw.amount !== now.amount) diff("received", raw.amount, now.amount, null);
      if (raw.eligible !== b.eligible_amount || raw.eligible !== now.eligible_amount) diff("gross", raw.eligible, now.eligible_amount, null);
    }
    if (now.match !== "HISTORIC") diff("match", "HISTORIC", now.match, null);
    if (now.withheld === null) diff("withholding", null, null, "withholding_fits_no_split");
    else if (now.eligible_amount !== null && sumDong([now.fee ?? 0, now.tax ?? 0], "fee and tax") !== differenceDong(now.eligible_amount, now.amount)) diff("fee_plus_tax", differenceDong(now.eligible_amount, now.amount), sumDong([now.fee ?? 0, now.tax ?? 0], "fee and tax"), null);
  }
  for (const id of imported.keys()) if (!live.some((b) => b.batch_id === id)) differences.push({ section: "batches", key: id, field: "batch", live: null, imported: id, reason: "unexplained", explained: false });
  const received = { live: sumDong(live.map((b) => b.amount), "received"), imported: sumDong([...imported.values()].map((b) => b.amount), "received") };
  return { checked: live.length, differences, received };
}
