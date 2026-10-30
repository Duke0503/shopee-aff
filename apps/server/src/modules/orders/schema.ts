/**
 * The orders module's tables (AD-4), as created by migrations/0002_orders.sql,
 * 0008_reconciliation.sql, 0009_review_case_evidence.sql and 0010_reconciliation_runs.sql. Only this module
 * writes them; tests/module-schemas.test.ts checks these definitions against the migrated
 * database column by column.
 */
import type { OrderStatus, ReviewCaseStatus } from "@cashback/core";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ORDER_STATUSES = ["AWAITING_APPROVAL", "FROZEN", "APPROVED", "REVERSED", "PAID", "REJECTED"] as const satisfies readonly OrderStatus[];
export const ORDER_NETWORKS = ["shopee", "accesstrade"] as const;
export type OrderNetwork = (typeof ORDER_NETWORKS)[number];
const ORIGINS = ["CUTOVER", "REPORT"] as const;

export const orders = sqliteTable("orders", {
  orderId: text("order_id").primaryKey().notNull(),
  network: text("network", { enum: ORDER_NETWORKS }),
  platform: text("platform").notNull(),
  // References identity's customers in SQL; identity's tables are not imported across the module wall.
  customerId: text("customer_id"),
  requestId: text("request_id"),
  status: text("status", { enum: ORDER_STATUSES }).notNull(),
  orderValue: integer("order_value"),
  estimatedCommission: integer("estimated_commission"),
  approvedCommission: integer("approved_commission"),
  cashback: integer("cashback"),
  rejectionReason: text("rejection_reason"),
  recordedAt: text("recorded_at"),
  recordedAtApproximate: integer("recorded_at_approximate", { mode: "boolean" }).notNull().default(false),
  approvedAt: text("approved_at"),
  paidAt: text("paid_at"),
  networkBatchId: text("network_batch_id"),
  settledAt: text("settled_at"),
  lastSeenInReportAt: text("last_seen_in_report_at"),
  origin: text("origin", { enum: ORIGINS }).notNull(),
  updatedAt: text("updated_at"),
  cashbackFee: integer("cashback_fee"),
  cashbackTax: integer("cashback_tax"),
  cashbackWithheld: integer("cashback_withheld", { mode: "boolean" }),
  settlementPeriod: text("settlement_period"),
});

export const orderItems = sqliteTable(
  "order_items",
  {
    orderId: text("order_id")
      .notNull()
      .references(() => orders.orderId),
    lineNo: integer("line_no").notNull(),
    itemId: text("item_id"),
    name: text("name"),
    imageUrl: text("image_url"),
    quantity: integer("quantity"),
    price: integer("price"),
    estimatedCommission: integer("estimated_commission"),
    approvedCommission: integer("approved_commission"),
    networkStatus: text("network_status", { enum: ["AWAITING", "APPROVED", "CANCELLED", "UNKNOWN"] }),
    origin: text("origin", { enum: ORIGINS }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.lineNo] })],
);

export const orderStatusHistory = sqliteTable("order_status_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.orderId),
  fromStatus: text("from_status", { enum: ORDER_STATUSES }),
  toStatus: text("to_status", { enum: ORDER_STATUSES }).notNull(),
  actor: text("actor").notNull(),
  reason: text("reason"),
  changedAt: text("changed_at").notNull(),
});

export const orderObservations = sqliteTable("order_observations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.orderId),
  observedAt: text("observed_at").notNull(),
  fingerprint: text("fingerprint").notNull(),
  observation: text("observation").notNull(),
  applied: integer("applied", { mode: "boolean" }).notNull(),
});

export const settlementPeriods = sqliteTable(
  "settlement_periods",
  {
    network: text("network", { enum: ORDER_NETWORKS }).notNull(),
    periodMonth: text("period_month").notNull(),
    withheld: integer("withheld", { mode: "boolean" }).notNull().default(true),
    origin: text("origin", { enum: ["CUTOVER", "STAFF"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.network, t.periodMonth] })],
);

/** The latest network payout batch's withholding per network (migration 0018, D59): the estimate approvals take. */
export const networkWithholding = sqliteTable("network_withholding", {
  network: text("network", { enum: ORDER_NETWORKS }).primaryKey().notNull(),
  withheld: integer("withheld", { mode: "boolean" }).notNull(),
  networkPayoutId: text("network_payout_id").notNull(),
  observedAt: text("observed_at").notNull(),
  recordedAt: text("recorded_at").notNull(),
});

export const REVIEW_CASE_STATUSES = ["OPEN", "RESOLVED"] as const satisfies readonly ReviewCaseStatus[];

export const reviewCases = sqliteTable("review_cases", {
  caseId: integer("case_id").primaryKey({ autoIncrement: true }),
  network: text("network", { enum: ORDER_NETWORKS }).notNull(),
  subject: text("subject").notNull(),
  orderId: text("order_id").references(() => orders.orderId),
  reason: text("reason").notNull(),
  status: text("status", { enum: REVIEW_CASE_STATUSES }).notNull(),
  resolution: text("resolution", { enum: ["APPLIED", "DISMISSED"] }),
  candidates: text("candidates").notNull().default("[]"),
  observation: text("observation").notNull(),
  openedAt: text("opened_at").notNull(),
  openedBy: text("opened_by").notNull(),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
  resolutionReason: text("resolution_reason"),
  fingerprint: text("fingerprint"),
  refreshedAt: text("refreshed_at"),
});

export const RECONCILIATION_RUN_KINDS = ["HOURLY", "NIGHTLY"] as const;
export const RUN_OUTCOMES = ["SUCCEEDED", "FAILED", "SOURCE_STALE"] as const;

export const reconciliationRuns = sqliteTable("reconciliation_runs", {
  runId: integer("run_id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: RECONCILIATION_RUN_KINDS }).notNull(),
  network: text("network", { enum: ORDER_NETWORKS }).notNull(),
  source: text("source"),
  sourceSha256: text("source_sha256"),
  sourceModifiedAt: text("source_modified_at"),
  windowFrom: text("window_from").notNull(),
  windowTo: text("window_to").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at").notNull(),
  durationMs: integer("duration_ms").notNull(),
  clockStepped: integer("clock_stepped", { mode: "boolean" }).notNull().default(false),
  outcome: text("outcome", { enum: RUN_OUTCOMES }).notNull(),
  errorCode: text("error_code"),
  rowsRead: integer("rows_read").notNull().default(0),
  applied: integer("applied").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  deferred: integer("deferred").notNull().default(0),
  unrecorded: integer("unrecorded").notNull().default(0),
  frozen: integer("frozen").notNull().default(0),
  casesOpened: integer("cases_opened").notNull().default(0),
  failedRows: integer("failed_rows").notNull().default(0),
});

export type OrderRow = typeof orders.$inferInsert;
