/**
 * The text of one Telegram order notice for the DP Business group (D62), in the live format
 * (src/cashback/core/telegram_alerts.py), with the words from packages/labels/vi/order-notices.json.
 * It is rendered from the order as it is at send time: a notice row holds no name or amount, so an
 * erased customer's name is simply gone. Every value filled in is escaped for Telegram's HTML mode.
 *
 * One difference from live: the step's time line is when the step was taken, not when the message
 * left, so a retried notice keeps its true time.
 */
import { formatVnAlertStamp, type Instant } from "@cashback/core";
import LABELS from "@cashback/labels/vi/order-notices.json" with { type: "json" };
import { estimatedCashback } from "@cashback/money";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { customerCardOf, earnsNothing, ledgerOwnerOf, type LedgerOwner } from "../identity/index";
import { orders, type BusinessNoticeEvent } from "./schema";

type OrderFacts = typeof orders.$inferSelect;

const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);

/** As the live `_sanitize_html`: `&`, `<` and `>` escaped for Telegram's HTML mode. */
const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const dottedDong = (amount: number): string => String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** One amount line, or none: live leaves out a missing or zero amount. */
const amountLine = (template: string, amount: number | null): string[] => (amount === null || amount === 0 ? [] : [fill(template, { amount: dottedDong(amount) })]);

/** As Python's `str.title()` on the live fallback: each word capitalised. */
const titleCase = (text: string): string => text.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_all, before: string, letter: string) => `${before}${letter.toUpperCase()}`);

function platformLabel(platform: string): string {
  const key = platform.toLowerCase();
  const known = Object.hasOwn(LABELS.platforms, key) ? LABELS.platforms[key as keyof typeof LABELS.platforms] : fill(LABELS.platform_other, { platform: titleCase(platform) });
  return escapeHtml(known);
}

/** The guest label for HOUSE or no customer; else the surviving record's name and id, or the id alone once erased. */
function customerText(db: LedgerDb, customerId: string | null, owner: LedgerOwner | null): string {
  if (customerId === null || owner?.role === "HOUSE") return LABELS.customer_guest;
  const id = owner?.customerId ?? customerId;
  const name = customerCardOf(db, id)?.displayName?.trim() ?? "";
  if (name === "") return id;
  return name === id ? name : fill(LABELS.customer_named, { name, id });
}

function reasonLabel(event: "rejected" | "reversed", reason: string | null): string {
  if (event === "reversed") return LABELS.reasons.reversed;
  return reason !== null && Object.hasOwn(LABELS.reasons, reason) ? LABELS.reasons[reason as keyof typeof LABELS.reasons] : LABELS.reasons.default;
}

/** What a notice shows between the customer and the times. */
function detailLines(event: BusinessNoticeEvent, order: OrderFacts, owner: LedgerOwner | null): string[] {
  const value = amountLine(LABELS.line_order_value, order.orderValue);
  switch (event) {
    case "recorded": {
      // What the customer is told (owner decision, D62): after the fee and withheld tax; a guest earns nothing.
      const cashback = estimatedCashback(order.estimatedCommission, order.network, order.customerId === null || earnsNothing(owner, order.recordedAt));
      return [...value, ...amountLine(LABELS.recorded.commission, order.estimatedCommission), ...amountLine(LABELS.recorded.cashback, cashback)];
    }
    case "approved":
      return [...value, ...amountLine(LABELS.approved.commission, order.approvedCommission), ...amountLine(LABELS.approved.cashback, order.cashback)];
    case "rejected":
    case "reversed":
      return [...value, fill(LABELS.rejected.reason, { reason: escapeHtml(reasonLabel(event, order.rejectionReason)) })];
    case "paid":
      return amountLine(LABELS.paid.amount, order.cashback);
  }
}

/** Renders the notice of an order step; call inside `tx`, so it reads one state. */
export function renderBusinessNotice(db: LedgerDb, notice: { readonly orderId: string; readonly event: BusinessNoticeEvent; readonly raisedAt: string }): string {
  const order = db.select().from(orders).where(eq(orders.orderId, notice.orderId)).get();
  if (order === undefined) throw new RangeError(`no order for a ${notice.event} notice`);
  const texts = notice.event === "reversed" ? LABELS.rejected : LABELS[notice.event];
  const owner = order.customerId === null ? null : ledgerOwnerOf(db, order.customerId);
  const status = notice.event === "recorded" && order.status === "FROZEN" ? LABELS.recorded.status_frozen : texts.status;
  const stepTime = formatVnAlertStamp(notice.raisedAt as Instant);
  const times = order.recordedAt === null ? [fill(texts.time_alone, { time: stepTime })] : [fill(LABELS.line_order_time, { time: formatVnAlertStamp(order.recordedAt as Instant) }), fill(texts.time_after_order_time, { time: stepTime })];
  return [
    fill(texts.header, { platform: platformLabel(order.platform) }),
    fill(LABELS.line_order_id, { orderId: escapeHtml(order.orderId) }),
    status,
    fill(LABELS.line_customer, { customer: escapeHtml(customerText(db, order.customerId, owner)) }),
    ...detailLines(notice.event, order, owner),
    ...times,
  ].join("\n");
}
