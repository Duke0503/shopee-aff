/**
 * The orders module's part of the Overview (FR-25, FR-27, R5, docs/operations/dashboard-spec.md):
 * the stored facts of the orders behind each figure, read with the time base the spec names.
 * Nothing here adds money up; the Overview's composition sums these stored integers through
 * `packages/money`, so the same rows feed the period figures, the weekly trend, the events and the
 * customer concentration. Only APPROVED and PAID orders with an approved commission are approved
 * facts: REVERSED, REJECTED and FROZEN orders are in no money line.
 */
import type { InstantRange } from "@cashback/core";
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { orders, reviewCases, type OrderNetwork } from "./schema";

export interface ApprovedOrderFact {
  readonly orderId: string;
  readonly network: OrderNetwork | null;
  readonly customerId: string | null;
  readonly status: "APPROVED" | "PAID";
  readonly approvedAt: string;
  readonly approvedCommission: number;
  /** Stored at approval; null for an order imported at cutover (the live system stored no split). */
  readonly fee: number | null;
  readonly tax: number | null;
  readonly cashback: number;
  readonly orderValue: number | null;
  /** The settlement period whose withholding the stored split used, when it was withheld. */
  readonly withheldPeriod: string | null;
}

const approvedColumns = {
  orderId: orders.orderId,
  network: orders.network,
  customerId: orders.customerId,
  status: orders.status,
  approvedAt: orders.approvedAt,
  approvedCommission: orders.approvedCommission,
  fee: orders.cashbackFee,
  tax: orders.cashbackTax,
  cashback: orders.cashback,
  orderValue: orders.orderValue,
  withheld: orders.cashbackWithheld,
  period: orders.settlementPeriod,
};

const APPROVED_STATES = ["APPROVED", "PAID"] as const;

function toFact(r: { orderId: string; network: OrderNetwork | null; customerId: string | null; status: string; approvedAt: string | null; approvedCommission: number | null; fee: number | null; tax: number | null; cashback: number | null; orderValue: number | null; withheld: boolean | null; period: string | null }): ApprovedOrderFact {
  return {
    orderId: r.orderId,
    network: r.network,
    customerId: r.customerId,
    status: r.status as ApprovedOrderFact["status"],
    approvedAt: r.approvedAt ?? "",
    approvedCommission: r.approvedCommission ?? 0,
    fee: r.fee,
    tax: r.tax,
    cashback: r.cashback ?? 0,
    orderValue: r.orderValue,
    withheldPeriod: r.withheld === true ? r.period : null,
  };
}

const approvedWhere = and(inArray(orders.status, [...APPROVED_STATES]), isNotNull(orders.approvedCommission), isNotNull(orders.approvedAt));

/** Orders the network approved inside the range (the business result's time base, by `approved_at`). */
export function approvedOrderFacts(db: LedgerDb, range: InstantRange): ApprovedOrderFact[] {
  return db.select(approvedColumns).from(orders).where(and(approvedWhere, gte(orders.approvedAt, range.from), lt(orders.approvedAt, range.to))).orderBy(orders.orderId).all().map(toFact);
}

/** The approved facts of the orders named, whenever they were approved (an event's award orders). */
export function approvedFactsOf(db: LedgerDb, orderIds: readonly string[]): ApprovedOrderFact[] {
  if (orderIds.length === 0) return [];
  return db.select(approvedColumns).from(orders).where(and(approvedWhere, inArray(orders.orderId, [...orderIds]))).orderBy(orders.orderId).all().map(toFact);
}

export interface RecordedOrderFact {
  readonly orderId: string;
  readonly network: OrderNetwork | null;
  readonly customerId: string | null;
  readonly status: string;
  readonly approvedCommission: number | null;
  readonly orderValue: number | null;
}

/** Orders recorded inside the range (the orders block's time base, by `recorded_at`), in their current status. */
export function recordedOrderFacts(db: LedgerDb, range: InstantRange): RecordedOrderFact[] {
  return db
    .select({ orderId: orders.orderId, network: orders.network, customerId: orders.customerId, status: orders.status, approvedCommission: orders.approvedCommission, orderValue: orders.orderValue })
    .from(orders)
    .where(and(gte(orders.recordedAt, range.from), lt(orders.recordedAt, range.to)))
    .orderBy(orders.orderId)
    .all();
}

/** The stored customer ids that had an order recorded before `before` (the repeat customers of a period). */
export function customersWithOrderBefore(db: LedgerDb, before: string): Set<string> {
  const rows = db.selectDistinct({ customerId: orders.customerId }).from(orders).where(and(isNotNull(orders.customerId), lt(orders.recordedAt, before))).all();
  return new Set(rows.flatMap((r) => (r.customerId === null ? [] : [r.customerId])));
}

/** Approved commission of approved and paid orders no network batch has settled yet (what the networks still owe). */
export function unsettledApprovedCommission(db: LedgerDb): number {
  return db.get<{ total: number }>(sql`SELECT coalesce(sum(${orders.approvedCommission}), 0) AS total FROM ${orders} WHERE ${orders.status} IN ('APPROVED', 'PAID') AND ${orders.settledAt} IS NULL AND ${orders.approvedCommission} IS NOT NULL`).total;
}

export interface AwaitingOrderFact {
  readonly customerId: string | null;
  readonly recordedAt: string | null;
  readonly network: OrderNetwork | null;
  readonly estimatedCommission: number | null;
}

/** Every order still waiting for the network, with its estimate. */
export function awaitingOrderFacts(db: LedgerDb): AwaitingOrderFact[] {
  return db.select({ customerId: orders.customerId, recordedAt: orders.recordedAt, network: orders.network, estimatedCommission: orders.estimatedCommission }).from(orders).where(eq(orders.status, "AWAITING_APPROVAL")).all();
}

/**
 * Orders imported at cutover that were paid in the range but carry no approval facts: the live
 * system stored no approved commission and no approval time, so they cannot be placed by approval
 * day. The Overview counts them so the business result says what it leaves out.
 */
export function importedWithoutApproval(db: LedgerDb, range: InstantRange): number {
  return db
    .select({ n: sql<number>`count(*)` })
    .from(orders)
    .where(and(eq(orders.origin, "CUTOVER"), inArray(orders.status, [...APPROVED_STATES]), isNull(orders.approvedAt), gte(orders.paidAt, range.from), lt(orders.paidAt, range.to)))
    .get()?.n ?? 0;
}

/** Review cases still open (the Review queue's open tab total). */
export function openReviewCaseCount(db: LedgerDb): number {
  return db.select({ n: sql<number>`count(*)` }).from(reviewCases).where(eq(reviewCases.status, "OPEN")).get()?.n ?? 0;
}
