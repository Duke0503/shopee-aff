/**
 * The Overview's activity blocks (Story 4.17, docs/operations/dashboard-spec.md Blocks 5, 7 and
 * 8): orders per network by recorded day, customers and concentration, and the health line. Counts
 * come from the module queries; every ratio is `packages/money` (FR-27). Below 100 approved
 * orders a ratio is marked "not enough data" (it is still the real value, never a placeholder).
 */
import type { Overview, OverviewHealth, OverviewNetworkOrders, Ratio } from "@cashback/contracts";
import { parseInstant, toMs, type Clock, type InstantRange } from "@cashback/core";
import { averageDong, ratioBps, sumDong } from "@cashback/money";

import { customerCodeOf, deskCustomers, newCustomerCount } from "../modules/identity/index";
import { deliveredLinkCounts } from "../modules/linking/index";
import { customersWithOrderBefore, hasRun, lastSucceededRun, recordedOrderFacts, type ApprovedOrderFact, type RecordedOrderFact } from "../modules/orders/index";
import { survivorResolver } from "../modules/payouts/index";
import type { LedgerDb } from "../platform/db/ledger";
import { figureOf, ratioOf } from "./overview-business.query";

/** FR-27: below this many approved orders a ratio carries the "not enough data" tag. */
export const ENOUGH_APPROVED_ORDERS = 100;
/** One customer above this share of the period's commission is a concentration risk. */
export const CONCENTRATION_BPS = 3000;
/** The hourly reconciliation counts as down when its last success is older than this. */
export const RECONCILIATION_DOWN_AFTER_MS = 3 * 3_600_000;

const APPROVED = new Set(["APPROVED", "PAID"]);
const CANCELLED = new Set(["REJECTED", "REVERSED"]);
type Network = OverviewNetworkOrders["network"];

interface Counted {
  readonly linksDelivered: number;
  readonly orders: readonly RecordedOrderFact[];
}

const ratio = (now: number | null, before: number | null, approved: number): Ratio => ratioOf(now, before, approved >= ENOUGH_APPROVED_ORDERS);

function figuresOf(c: Counted) {
  const approved = c.orders.filter((o) => APPROVED.has(o.status));
  const cancelled = c.orders.filter((o) => CANCELLED.has(o.status)).length;
  const priced = approved.filter((o) => o.approvedCommission !== null);
  const valued = priced.filter((o) => o.orderValue !== null && o.orderValue > 0);
  const commission = sumDong(priced.map((o) => o.approvedCommission ?? 0), "commission");
  return {
    approved: approved.length,
    cancelled,
    awaiting: c.orders.filter((o) => o.status === "AWAITING_APPROVAL").length,
    cancelRate: ratioBps(cancelled, approved.length + cancelled),
    ordersPerLink: ratioBps(c.orders.length, c.linksDelivered),
    averageCommission: averageDong(commission, priced.length),
    effectiveRate: ratioBps(sumDong(valued.map((o) => o.approvedCommission ?? 0), "commission"), sumDong(valued.map((o) => o.orderValue ?? 0), "orderValue")),
  };
}

function counted(db: LedgerDb, range: InstantRange): Map<Network, Counted> {
  const links = deliveredLinkCounts(db, range);
  const orders = recordedOrderFacts(db, range);
  const of = (network: Network): Counted => ({
    linksDelivered: sumDong(links.filter((l) => network === "all" || l.network === network).map((l) => l.count), "links"),
    orders: orders.filter((o) => network === "all" || o.network === network),
  });
  return new Map((["shopee", "accesstrade", "all"] as const).map((n) => [n, of(n)]));
}

/** Block 5: per network and in total, the period's recorded orders by current status and their ratios. */
export function ordersOf(db: LedgerDb, range: InstantRange, previous: InstantRange): OverviewNetworkOrders[] {
  const now = counted(db, range);
  const before = counted(db, previous);
  return (["shopee", "accesstrade", "all"] as const).map((network) => {
    const c = now.get(network) as Counted;
    const f = figuresOf(c);
    const p = figuresOf(before.get(network) as Counted);
    return {
      network,
      linksDelivered: c.linksDelivered,
      recorded: c.orders.length,
      ordersPerLink: ratio(f.ordersPerLink, p.ordersPerLink, f.approved),
      approved: f.approved,
      cancelled: f.cancelled,
      awaiting: f.awaiting,
      cancelRate: ratio(f.cancelRate, p.cancelRate, f.approved),
      averageCommission: f.averageCommission,
      effectiveRate: ratio(f.effectiveRate, p.effectiveRate, f.approved),
    };
  });
}

/** The desk customer a stored id belongs to (the payouts module's survivor resolver), staff records left out; null for the guest and nobody. */
function deskSurvivor(db: LedgerDb): (stored: string | null) => string | null {
  const owner = survivorResolver(db);
  const desk = new Set(deskCustomers(db).map((c) => c.customerId));
  return (stored) => {
    const id = stored === null ? null : owner(stored);
    return id !== null && desk.has(id) ? id : null;
  };
}

function customerCounts(db: LedgerDb, range: InstantRange, survivor: (stored: string | null) => string | null) {
  const withOrder = new Set(recordedOrderFacts(db, range).flatMap((o) => survivor(o.customerId) ?? []));
  const earlier = new Set([...customersWithOrderBefore(db, range.from)].flatMap((id) => survivor(id) ?? []));
  return { withOrder: withOrder.size, repeat: [...withOrder].filter((id) => earlier.has(id)).length, joined: newCustomerCount(db, range) };
}

function concentrationOf(db: LedgerDb, approved: readonly ApprovedOrderFact[], survivor: (stored: string | null) => string | null): Overview["customers"]["concentration"] {
  const total = sumDong(approved.map((o) => o.approvedCommission), "commission");
  const per = new Map<string, number[]>();
  for (const o of approved) {
    const id = survivor(o.customerId);
    if (id !== null) per.set(id, [...(per.get(id) ?? []), o.approvedCommission]);
  }
  const top = [...per].map(([id, amounts]) => ({ id, share: ratioBps(sumDong(amounts, "commission"), total) ?? 0 })).sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1))[0];
  return top === undefined || top.share <= CONCENTRATION_BPS ? null : { customerCode: customerCodeOf(db, top.id), shareBps: top.share };
}

/** Block 7: customers with an order, new customers and the repeat share (recorded day), and concentration (approval day). */
export function customersOf(db: LedgerDb, range: InstantRange, previous: InstantRange, approved: readonly ApprovedOrderFact[], approvedOrders: number): Overview["customers"] {
  const survivor = deskSurvivor(db);
  const now = customerCounts(db, range, survivor);
  const before = customerCounts(db, previous, survivor);
  return {
    withOrder: figureOf(now.withOrder, before.withOrder),
    newCustomers: figureOf(now.joined, before.joined),
    repeatShare: ratio(ratioBps(now.repeat, now.withOrder), ratioBps(before.repeat, before.withOrder), approvedOrders),
    concentration: concentrationOf(db, approved, survivor),
  };
}

/** The assistant is down once no heartbeat came for this long (AD-15). */
export const ASSISTANT_DOWN_AFTER_MS = 5 * 60_000;

/** The last assistant heartbeat this server received, from the one shared store (Story 6.1). */
export type LastHeartbeat = () => { readonly receivedAt: string } | null;

/**
 * Block 8 from the one health model (AD-27): the hourly reconciliation from its runs, the Zalo
 * assistant from its last heartbeat (Story 6.1: up within 5 minutes, down after; not known before
 * the first beat since this server started); the browser bridge and the backup do not report to
 * the server yet, so they are "not known yet", never "up".
 */
export function healthOf(db: LedgerDb, clock: Clock, lastHeartbeat: LastHeartbeat = () => null): OverviewHealth[] {
  return [{ component: "bridge", state: "unknown", at: null }, assistantHealth(clock, lastHeartbeat()), reconciliationHealth(db, clock), { component: "backup", state: "unknown", at: null }];
}

function assistantHealth(clock: Clock, beat: { readonly receivedAt: string } | null): OverviewHealth {
  if (beat === null) return { component: "assistant", state: "unknown", at: null };
  const late = toMs(clock.now()) - toMs(parseInstant(beat.receivedAt)) > ASSISTANT_DOWN_AFTER_MS;
  return { component: "assistant", state: late ? "down" : "up", at: beat.receivedAt };
}

/**
 * Each network's hourly reconciliation on its own, the worst one wins: a network whose last success
 * is over 3 hours old, or that never succeeded while it or another network recorded a run, is
 * down, so a source that fails every run (a production Shopee with no bridge) is never silent.
 * Before any hourly run was recorded nothing reports yet ("not known yet"). `at` is the oldest of
 * the last successes.
 */
function reconciliationHealth(db: LedgerDb, clock: Clock): OverviewHealth {
  const networks = ["shopee", "accesstrade"] as const;
  const last = networks.map((n) => lastSucceededRun(db, n, "HOURLY"));
  const seen = last.filter((at) => at !== null).sort();
  const ran = networks.filter((n) => hasRun(db, n, "HOURLY"));
  if (seen.length === 0 && ran.length === 0) return { component: "reconciliation", state: "unknown", at: null };
  const stale = (at: string | null): boolean => at === null || toMs(clock.now()) - toMs(parseInstant(at)) > RECONCILIATION_DOWN_AFTER_MS;
  const watched = networks.map((n, i) => ({ ran: ran.includes(n) || last[i] !== null, at: last[i] ?? null })).filter((w) => w.ran || seen.length > 0);
  return { component: "reconciliation", state: watched.some((w) => stale(w.at)) ? "down" : "up", at: seen[0] ?? null };
}
