/**
 * The text of one Telegram settlement notice for the DP Business group (D63), with the words from
 * packages/labels/vi/settlement-notices.json. It is rendered from the stored settlement at send
 * time: a notice row holds no amount, so a retried notice shows what the ledger holds then. An
 * amount or time not known is left out; a zero fee or tax is known and shown. It carries no customer
 * name. Every value filled in from outside is escaped for Telegram's HTML mode.
 */
import { formatVnAlertStamp, type Instant } from "@cashback/core";
import LABELS from "@cashback/labels/vi/settlement-notices.json" with { type: "json" };
import { and, count, eq, inArray } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { openSettlementCaseIds } from "../orders/index";
import { networkSettlementOrders, networkSettlements, type SettlementNoticeEvent } from "./schema";

type Settlement = typeof networkSettlements.$inferSelect;

const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);

/** As the order notices: `&`, `<` and `>` escaped for Telegram's HTML mode. */
const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const dottedDong = (amount: number): string => String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const amountLine = (template: string, amount: number | null): string[] => (amount === null ? [] : [fill(template, { amount: dottedDong(amount) })]);

const timeLine = (template: string, time: string | null): string[] => (time === null ? [] : [fill(template, { time: formatVnAlertStamp(time as Instant) })]);

const statusLine = (s: Settlement): string => fill(LABELS.line_status, { status: LABELS.statuses[s.status] });

function settledCount(db: LedgerDb, settlementId: number): number {
  const row = db
    .select({ n: count() })
    .from(networkSettlementOrders)
    .where(and(eq(networkSettlementOrders.settlementId, settlementId), eq(networkSettlementOrders.outcome, "SETTLED")))
    .get();
  return row?.n ?? 0;
}

/** The batch's open review cases, its own and those of the orders it refused, as the desk's detail reads them. */
function openCases(db: LedgerDb, s: Settlement): string {
  const lines = db.select({ orderId: networkSettlementOrders.orderId }).from(networkSettlementOrders).where(and(eq(networkSettlementOrders.settlementId, s.settlementId), inArray(networkSettlementOrders.outcome, ["CONFLICT", "NOT_APPROVED"]))).all();
  const ids = openSettlementCaseIds(db, s.network, s.networkPayoutId, lines.map((l) => l.orderId));
  return ids.map((id) => `#${id}`).join(", ");
}

/** Points at the batch's open review cases; a case staff already closed leaves the plain pointer. */
function mismatchCaseLine(db: LedgerDb, s: Settlement): string {
  const caseIds = openCases(db, s);
  return caseIds === "" ? LABELS.mismatch.case_none : fill(LABELS.mismatch.case_open, { caseIds });
}

/** A listed batch is stored MATCHED even with refused orders or orders above its gross: its open cases say so. */
function matchedCaseLines(db: LedgerDb, s: Settlement): string[] {
  const caseIds = openCases(db, s);
  return caseIds === "" ? [] : [fill(LABELS.matched.case_warning, { caseIds })];
}

/** What a notice shows after the header and the payout id. */
function detailLines(db: LedgerDb, event: SettlementNoticeEvent, s: Settlement): string[] {
  switch (event) {
    case "created":
      return [statusLine(s), ...amountLine(LABELS.line_gross, s.eligibleAmount), ...amountLine(LABELS.line_received, s.amount), ...amountLine(LABELS.line_fee, s.fee), ...amountLine(LABELS.line_tax, s.tax), ...timeLine(LABELS.line_created_at, s.createdAt)];
    case "paid":
      return [statusLine(s), ...amountLine(LABELS.line_received, s.amount), ...timeLine(LABELS.line_paid_at, s.paidAt)];
    case "failed":
      return [statusLine(s), ...amountLine(LABELS.failed.amount, s.amount)];
    case "matched":
      // Orders above the gross leave a negative rest, which is no amount of other orders.
      return [fill(LABELS.matched.orders_settled, { count: String(settledCount(db, s.settlementId)) }), ...amountLine(LABELS.matched.matched_gross, s.matchedGross), ...amountLine(LABELS.matched.unattributed, s.unattributed !== null && s.unattributed < 0 ? null : s.unattributed), ...matchedCaseLines(db, s)];
    case "mismatch":
      return [...amountLine(LABELS.line_gross, s.eligibleAmount), mismatchCaseLine(db, s)];
  }
}

/** Renders the notice of a settlement change; call inside `tx`, so it reads one state. */
export function renderSettlementNotice(db: LedgerDb, notice: { readonly settlementId: number; readonly event: SettlementNoticeEvent }): string {
  const settlement = db.select().from(networkSettlements).where(eq(networkSettlements.settlementId, notice.settlementId)).get();
  if (settlement === undefined) throw new RangeError(`no settlement for a ${notice.event} notice`);
  return [fill(LABELS[notice.event].header, { network: LABELS.networks[settlement.network] }), fill(LABELS.line_payout_id, { payoutId: escapeHtml(settlement.networkPayoutId) }), ...detailLines(db, notice.event, settlement)].join("\n");
}
