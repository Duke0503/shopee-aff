/**
 * The steps of the cutover import between opening the copy and closing the new ledger: read
 * everything from the live copy, write it in one transaction, then fill the report from what was
 * written and from both databases. The run (import-run.ts) owns the refusals and the files.
 * Every module import is a command by the system actor `cutover` and writes its audit entry in
 * the same transaction (AD-17). The import also turns `messaging.silent` on (D46, Story 6.10): the
 * first reconciliation after it records would-be sends and sends nothing until the owner turns
 * the flag off.
 */
import type { Clock } from "@cashback/core";
import type BetterSqlite3 from "better-sqlite3";

import { importCampaigns, type CampaignsImportResult } from "../modules/campaigns/index";
import { customerCodeNumber, formatCustomerCode, importIdentity, lastFour, type IdentityImport, type IdentityImportResult } from "../modules/identity/index";
import { importLinks, type LinksImportResult } from "../modules/linking/index";
import { seedSentNotifications, setSilent } from "../modules/messaging/index";
import { commandAudit } from "../modules/operations/index";
import { importOrders, type ImportedOrder, type OrdersImportResult } from "../modules/orders/index";
import { importNetworkSettlements, importPayouts, type ImportedNetworkSettlement, type NetworkSettlementsImportResult, type PayoutsImportResult } from "../modules/payouts/index";
import type { Ledger } from "../platform/db/ledger";
import { CUTOVER_SYSTEM_ACTOR } from "../platform/ports/audit.port";
import { readLiveCampaigns, type LiveCampaigns } from "./campaign-source";
import { contextOf, type CutoverContext } from "./cutover-context";
import { compareIdentity } from "./identity-compare";
import { readLiveIdentity } from "./identity-source";
import type { ImportReport } from "./import-report";
import { compareOrdersAndLinks, comparePayoutsAndAwards } from "./ledger-compare";
import { readLiveLinkRows, readLiveLinks, type LiveLinks } from "./link-source";
import { CutoverRefusedError } from "./live-time";
import { readLiveNotifications, withMoreNotifications, type LiveNotifications } from "./notification-source";
import { cashbackDifferences, countBy, paidParity, paidStatusConflicts } from "./order-checks";
import { readLiveOrderRows, readLiveOrders } from "./order-source";
import { fullPaidParity } from "./paid-parity";
import { readLiveNetworkPayouts } from "./network-payout-source";
import { readLivePayouts, type LivePayouts } from "./payout-source";

/** Everything read from the live copy, ready to write. */
export interface LiveData {
  identity: IdentityImport;
  context: CutoverContext;
  orders: ImportedOrder[];
  links: LiveLinks;
  campaigns: LiveCampaigns;
  payouts: LivePayouts;
  networkPayouts: ImportedNetworkSettlement[];
  notifications: LiveNotifications;
}

export interface Written {
  identity: IdentityImportResult;
  links: LinksImportResult;
  orders: OrdersImportResult;
  campaigns: CampaignsImportResult;
  payouts: PayoutsImportResult;
  networkPayouts: NetworkSettlementsImportResult;
  seeded: number;
  /** True: the new ledger starts with `messaging.silent` on. */
  silent: boolean;
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
  const campaigns = readLiveCampaigns(source, context, imported.orders, report);
  const bankAccounts = new Map(identity.bankAccounts.map((b) => [b.customerId, b.accountNumber]));
  const payouts = readLivePayouts(source, { context, orders, awards: campaigns.awards, bankAccounts }, report);
  const base = readLiveNotifications({ orders: liveOrders, linkRequests: liveLinks }, imported, report);
  const networkPayouts = readLiveNetworkPayouts(source, report);
  return { identity, context, orders, links, campaigns, payouts, networkPayouts, notifications: withMoreNotifications(base, [payouts, campaigns]) };
}

/** Writes every imported row in one `tx`: one import is one command. */
export function writeLive(ledger: Ledger, live: LiveData, fingerprintKey: string, clock: Clock): Written {
  const importedAt = clock.now();
  return ledger.tx((db) => {
    const by = commandAudit(db, clock, CUTOVER_SYSTEM_ACTOR);
    return {
      identity: importIdentity(db, live.identity, fingerprintKey, by),
      links: importLinks(db, live.links.links, by),
      orders: importOrders(db, { orders: live.orders, importedAt }, by),
      campaigns: importCampaigns(db, { campaigns: live.campaigns.campaigns, awards: live.campaigns.awards }, by),
      payouts: importPayouts(db, { payouts: live.payouts.payouts, items: live.payouts.items }, by),
      networkPayouts: importNetworkSettlements(db, live.networkPayouts, importedAt, by),
      seeded: seedSentNotifications(db, live.notifications.seeds, importedAt, by),
      silent: setSilent(db, true, importedAt, by).silent,
    };
  });
}

function highestAliasCode(identity: IdentityImport): string | null {
  const top = Math.max(0, ...identity.retiredAliases.map((a) => customerCodeNumber(a) ?? 0));
  return top > 0 ? formatCustomerCode(top) : null;
}

export function fillReport(report: ImportReport, live: LiveData, written: Written, source: BetterSqlite3.Database, target: BetterSqlite3.Database): void {
  const { identity, links } = live;
  report.comparison = {
    ...compareIdentity(source, target, report.notes),
    ...compareOrdersAndLinks(source, target, report.notes, live.context),
    ...comparePayoutsAndAwards(source, target, report.notes),
  };
  report.paidParity = fullPaidParity(source, target, live.context.houseIds);
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
    clicks: written.links.clicks,
    productOffers: written.links.productOffers,
    snapshots: links.snapshots,
  };
  report.notifications = live.notifications.section;
  report.payouts = live.payouts.section;
  const batches = (target.prepare("SELECT network_payout_id AS networkPayoutId, created_at AS createdAt, eligible_amount AS eligible, amount AS received, withheld, match FROM network_settlements ORDER BY created_at, network_payout_id").all() as { networkPayoutId: string; createdAt: string | null; eligible: number | null; received: number; withheld: number | null; match: string }[]).map((b) => ({ ...b, withheld: b.withheld === null ? null : b.withheld === 1 }));
  report.networkPayouts = { imported: written.networkPayouts.settlements, batches };
  const frozen = new Set(live.orders.filter((o) => o.status === "FROZEN").map((o) => o.orderId));
  report.campaigns = {
    imported: written.campaigns.campaigns,
    awards: written.campaigns.awards,
    awardsByStatus: countBy(live.campaigns.awards, (a) => a.status),
    suspendedAwards: live.campaigns.awards.filter((a) => frozen.has(a.orderId) && a.status !== "VOID").map((a) => a.awardId),
    stopped: live.campaigns.stopped,
  };
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
    payouts: written.payouts.payouts,
    campaignAwards: written.campaigns.awards,
    seededNotifications: written.seeded,
    messagingSilent: written.silent,
    paidParity: report.paidParity?.result ?? null,
    timeProblems: report.timeProblems.length,
    notes: report.notes.length,
  };
}
