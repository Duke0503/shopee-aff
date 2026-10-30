/**
 * The payouts module's tables (AD-4), as created by migrations/0007_payouts.sql,
 * 0013_payout_claims.sql and 0014_payout_confirm.sql. Only this module
 * writes them; tests/module-schemas.test.ts checks these definitions against the migrated
 * database column by column.
 */
import type { PayoutClaimStatus, PayoutStatus } from "@cashback/core";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const PAYOUT_STATUSES = ["RECORDED", "VOIDED"] as const satisfies readonly PayoutStatus[];

export const payouts = sqliteTable("payouts", {
  payoutId: integer("payout_id").primaryKey({ autoIncrement: true }),
  // References identity's customers in SQL; identity's tables are not imported across the module wall.
  customerId: text("customer_id").notNull(),
  status: text("status", { enum: PAYOUT_STATUSES }).notNull(),
  transferAmount: integer("transfer_amount").notNull(),
  transferReference: text("transfer_reference"),
  receiptToken: text("receipt_token").unique(),
  bankLastFour: text("bank_last_four"),
  claimId: text("claim_id"),
  recordedBy: text("recorded_by"),
  recordedAt: text("recorded_at"),
  note: text("note"),
  proofRef: text("proof_ref"),
  voidedAt: text("voided_at"),
  voidReason: text("void_reason"),
  origin: text("origin", { enum: ["CUTOVER", "CONFIRM"] }).notNull(),
});

export const payoutItems = sqliteTable(
  "payout_items",
  {
    payoutId: integer("payout_id")
      .notNull()
      .references(() => payouts.payoutId),
    lineNo: integer("line_no").notNull(),
    kind: text("kind", { enum: ["ORDER", "AWARD"] }).notNull(),
    orderId: text("order_id").notNull(),
    awardId: integer("award_id"),
    amount: integer("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.payoutId, t.lineNo] })],
);

export const LEDGER_ENTRY_KINDS = ["CLAWBACK", "NETTING", "WRITE_OFF", "OFFSET"] as const;

export const ledgerEntries = sqliteTable("ledger_entries", {
  entryId: integer("entry_id").primaryKey({ autoIncrement: true }),
  customerId: text("customer_id").notNull(),
  clawbackId: text("clawback_id").notNull(),
  kind: text("kind", { enum: LEDGER_ENTRY_KINDS }).notNull(),
  amount: integer("amount").notNull(),
  orderId: text("order_id"),
  payoutId: integer("payout_id").references(() => payouts.payoutId),
  reason: text("reason"),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
});

export const PAYOUT_CLAIM_STATUSES = ["OPEN", "CONFIRMED", "ABANDONED"] as const satisfies readonly PayoutClaimStatus[];

/** One staff member's hold on paying one customer, with the snapshot the preview showed (AD-9, D39). */
export const payoutClaims = sqliteTable("payout_claims", {
  claimId: text("claim_id").primaryKey().notNull(),
  customerId: text("customer_id").notNull(),
  staffId: text("staff_id").notNull(),
  status: text("status", { enum: PAYOUT_CLAIM_STATUSES }).notNull(),
  orderIds: text("order_ids").notNull(),
  awardIds: text("award_ids").notNull(),
  clawbackIds: text("clawback_ids").notNull(),
  amount: integer("amount").notNull(),
  bankFingerprint: text("bank_fingerprint"),
  bankHeld: integer("bank_held", { mode: "boolean" }).notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  transferReference: text("transfer_reference").notNull().unique(),
  openedAt: text("opened_at").notNull(),
  lastActiveAt: text("last_active_at").notNull(),
  qrShownAt: text("qr_shown_at"),
  abandonedAt: text("abandoned_at"),
  confirmedAt: text("confirmed_at"),
});

export type PayoutRow = typeof payouts.$inferInsert;
export type PayoutClaimRow = typeof payoutClaims.$inferSelect;
export type PayoutItemRow = typeof payoutItems.$inferInsert;
export type RecordedPayoutRow = typeof payouts.$inferSelect;
