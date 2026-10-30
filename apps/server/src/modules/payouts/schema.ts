/**
 * The payouts module's tables (AD-4), as created by migrations/0007_payouts.sql,
 * 0013_payout_claims.sql, 0014_payout_confirm.sql and 0015_payout_proofs_and_void.sql. Only this module
 * writes them; tests/module-schemas.test.ts checks these definitions against the migrated
 * database column by column.
 */
import { PROOF_TYPES, type ProofType } from "@cashback/contracts";
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
  voidedBy: text("voided_by"),
});

export const PROOF_CONTENT_TYPES = PROOF_TYPES;
export type ProofContentType = ProofType;

/** The staff-only proof image of a payout (D49): where its file is, and what it is. */
export const payoutProofs = sqliteTable("payout_proofs", {
  payoutId: integer("payout_id")
    .primaryKey()
    .notNull()
    .references(() => payouts.payoutId),
  fileName: text("file_name").notNull().unique(),
  contentType: text("content_type", { enum: PROOF_CONTENT_TYPES }).notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
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

export const LEDGER_ENTRY_KINDS = ["CLAWBACK", "NETTING", "WRITE_OFF", "OFFSET", "NETTING_REFUND", "REFUND_PAID"] as const;
/** Entries of a credit owed to the customer after a void (0015), never part of a clawback's open amount. */
export const CREDIT_KINDS = ["NETTING_REFUND", "REFUND_PAID"] as const;
/** The entries a clawback's open amount sums (D42). */
export const CLAWBACK_KINDS = ["CLAWBACK", "NETTING", "WRITE_OFF", "OFFSET"] as const;

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
export type PayoutProofRow = typeof payoutProofs.$inferSelect;
