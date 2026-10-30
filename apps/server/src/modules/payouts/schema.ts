/**
 * The payouts module's tables (AD-4), as created by migrations/0007_payouts.sql. Only this module
 * writes them; tests/module-schemas.test.ts checks these definitions against the migrated
 * database column by column.
 */
import type { PayoutStatus } from "@cashback/core";
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

export type PayoutRow = typeof payouts.$inferInsert;
export type PayoutItemRow = typeof payoutItems.$inferInsert;
