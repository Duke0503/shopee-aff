/**
 * Applying one report row to its one order (AD-7, AD-8, FR-12, FR-13; Stories 3.3 and 3.4), inside
 * the caller's transaction, so the order, its items, the observation, the history, the audit
 * entries, the outbox rows, the review cases, the clawback entries and the award moves commit
 * together or not at all. The caller opens one `BEGIN IMMEDIATE` transaction per order (AD-8), so
 * a payout confirm on the same order runs wholly before or wholly after it.
 *
 * - A row whose fingerprint equals the last one applied to the order writes only
 *   `last_seen_in_report_at` (the nightly sweep's aging, D43).
 * - Otherwise the row is attributed (a new order only) and run through `transition`; the effects
 *   are written as `applyResult` reads them, the same reading the shadow run used (D44).
 * - Cashback is stored at approval from the approved commission (D3) with the split inputs. A new
 *   approval (from AWAITING_APPROVAL, a reopened order's included) reads its approval month's
 *   period now and stamps the period, the time and the withheld setting together (D54); an order
 *   approved before keeps the setting it was approved with (domain/settlement.ts).
 * - A new order is linked to its sub_id2 request only when attribution credited that request's
 *   owner; an uncredited sub_id2 is noted on the row's review case.
 * - A row held back by an OPEN payout claim (D39) is stored, not applied, and is applied by the
 *   first run after the claim ends; a repeat of it while the claim is open stores nothing again.
 * - A PAID order is never changed (D4): only its last-seen time moves and `transition`'s effects
 *   (clawback, review case) are written. The database triggers refuse anything else.
 * - An imported order seen for the first time gets its real items; its stored amounts stay. One
 *   of no network takes the row's network, recorded in its history and audit.
 * - Every review reason opens or refreshes one case per (network, subject, reason) with the row,
 *   its fingerprint and the candidates (review-case.command.ts). A row for an order of another
 *   network changes nothing and opens a `network_mismatch` case.
 */
import type { Clock, Instant } from "@cashback/core";
import { sumDong } from "@cashback/money";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { AlertPort } from "../../platform/ports/alert.port";
import type { AuditValue, CommandAudit } from "../../platform/ports/audit.port";
import type { OutboxPort } from "../../platform/ports/outbox.port";
import type { SourcedRow } from "../linking/index";
import { applyResult, type ApprovalEffect, type AppliedStep } from "./domain/applied-order";
import { attribute, type Attribution } from "./domain/attribution";
import { settlementPeriodOf, splitWithheld } from "./domain/settlement";
import { rowCommission, transition, type Effect, type Step, type TransitionContext, type TransitionOrder, type TransitionResult } from "./domain/transition";
import { ledgerDirectory, type LedgerDirectory } from "./ledger-directory.query";
import type { OrderAwardsPort, OrderEventsPort, OrderPayoutsPort } from "./order-effects.port";
import { findOrder, insertObservation, latestObservations, replaceItems, touchLastSeen, transitionOrderOf, type LatestObservations, type StoredOrder } from "./order-ledger.repository";
import { resolveSeenAgain } from "./order-aging.command";
import { recordNetworkSet, recordSteps } from "./order-steps.command";
import { openOrRefreshCase, type CaseReason } from "./review-case.command";
import { orders, type OrderRow } from "./schema";
import { periodWithheld } from "./settlement-period.command";

export interface ApplyDeps {
  readonly clock: Clock;
  readonly by: CommandAudit;
  readonly outbox: OutboxPort;
  readonly alerts: AlertPort;
  readonly payouts: OrderPayoutsPort;
  readonly awards: OrderAwardsPort;
  readonly events: OrderEventsPort;
  /** Production never credits a DEV sub_id (AD-25). */
  readonly production: boolean;
}

/**
 * `recorded`: a new order; `changed`: its state moved; `observed`: stored and applied, state
 * unchanged; `skipped`: same fingerprint as the last applied row; `deferred`: held back by an
 * OPEN payout claim (D39); `unrecorded`: no order took the row (a review case only: an
 * unattributed row, or an order id of another network's order).
 */
export type ApplyOutcome = "recorded" | "changed" | "observed" | "skipped" | "deferred" | "unrecorded";

export interface ApplyReport {
  readonly outcome: ApplyOutcome;
  readonly orderId: string;
  readonly steps: readonly Step[];
  readonly reviewCases: readonly string[];
}

export class ReportApplyError extends Error {
  readonly code = "paid_without_customer";
  constructor(message: string) {
    super(message);
    this.name = "ReportApplyError";
  }
}

/** A claim matters only to an APPROVED order (D39), paid bonus and earlier clawbacks only to a PAID one (D35, D42): each is read only then. */
function contextFor(db: LedgerDb, row: SourcedRow, stored: StoredOrder | null, directory: LedgerDirectory, deps: ApplyDeps, now: Instant): TransitionContext {
  const status = stored?.status ?? null;
  return {
    network: row.network,
    withheld: splitWithheld(stored, () => periodWithheld(db, row.network, settlementPeriodOf(now))),
    coveredByOpenClaim: status === "APPROVED" && deps.payouts.coveredByOpenClaim(row.orderId),
    paidBonus: status === "PAID" ? deps.awards.paidBonus(row.orderId) : 0,
    alreadyClawedBack: status === "PAID" ? deps.payouts.clawedBack(row.orderId) : 0,
    attribution: stored === null ? attribute(row, directory, deps.production) : undefined,
  };
}

const observationJson = (row: SourcedRow, unmatchedRequest: string | null = null): string =>
  JSON.stringify({
    network: row.network,
    orderId: row.orderId,
    rawOrderStatus: row.rawOrderStatus,
    orderStatus: row.orderStatus,
    items: row.items,
    subIds: row.subIds,
    problems: row.problems,
    purchasedAt: row.purchasedAt,
    ...(unmatchedRequest === null ? {} : { unmatchedRequest }),
  });

const subjectOf = (row: SourcedRow): string => (row.orderId === "" ? `#${row.fingerprint}` : row.orderId);

interface Applying {
  readonly row: SourcedRow;
  readonly stored: StoredOrder | null;
  readonly seen: LatestObservations | null;
  readonly result: TransitionResult;
  readonly step: AppliedStep;
  readonly attribution: Attribution | undefined;
  readonly directory: LedgerDirectory;
  readonly now: Instant;
}

/** The candidates a case carries: attribution's when it declined, else the order's own customer. */
function candidatesOf(a: Applying, customerId: string | null): readonly string[] {
  if (a.attribution?.kind === "review") return a.attribution.candidates;
  return customerId === null ? [] : [customerId];
}

/** Opens or refreshes the row's cases; returns the reasons of the cases it opened. */
function openCases(db: LedgerDb, a: Applying, orderId: string | null, reasons: readonly CaseReason[], deps: ApplyDeps): string[] {
  const unmatched = a.attribution?.kind === "customer" ? a.attribution.unmatchedRequest : null;
  const customerId = a.stored?.customerId ?? a.step.createdFor;
  const opened: string[] = [];
  for (const reason of reasons) {
    const evidence = { network: a.row.network, subject: subjectOf(a.row), orderId, reason, candidates: candidatesOf(a, customerId), observation: observationJson(a.row, unmatched), fingerprint: a.row.fingerprint };
    if (openOrRefreshCase(db, evidence, { by: deps.by, at: a.now }).write === "opened") opened.push(reason);
  }
  return opened;
}

/** Records the order; returns the link request attribution credited, the only one it is linked to. */
function createOrder(db: LedgerDb, a: Applying, customerId: string): string | null {
  const requestId = a.attribution?.kind === "customer" ? a.attribution.requestId : null;
  db.insert(orders)
    .values({
      orderId: a.row.orderId,
      network: a.row.network,
      // platform is NOT NULL: without a credited request the network names the shop.
      platform: (requestId === null ? null : a.directory.requestPlatform(requestId)) ?? a.row.network,
      customerId,
      requestId,
      status: "AWAITING_APPROVAL",
      recordedAt: a.row.purchasedAt ?? a.now,
      origin: "REPORT",
      updatedAt: a.now,
    })
    .run();
  return requestId;
}

const itemValue = (row: SourcedRow): number | null => {
  const values = row.items.flatMap((i) => (i.value === null ? [] : [i.value]));
  return values.length === 0 ? null : sumDong(values, "item value");
};

/** The row approves an order that was awaiting: a new approval, stamped from this row's period. */
const isNewApproval = (a: Applying): boolean => a.result.steps.some(([from, to]) => to === "APPROVED" && (from === null || from === "AWAITING_APPROVAL"));

function approvalChanges(a: Applying, approval: ApprovalEffect): Partial<OrderRow> {
  const amounts = { approvedCommission: approval.approvedCommission, cashback: approval.cashback, cashbackFee: approval.fee, cashbackTax: approval.tax, cashbackWithheld: approval.withheld };
  if (isNewApproval(a)) return { ...amounts, settlementPeriod: settlementPeriodOf(a.now), approvedAt: a.now };
  // Amending an earlier approval keeps its period and time; an imported one's period is its approval month.
  const approvedAt = (a.stored?.approvedAt ?? null) as Instant | null;
  return { ...amounts, settlementPeriod: a.stored?.settlementPeriod ?? (approvedAt === null ? null : settlementPeriodOf(approvedAt)) };
}

/** An imported order of no network takes the row's network, unless it is PAID (D4). */
const takesNetwork = (a: Applying, order: TransitionOrder): boolean => a.stored !== null && a.stored.network === null && a.stored.status !== "PAID" && order.status !== "PAID";

/** The order columns the row changes; a PAID order gets only its last-seen time (D4). */
function orderChanges(a: Applying, order: TransitionOrder): Partial<OrderRow> {
  const changes: Partial<OrderRow> = { lastSeenInReportAt: a.now };
  if (a.result.steps.length > 0) Object.assign(changes, { status: order.status, updatedAt: a.now });
  if (takesNetwork(a, order)) Object.assign(changes, { network: a.row.network, updatedAt: a.now });
  if (a.step.deferred || order.status === "PAID") return changes;
  const estimate = rowCommission(a.row);
  if (estimate !== null) changes.estimatedCommission = estimate;
  changes.orderValue = itemValue(a.row) ?? a.stored?.orderValue ?? null;
  if (a.step.approval !== null) Object.assign(changes, approvalChanges(a, a.step.approval), { updatedAt: a.now });
  const rejection = a.result.effects.find((e): e is Extract<Effect, { kind: "record_rejection" }> => e.kind === "record_rejection");
  if (rejection !== undefined) changes.rejectionReason = rejection.reason;
  return changes;
}

function storeObservation(db: LedgerDb, a: Applying, orderId: string): void {
  const repeat = a.step.deferred && a.seen?.latest?.fingerprint === a.row.fingerprint && !a.seen.latest.applied;
  if (!repeat) insertObservation(db, { orderId, observedAt: a.now, fingerprint: a.row.fingerprint, observation: observationJson(a.row), applied: !a.step.deferred });
  if (a.step.deferred || a.step.order?.status === "PAID") return;
  replaceItems(
    db,
    orderId,
    a.row.items.map((i) => ({ itemId: i.itemId, status: i.status, commission: i.commissionParts.length === 0 ? null : sumDong(i.commissionParts, "commission part"), value: i.value })),
  );
}

function carryOut(a: Applying, orderId: string, customerId: string | null, deps: ApplyDeps): void {
  for (const e of a.result.effects) {
    if (e.kind === "alert") deps.alerts.alert(e.alert, "high");
    if (e.kind === "awards") deps.awards.move(orderId, e.to);
    if (e.kind === "clawback") {
      if (customerId === null) throw new ReportApplyError(`order ${orderId} is paid but has no customer to claw back from`);
      deps.payouts.openClawback({ orderId, customerId, amount: e.amount, partial: e.partial });
    }
  }
}

function reasonOf(a: Applying): string {
  const rejection = a.result.effects.find((e) => e.kind === "record_rejection");
  if (rejection?.kind === "record_rejection") return rejection.reason;
  return a.step.reviewCases[0] ?? "report";
}

function writeSteps(db: LedgerDb, a: Applying, order: TransitionOrder, customerId: string | null, deps: ApplyDeps): void {
  const orderId = a.row.orderId;
  const approval = a.step.approval;
  const period = approval !== null && isNewApproval(a) ? settlementPeriodOf(a.now) : null;
  const facts: Record<string, AuditValue> = { network: a.row.network };
  const params: Record<string, number> = {};
  if (approval !== null) Object.assign(facts, { cashback: approval.cashback, withheld: approval.withheld }, period === null ? {} : { settlementPeriod: period });
  if (approval !== null) params.cashback = approval.cashback;
  const approvalReason = period === null || approval === null ? undefined : `approved in settlement period ${a.row.network} ${period}, ${approval.withheld ? "withheld" : "not withheld"}`;
  recordSteps(db, { orderId, customerId, guest: order.guest, steps: a.result.steps, reason: reasonOf(a), approvalReason, facts, params }, deps);
  if (takesNetwork(a, order)) recordNetworkSet(db, { orderId, status: order.status, network: a.row.network }, deps);
}

function applyToOrder(db: LedgerDb, a: Applying, deps: ApplyDeps): ApplyReport {
  const order = a.step.order as TransitionOrder;
  const orderId = a.row.orderId;
  const customerId = a.stored?.customerId ?? a.step.createdFor;
  const requestId = a.step.createdFor === null ? null : createOrder(db, a, a.step.createdFor);
  storeObservation(db, a, orderId);
  db.update(orders).set(orderChanges(a, order)).where(eq(orders.orderId, orderId)).run();
  carryOut(a, orderId, customerId, deps);
  const reviewCases = openCases(db, a, orderId, a.step.reviewCases, deps);
  writeSteps(db, a, order, customerId, deps);
  if (a.step.createdFor !== null) deps.events.recorded({ orderId, network: a.row.network, customerId: a.step.createdFor, requestId });
  const outcome: ApplyOutcome = a.step.createdFor !== null ? "recorded" : a.step.deferred ? "deferred" : a.result.steps.length > 0 ? "changed" : "observed";
  return { outcome, orderId, steps: a.result.steps, reviewCases };
}

/** A row whose order id belongs to another network's order changes nothing; a case says so. */
function networkMismatch(db: LedgerDb, row: SourcedRow, stored: StoredOrder, deps: ApplyDeps, now: Instant): ApplyReport {
  const evidence = { network: row.network, subject: row.orderId, orderId: stored.orderId, reason: "network_mismatch" as const, candidates: [], observation: observationJson(row), fingerprint: row.fingerprint };
  const opened = openOrRefreshCase(db, evidence, { by: deps.by, at: now }).write === "opened";
  return { outcome: "unrecorded", orderId: row.orderId, steps: [], reviewCases: opened ? ["network_mismatch"] : [] };
}

/** Applies one report row; call inside `tx`, one transaction per order (AD-8). */
export function applyReportRow(db: LedgerDb, row: SourcedRow, deps: ApplyDeps): ApplyReport {
  const now = deps.clock.now();
  const stored = row.orderId === "" ? null : findOrder(db, row.orderId);
  if (stored !== null && stored.network !== null && stored.network !== row.network) return networkMismatch(db, row, stored, deps, now);
  if (stored !== null) resolveSeenAgain(db, stored.orderId, { by: deps.by, at: now });
  const seen = stored === null ? null : latestObservations(db, stored.orderId);
  if (stored !== null && seen?.appliedFingerprint === row.fingerprint) {
    touchLastSeen(db, stored.orderId, now);
    return { outcome: "skipped", orderId: stored.orderId, steps: [], reviewCases: [] };
  }
  const directory = ledgerDirectory(db);
  const before = stored === null ? null : transitionOrderOf(db, stored);
  const context = contextFor(db, row, stored, directory, deps, now);
  const result = transition(before, { kind: "report", row }, context);
  const a: Applying = { row, stored, seen, result, step: applyResult(before, result), attribution: context.attribution, directory, now };
  if (a.step.order === null) return { outcome: "unrecorded", orderId: row.orderId, steps: [], reviewCases: openCases(db, a, null, a.step.reviewCases, deps) };
  return applyToOrder(db, a, deps);
}
