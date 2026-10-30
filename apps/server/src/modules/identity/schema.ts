/**
 * The identity module's tables (AD-4), as created by migrations/0001_identity.sql. Only this
 * module writes them; tests/identity-schema.test.ts checks these definitions against the
 * migrated database column by column.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** HOUSE is the guest account (D5); staff are ADMIN and EMPLOYEE. */
export const CUSTOMER_ROLES = ["USER", "ADMIN", "EMPLOYEE", "HOUSE"] as const;
export type CustomerRole = (typeof CUSTOMER_ROLES)[number];

export const customers = sqliteTable("customers", {
  customerId: text("customer_id").primaryKey().notNull(),
  customerCode: text("customer_code"),
  role: text("role", { enum: CUSTOMER_ROLES }).notNull(),
  status: text("status", { enum: ["ACTIVE", "DISABLED", "MERGED", "ERASED"] }).notNull(),
  zaloUserId: text("zalo_user_id"),
  privateChatId: text("private_chat_id"),
  displayName: text("display_name"),
  searchText: text("search_text").notNull().default(""),
  sortKey: text("sort_key").notNull().default(""),
  passwordHash: text("password_hash"),
  passwordSetAt: text("password_set_at"),
  failedSignIns: integer("failed_sign_ins").notNull().default(0),
  lockedUntil: text("locked_until"),
  lastSignInAt: text("last_sign_in_at"),
  createdAt: text("created_at"),
});

export const customerAliases = sqliteTable("customer_aliases", {
  alias: text("alias").primaryKey().notNull(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.customerId),
  createdAt: text("created_at"),
  note: text("note"),
});

export const customerCodeCounter = sqliteTable("customer_code_counter", {
  id: integer("id").primaryKey().notNull(),
  last: integer("last").notNull(),
});

export const bankAccounts = sqliteTable("bank_accounts", {
  customerId: text("customer_id")
    .primaryKey()
    .notNull()
    .references(() => customers.customerId),
  bankName: text("bank_name"),
  accountNumber: text("account_number").notNull(),
  holderName: text("holder_name"),
  fingerprint: text("fingerprint").notNull(),
  consentAt: text("consent_at"),
  pendingConfirmation: integer("pending_confirmation", { mode: "boolean" }).notNull().default(false),
});

export type CustomerRow = typeof customers.$inferInsert;
export type CustomerAliasRow = typeof customerAliases.$inferInsert;
export type BankAccountRow = typeof bankAccounts.$inferInsert;
