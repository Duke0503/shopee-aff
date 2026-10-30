/**
 * What the live system already told each customer, as outbox dedup keys (D46, Story 2.5). Live
 * notifications.py marks a link request told by `notified_at` (a link handed over, or the
 * apology for a failed one, 141-265 and 525-555) and an order by `notified_status`, the last
 * status the customer heard about (notified when it differs from `status`, 400-512). Each told
 * event is seeded as sent so the first run after the import sends it again to no one; each
 * event the live system had still to tell is listed for the owner (none is made due here); the
 * event owed is the one of the order's imported status, so a live order forced to PAID owes
 * `paid`. Ids are percent-encoded in keys (encodeDedupKeyId); an id that cannot make a key is
 * noted, never thrown out of the import. A
 * guest (HOUSE) is never told anything (D5), so no key is seeded or listed for one. Payouts and
 * campaign awards are imported, and their keys seeded, with Story 2.4.
 */
import type { Instant, OrderStatus } from "@cashback/core";

import type { ImportedLinkRequest } from "../modules/linking/index";
import type { ImportedOrder } from "../modules/orders/index";
import { dedupKey, type SeededNotification } from "../modules/messaging/index";
import type { ImportReport, NotificationsSection } from "./import-report";
import { told, type LiveLinkRequest } from "./link-source";
import type { LiveOrder } from "./order-source";

type OrderEvent = { event: string; messageKey: string };

const RECORDED: OrderEvent = { event: "recorded", messageKey: "order_recorded" };
const APPROVED: OrderEvent = { event: "approved", messageKey: "order_approved" };
const REJECTED: OrderEvent = { event: "rejected", messageKey: "order_rejected" };
const PAID: OrderEvent = { event: "paid", messageKey: "order_paid" };

/** What the live system told: its `notified_status` is a live status (repository.py:25-28). */
const TOLD_EVENTS: Readonly<Record<string, OrderEvent>> = { awaiting_approval: RECORDED, approved: APPROVED, rejected: REJECTED, paid: PAID };

/** What the customer is owed: the event of the order's imported status. FROZEN and REVERSED have none here. */
const DUE_EVENTS: Partial<Record<OrderStatus, OrderEvent>> = { AWAITING_APPROVAL: RECORDED, APPROVED, REJECTED, PAID };

const toldEvent = (status: string | null) => (status !== null && Object.hasOwn(TOLD_EVENTS, status) ? TOLD_EVENTS[status] : undefined);

export interface LiveNotifications {
  seeds: SeededNotification[];
  section: NotificationsSection;
}

interface Imported {
  orders: ReadonlyMap<string, Pick<ImportedOrder, "customerId" | "status">>;
  linkRequests: ReadonlyMap<string, Pick<ImportedLinkRequest, "customerId" | "status" | "deliveredAt">>;
  houseIds: ReadonlySet<string>;
}

interface Out {
  seeds: SeededNotification[];
  listed: string[];
  report: ImportReport;
}

/** The key, or null with a note when the id cannot make one (an empty id): never thrown out of the import. */
function keyOf(out: Out, table: string, entity: string, id: string, event: string): string | null {
  try {
    return dedupKey(entity, id, event);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    out.report.notes.push({ kind: "notification_key_invalid", table, key: id, detail: event });
    return null;
  }
}

function orderNotifications(rows: readonly LiveOrder[], imported: Imported, out: Out): void {
  for (const row of rows) {
    const order = imported.orders.get(row.order_id);
    if (!order || order.customerId === null || imported.houseIds.has(order.customerId)) continue;
    const told = toldEvent(row.notified_status);
    if (row.notified_status !== null && told === undefined) {
      out.report.notes.push({ kind: "unknown_notified_status", table: "orders", key: row.order_id, detail: row.notified_status });
    }
    const toldKey = told ? keyOf(out, "orders", "order", row.order_id, told.event) : null;
    if (told && toldKey !== null) out.seeds.push({ dedupKey: toldKey, customerId: order.customerId, messageKey: told.messageKey, sentAt: null });
    const due = DUE_EVENTS[order.status];
    if (due && due.event !== told?.event) {
      const dueKey = keyOf(out, "orders", "order", row.order_id, due.event);
      if (dueKey !== null) out.listed.push(dueKey);
    }
  }
}

function linkNotifications(rows: readonly LiveLinkRequest[], imported: Imported, out: Out): void {
  for (const row of rows) {
    const request = imported.linkRequests.get(row.request_id);
    if (!request || imported.houseIds.has(request.customerId)) continue;
    const failed = request.status === "FAILED";
    const key = keyOf(out, "link_requests", "link_request", row.request_id, failed ? "failed" : "delivered");
    if (key === null) continue;
    if (told(row)) {
      out.seeds.push({ dedupKey: key, customerId: request.customerId, messageKey: failed ? "link_failed" : "link_ready", sentAt: (request.deliveredAt as Instant | null) ?? null });
    } else if (failed || request.status === "ISSUED") {
      out.listed.push(key);
    }
  }
}

export function readLiveNotifications(live: { orders: readonly LiveOrder[]; linkRequests: readonly LiveLinkRequest[] }, imported: Imported, report: ImportReport): LiveNotifications {
  const out: Out = { seeds: [], listed: [], report };
  orderNotifications(live.orders, imported, out);
  linkNotifications(live.linkRequests, imported, out);
  const seededByEvent: Record<string, number> = {};
  for (const seed of out.seeds) {
    const [entity, , event] = seed.dedupKey.split(":");
    const id = `${entity}:${event}`;
    seededByEvent[id] = (seededByEvent[id] ?? 0) + 1;
  }
  return { seeds: out.seeds, section: { seeded: out.seeds.length, seededByEvent, importedAsDue: 0, listed: out.listed.sort() } };
}
