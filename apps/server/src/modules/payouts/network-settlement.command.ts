/**
 * Recording a network payout batch and matching it to exact orders (FR-19, D27, D59, AD-4, AD-6;
 * Story 4.21), replacing the live date cut-off (`settle_orders_for_batch`), in the caller's
 * transaction.
 *
 * A batch is recorded once per (network, payout id). Its withholding is read from its gross and
 * what it paid (packages/money) and becomes the network's estimate for later approvals when it is
 * the latest batch. A later record moves its status along status-flows.md section 7, stores an
 * order list whenever one arrives, and fills the paid time; facts that differ from the stored ones
 * (amount, gross, creation time) are never taken over silently: they are audited and open a
 * `settlement_facts_changed` case. A batch imported at cutover is HISTORIC: its facts and totals
 * only, never matched (the live ledger kept no approval time to place an order in a window). A
 * PAID batch of this system not matched yet (PENDING or MISMATCH) is matched:
 *
 * - With the network's order list, exactly those orders: an APPROVED or PAID order is settled; one
 *   another batch settled (`settlement_conflict`), one not approved or paid
 *   (`settlement_not_approved`) and an id the ledger does not hold are refused, each named in a case.
 * - Without one, the network's unsettled orders this system approved in the batch's window: from
 *   the previous batch this system recorded (or the go-live, the cutover import, for the first)
 *   to this batch's creation. Batches also pay for orders attributed to no
 *   customer, so the orders' gross is part of the batch's: when they fit inside it they are all
 *   settled and the rest is recorded as unattributed. Orders above the batch, an unknown gross or
 *   withholding, or no window is a `settlement_mismatch` and nothing is settled.
 *
 * A match is computed from a fingerprint of its inputs; an unchanged batch is not matched again and
 * writes nothing. A case staff resolved is not reopened for the same facts. Every record that
 * changes something writes one audit entry.
 */
import { createHash } from "node:crypto";
import type { NetworkPayoutRecord, NetworkPayoutRecordResponse } from "@cashback/contracts";
import type { Clock, Instant } from "@cashback/core";
import { batchCoverage, classifyWithholding, settlementNet, type AffiliateNetwork } from "@cashback/money";
import { and, eq, lt, desc, isNotNull } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { caseResolvedWith, observeWithholding, openOrRefreshCase, settleOrders, settlementCandidates, settlementOrdersOf, type SettlementCaseReason, type SettlementOrder } from "../orders/index";
import { networkSettlementOrders, networkSettlements, type SettlementMatch, type SettlementOrderOutcome } from "./schema";

export interface NetworkSettlementDeps {
  readonly clock: Clock;
  readonly by: CommandAudit;
}

export class NetworkSettlementError extends Error {
  constructor(readonly code: "status_not_allowed") {
    super(`network settlement: ${code}`);
    this.name = "NetworkSettlementError";
  }
}

export type StoredSettlement = typeof networkSettlements.$inferSelect;

interface Line {
  readonly orderId: string;
  readonly outcome: SettlementOrderOutcome;
  readonly gross: number | null;
  readonly net: number | null;
}

interface Plan {
  readonly match: SettlementMatch;
  readonly lines: readonly Line[];
  readonly matchedGross: number | null;
  readonly unattributed: number | null;
  readonly windowFrom: string | null;
  /** Cases to raise: reason, subject, order id, facts. */
  readonly cases: readonly { reason: SettlementCaseReason; subject: string; orderId: string | null; candidates: readonly string[]; facts: Record<string, unknown> }[];
}

const NEXT: Record<string, readonly string[]> = { PROCESSING: ["PROCESSING", "PAID", "FAILED"], PAID: ["PAID"], FAILED: ["FAILED"] };
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const net = (s: StoredSettlement, gross: number | null): number | null => (gross === null || s.withheld === null ? null : settlementNet(s.network, gross, s.withheld));
const lineOf = (s: StoredSettlement, order: SettlementOrder, outcome: SettlementOrderOutcome): Line => ({ orderId: order.orderId, outcome, gross: order.gross, net: net(s, order.gross) });
const grossesOf = (lines: readonly Line[]): number[] => lines.flatMap((l) => (l.gross === null ? [] : [l.gross]));
const batchFacts = (s: StoredSettlement) => ({ networkPayoutId: s.networkPayoutId, amount: s.amount, eligible: s.eligibleAmount, withheld: s.withheld, createdAt: s.createdAt });

/**
 * The start of this batch's window: the creation of the network's previous batch recorded by this
 * system, else the go-live (when the cutover import recorded the historic batches), else none.
 */
function windowStart(db: LedgerDb, s: StoredSettlement): string | null {
  if (s.createdAt === null) return null;
  const previous = db
    .select({ createdAt: networkSettlements.createdAt })
    .from(networkSettlements)
    .where(and(eq(networkSettlements.network, s.network), eq(networkSettlements.origin, "NETWORK"), isNotNull(networkSettlements.createdAt), lt(networkSettlements.createdAt, s.createdAt)))
    .orderBy(desc(networkSettlements.createdAt))
    .get();
  if (previous?.createdAt) return previous.createdAt;
  const goLive = db.select({ at: networkSettlements.recordedAt }).from(networkSettlements).where(eq(networkSettlements.origin, "CUTOVER")).orderBy(desc(networkSettlements.recordedAt)).get();
  return goLive?.at ?? null;
}

function coverage(s: StoredSettlement, settled: readonly Line[]): { matchedGross: number | null; unattributed: number | null; fits: boolean } {
  if (s.eligibleAmount === null) return { matchedGross: null, unattributed: null, fits: false };
  return batchCoverage(s.eligibleAmount, grossesOf(settled));
}

/** A listed batch: exactly its orders; the ones that cannot be settled are refused, each with a case. */
function planListed(db: LedgerDb, s: StoredSettlement, orderIds: readonly string[]): Plan {
  const known = settlementOrdersOf(db, orderIds);
  const cases: Plan["cases"][number][] = [];
  const lines = [...new Set(orderIds)].map((orderId): Line => {
    const order = known.get(orderId);
    if (order === undefined || order.network !== s.network) return { orderId, outcome: "UNKNOWN", gross: null, net: null };
    const candidates = order.customerId === null ? [] : [order.customerId];
    if (order.networkBatchId !== null && order.networkBatchId !== s.networkPayoutId) {
      cases.push({ reason: "settlement_conflict", subject: orderId, orderId, candidates, facts: { networkPayoutId: s.networkPayoutId, settledBy: order.networkBatchId } });
      return lineOf(s, order, "CONFLICT");
    }
    if (order.status !== "APPROVED" && order.status !== "PAID") {
      cases.push({ reason: "settlement_not_approved", subject: orderId, orderId, candidates, facts: { networkPayoutId: s.networkPayoutId, status: order.status } });
      return lineOf(s, order, "NOT_APPROVED");
    }
    return lineOf(s, order, "SETTLED");
  });
  const settled = lines.filter((l) => l.outcome === "SETTLED");
  const cover = coverage(s, settled);
  const unknown = lines.filter((l) => l.outcome === "UNKNOWN").map((l) => l.orderId);
  if (!cover.fits || unknown.length > 0 || s.withheld === null) {
    cases.push({ reason: "settlement_mismatch", subject: `payout:${s.networkPayoutId}`, orderId: null, candidates: [], facts: { ...batchFacts(s), matchedGross: cover.matchedGross, unknown } });
  }
  return { match: "MATCHED", lines, matchedGross: cover.matchedGross, unattributed: cover.unattributed, windowFrom: null, cases };
}

/** An unlisted batch: its window's orders, settled only when they fit inside its gross. */
function planWindow(db: LedgerDb, s: StoredSettlement): Plan {
  const windowFrom = windowStart(db, s);
  const candidates = s.createdAt === null ? [] : settlementCandidates(db, s.network as AffiliateNetwork, { from: windowFrom, to: s.createdAt });
  const lines = candidates.map((o) => lineOf(s, o, "CANDIDATE"));
  const cover = coverage(s, lines);
  if (cover.fits && s.withheld !== null && s.createdAt !== null) {
    return { match: "MATCHED", lines: lines.map((l) => ({ ...l, outcome: "SETTLED" })), matchedGross: cover.matchedGross, unattributed: cover.unattributed, windowFrom, cases: [] };
  }
  const facts = { ...batchFacts(s), windowFrom, matchedGross: cover.matchedGross, orderIds: lines.map((l) => l.orderId) };
  return { match: "MISMATCH", lines, matchedGross: cover.matchedGross, unattributed: cover.unattributed, windowFrom, cases: [{ reason: "settlement_mismatch", subject: `payout:${s.networkPayoutId}`, orderId: null, candidates: [], facts }] };
}

/** Opens or refreshes the case unless staff resolved one for the same facts; returns its id, or null. */
function raise(db: LedgerDb, s: StoredSettlement, c: Plan["cases"][number], deps: NetworkSettlementDeps): number | null {
  const fingerprint = hash({ reason: c.reason, subject: c.subject, facts: c.facts });
  if (caseResolvedWith(db, { network: s.network, subject: c.subject, reason: c.reason, fingerprint })) return null;
  const evidence = { network: s.network, subject: c.subject, orderId: c.orderId, reason: c.reason, candidates: c.candidates, observation: JSON.stringify(c.facts), fingerprint };
  return openOrRefreshCase(db, evidence, { by: deps.by, at: deps.clock.now() }).caseId;
}

function writePlan(db: LedgerDb, s: StoredSettlement, plan: Plan, fingerprint: string, deps: NetworkSettlementDeps): number {
  db.delete(networkSettlementOrders).where(eq(networkSettlementOrders.settlementId, s.settlementId)).run();
  for (const line of plan.lines) db.insert(networkSettlementOrders).values({ settlementId: s.settlementId, ...line }).run();
  const toSettle = plan.lines.filter((l) => l.outcome === "SETTLED").map((l) => l.orderId);
  const settled = settleOrders(db, { orderIds: toSettle, networkPayoutId: s.networkPayoutId, settledAt: (s.paidAt as Instant | null) ?? deps.clock.now() });
  db.update(networkSettlements)
    .set({ match: plan.match, matchedGross: plan.matchedGross, unattributed: plan.unattributed, windowFrom: plan.windowFrom, matchFingerprint: fingerprint, updatedAt: deps.clock.now() })
    .where(eq(networkSettlements.settlementId, s.settlementId))
    .run();
  return settled;
}

export interface MatchOutcome {
  readonly plan: Plan | null;
  readonly settled: number;
  readonly caseIds: readonly number[];
  readonly changed: boolean;
}

/** Matches a PAID batch of this system not matched yet; an unchanged batch (same inputs as its last match) writes nothing. A HISTORIC batch is never matched. */
export function matchDue(db: LedgerDb, s: StoredSettlement, deps: NetworkSettlementDeps): MatchOutcome {
  const due = s.status === "PAID" && s.origin === "NETWORK" && (s.match === "PENDING" || s.match === "MISMATCH");
  if (!due) return { plan: null, settled: 0, caseIds: [], changed: false };
  const listed: readonly string[] | null = s.orderIds === null ? null : (JSON.parse(s.orderIds) as string[]);
  const plan = listed === null ? planWindow(db, s) : planListed(db, s, listed);
  const fingerprint = hash({ facts: batchFacts(s), lines: plan.lines, match: plan.match, windowFrom: plan.windowFrom });
  if (fingerprint === s.matchFingerprint) return { plan, settled: 0, caseIds: [], changed: false };
  const settled = writePlan(db, s, plan, fingerprint, deps);
  const caseIds = plan.cases.flatMap((c) => {
    const id = raise(db, s, c, deps);
    return id === null ? [] : [id];
  });
  return { plan, settled, caseIds, changed: true };
}

const hasList = (record: NetworkPayoutRecord): boolean => record.orderIds !== undefined && record.orderIds !== null;

/** The stored row's withholding, fee and tax for a gross and amount. */
export function withholdingOf(network: AffiliateNetwork, eligible: number | null, amount: number): { withheld: boolean | null; fee: number | null; tax: number | null } {
  const read = eligible === null ? null : classifyWithholding(network, eligible, amount);
  return read === null ? { withheld: null, fee: null, tax: null } : { withheld: read.withheld, fee: read.fee, tax: read.tax };
}

function insert(db: LedgerDb, record: NetworkPayoutRecord, now: Instant): StoredSettlement {
  const eligible = record.eligibleAmount ?? null;
  const values = {
    network: record.network,
    networkPayoutId: record.networkPayoutId,
    status: record.status,
    amount: record.amount,
    eligibleAmount: eligible,
    ...withholdingOf(record.network, eligible, record.amount),
    createdAt: record.createdAt ?? null,
    paidAt: record.paidAt ?? null,
    orderIds: hasList(record) ? JSON.stringify([...new Set(record.orderIds)]) : null,
    match: "PENDING" as const,
    origin: "NETWORK" as const,
    recordedAt: now,
    updatedAt: now,
  };
  return db.insert(networkSettlements).values(values).returning().get();
}

/** What a later record says differently about facts that never change. */
function changedFacts(s: StoredSettlement, record: NetworkPayoutRecord): Record<string, unknown> | null {
  const said = { amount: record.amount, eligible: record.eligibleAmount ?? s.eligibleAmount, createdAt: record.createdAt ?? s.createdAt };
  const stored = { amount: s.amount, eligible: s.eligibleAmount, createdAt: s.createdAt };
  return JSON.stringify(said) === JSON.stringify(stored) ? null : { networkPayoutId: s.networkPayoutId, stored, said };
}

/** Status, the order list and the paid time of a later record; true when one of them changed. */
function update(db: LedgerDb, s: StoredSettlement, record: NetworkPayoutRecord, now: Instant): StoredSettlement | null {
  if (!(NEXT[s.status] ?? []).includes(record.status)) throw new NetworkSettlementError("status_not_allowed");
  // A list is kept whenever it arrives, until the batch is matched; a matched batch keeps what it was matched with.
  const orderIds = s.orderIds === null && hasList(record) && s.match !== "MATCHED" ? JSON.stringify([...new Set(record.orderIds)]) : s.orderIds;
  const paidAt = s.paidAt ?? record.paidAt ?? null;
  if (record.status === s.status && orderIds === s.orderIds && paidAt === s.paidAt) return null;
  return db.update(networkSettlements).set({ status: record.status, orderIds, paidAt, updatedAt: now }).where(eq(networkSettlements.settlementId, s.settlementId)).returning().get();
}

function recordFactsChange(db: LedgerDb, s: StoredSettlement, facts: Record<string, unknown>, deps: NetworkSettlementDeps): number | null {
  deps.by.audit.record({ actor: deps.by.actor, event: "payouts.network_settlement.facts_changed", entityId: String(s.settlementId), payload: { network: s.network, networkPayoutId: s.networkPayoutId } });
  return raise(db, s, { reason: "settlement_facts_changed", subject: `payout:${s.networkPayoutId}`, orderId: null, candidates: [], facts }, deps);
}

/** Records the batch and matches it when it is due; call inside `tx`. */
export function recordNetworkPayout(db: LedgerDb, record: NetworkPayoutRecord, deps: NetworkSettlementDeps): NetworkPayoutRecordResponse {
  const now = deps.clock.now();
  const existing = db.select().from(networkSettlements).where(and(eq(networkSettlements.network, record.network), eq(networkSettlements.networkPayoutId, record.networkPayoutId))).get();
  const facts = existing === undefined ? null : changedFacts(existing, record);
  const factsCase = existing !== undefined && facts !== null ? recordFactsChange(db, existing, facts, deps) : null;
  const updated = existing === undefined ? insert(db, record, now) : update(db, existing, record, now);
  const stored = updated ?? (existing as StoredSettlement);
  if (stored.withheld !== null && stored.createdAt !== null) observeWithholding(db, { network: stored.network, withheld: stored.withheld, networkPayoutId: stored.networkPayoutId, observedAt: stored.createdAt }, now);
  const outcome = matchDue(db, stored, deps);
  const count = (o: SettlementOrderOutcome): number => (outcome.changed ? (outcome.plan?.lines.filter((l) => l.outcome === o).length ?? 0) : 0);
  const after = db.select().from(networkSettlements).where(eq(networkSettlements.settlementId, stored.settlementId)).get() ?? stored;
  const response: NetworkPayoutRecordResponse = {
    settlementId: after.settlementId,
    match: after.match,
    withheld: after.withheld,
    settled: outcome.settled,
    conflicts: count("CONFLICT"),
    notApproved: count("NOT_APPROVED"),
    unknown: count("UNKNOWN"),
    matchedGross: after.matchedGross,
    unattributed: after.unattributed,
    caseIds: [...new Set([...outcome.caseIds, ...(factsCase === null ? [] : [factsCase])])],
    factsChanged: facts !== null,
    replay: updated === null && !outcome.changed && facts === null,
  };
  // A record that only repeats the batch writes nothing; changed facts have their own entry above.
  if (updated !== null || outcome.changed) {
    const payload = { network: after.network, networkPayoutId: after.networkPayoutId, status: after.status, match: after.match, settled: outcome.settled, conflicts: response.conflicts, notApproved: response.notApproved, unknown: response.unknown };
    deps.by.audit.record({ actor: deps.by.actor, event: "payouts.network_settlement.recorded", entityId: String(after.settlementId), payload });
  }
  return response;
}
