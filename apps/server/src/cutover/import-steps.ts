/**
 * The steps of the cutover import between opening the copy and closing the new ledger: read
 * everything from the live copy, write it in one transaction, then fill the report from what was
 * written and from both databases. The run (import-run.ts) owns the refusals and the files.
 */
import type { Clock } from "@cashback/core";
import type BetterSqlite3 from "better-sqlite3";

import { customerCodeNumber, formatCustomerCode, importIdentity, lastFour, type IdentityImport, type IdentityImportResult } from "../modules/identity/index";
import { importLinks, type LinksImportResult } from "../modules/linking/index";
import { seedSentNotifications } from "../modules/messaging/index";
import { importOrders, type ImportedOrder, type OrdersImportResult } from "../modules/orders/index";
import type { Ledger } from "../platform/db/ledger";
import { contextOf, type CutoverContext } from "./cutover-context";
import { compareIdentity } from "./identity-compare";
import { readLiveIdentity } from "./identity-source";
import type { ImportReport } from "./import-report";
import { compareOrdersAndLinks } from "./ledger-compare";
import { readLiveLinkRows, readLiveLinks, type LiveLinks } from "./link-source";
import { CutoverRefusedError } from "./live-time";
import { readLiveNotifications, type LiveNotifications } from "./notification-source";
import { cashbackDifferences, countBy, paidParity, paidStatusConflicts } from "./order-checks";
import { readLiveOrderRows, readLiveOrders } from "./order-source";

/** Everything read from the live copy, ready to write. */
export interface LiveData {
  identity: IdentityImport;
  context: CutoverContext;
  orders: ImportedOrder[];
  links: LiveLinks;
  notifications: LiveNotifications;
}

export interface Written {
  identity: IdentityImportResult;
  links: LinksImportResult;
  orders: OrdersImportResult;
  seeded: number;
}

/** Reads the live copy; stops with duplicate_identity before anything is written. */
export function readLive(source: BetterSqlite3.Database, report: ImportReport): LiveData {
  const identity = readLiveIdentity(source, report);
  if (report.duplicates.length > 0) {
    throw new CutoverRefusedError("duplicate_identity", `live rows share a Zalo id or a customer code: ${report.duplicates.map((d) => `${d.column} [${d.keys.join(", ")}]`).join("; ")}`);
  }
  const context = contextOf(identity);
  const liveLinks = readLiveLinkRows(source);
  const links = readLiveLinks(source, liveLinks, context, report);
  const liveOrders = readLiveOrderRows(source);
  // Only a request the import took can be found later: one whose customer is gone is missing too.
  const orders = readLiveOrders(liveOrders, context, new Set(links.links.linkRequests.map((r) => r.requestId)), report);
  const imported = {
    orders: new Map(orders.map((o) => [o.orderId, o])),
    linkRequests: new Map(links.links.linkRequests.map((r) => [r.requestId, r])),
    houseIds: context.houseIds,
  };
  const notifications = readLiveNotifications({ orders: liveOrders, linkRequests: liveLinks }, imported, report);
  return { identity, context, orders, links, notifications };
}

/** Writes every imported row in one `tx`: one import is one command. */
export function writeLive(ledger: Ledger, live: LiveData, fingerprintKey: string, clock: Clock): Written {
  const importedAt = clock.now();
  return ledger.tx((db) => ({
    identity: importIdentity(db, live.identity, fingerprintKey),
    links: importLinks(db, live.links.links),
    orders: importOrders(db, { orders: live.orders, importedAt }),
    seeded: seedSentNotifications(db, live.notifications.seeds, importedAt),
  }));
}

function highestAliasCode(identity: IdentityImport): string | null {
  const top = Math.max(0, ...identity.retiredAliases.map((a) => customerCodeNumber(a) ?? 0));
  return top > 0 ? formatCustomerCode(top) : null;
}

export function fillReport(report: ImportReport, live: LiveData, written: Written, source: BetterSqlite3.Database, target: BetterSqlite3.Database): void {
  const { identity, links } = live;
  report.comparison = { ...compareIdentity(source, target, report.notes), ...compareOrdersAndLinks(source, target, report.notes, live.context) };
  report.counter = {
    liveCounterLast: identity.counterLast,
    highestAliasCode: highestAliasCode(identity),
    importedCounterLast: written.identity.counterLast,
    nextCode: formatCustomerCode(written.identity.counterLast + 1),
  };
  report.bankAccounts = { imported: written.identity.bankAccounts, lastFour: identity.bankAccounts.map((b) => lastFour(b.accountNumber)) };
  report.orders = {
    imported: written.orders.orders,
    byStatus: countBy(live.orders, (o) => o.status),
    settlementPeriods: written.orders.settlementPeriods,
    paidParity: paidParity(source, target, live.context.houseIds),
    cashbackDifferences: cashbackDifferences(live.orders, live.context.houseIds),
    paidStatusConflicts: paidStatusConflicts(source),
  };
  report.links = {
    imported: written.links.linkRequests,
    byStatus: countBy(links.links.linkRequests, (r) => r.status),
    queued: links.links.linkRequests
      .filter((r) => r.status === "QUEUED")
      .map((r) => r.requestId)
      .sort(),
    shareCodes: written.links.shareCodes,
    productOffers: written.links.productOffers,
    snapshots: links.snapshots,
  };
  report.notifications = live.notifications.section;
}

/** The one log line of a finished import: counts only, never personal data. */
export function finishedLine(report: ImportReport, written: Written): Record<string, unknown> {
  return {
    customers: written.identity.customers,
    aliases: written.identity.aliases,
    bankAccounts: written.identity.bankAccounts,
    orders: written.orders.orders,
    linkRequests: written.links.linkRequests,
    shareCodes: written.links.shareCodes,
    seededNotifications: written.seeded,
    paidParity: report.orders?.paidParity.result ?? null,
    timeProblems: report.timeProblems.length,
    notes: report.notes.length,
  };
}
