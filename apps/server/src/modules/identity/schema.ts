/**
 * The identity module's tables (AD-4), as created by migrations/0001_identity.sql. Only this
 * module writes them; tests/identity-schema.test.ts checks these definitions against the
 * migrated database column by column.
 */
import { STAFF_ROLES } from "@cashback/core";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

/** Staff members (migrations/0011_staff_sessions.sql, Story 4.2); seeded by command (Story 4.20). */
export const staff = sqliteTable("staff", {
  staffId: text("staff_id").primaryKey().notNull(),
  username: text("username").notNull(),
  role: text("role", { enum: STAFF_ROLES }).notNull(),
  status: text("status", { enum: ["ACTIVE", "DISABLED"] }).notNull(),
  isRoot: integer("is_root", { mode: "boolean" }).notNull().default(false),
  passwordHash: text("password_hash").notNull(),
  passwordSetAt: text("password_set_at").notNull(),
  lastSignInAt: text("last_sign_in_at"),
  createdAt: text("created_at").notNull(),
});

/** Failed staff sign-ins per (submitted name, Access identity) for the doubling delay (AD-18). */
export const staffSignInThrottles = sqliteTable(
  "staff_sign_in_throttles",
  {
    username: text("username").notNull(),
    accessSubject: text("access_subject").notNull(),
    failures: integer("failures").notNull(),
    lockedUntil: text("locked_until"),
    lastFailedAt: text("last_failed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.username, t.accessSubject] })],
);

export const SESSION_KINDS = ["CUSTOMER", "STAFF"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
export const SESSION_END_REASONS = ["SIGNED_OUT", "NEW_PASSWORD", "STAFF_DISABLED"] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

/** Customer and staff sessions; only the SHA-256 of the token is stored (AD-18, INV-8). */
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey().notNull(),
  kind: text("kind", { enum: SESSION_KINDS }).notNull(),
  customerId: text("customer_id").references(() => customers.customerId),
  staffId: text("staff_id").references(() => staff.staffId),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
  endedAt: text("ended_at"),
  endReason: text("end_reason", { enum: SESSION_END_REASONS }),
});

export type StaffRow = typeof staff.$inferSelect;
export type CustomerRow = typeof customers.$inferInsert;
export type CustomerAliasRow = typeof customerAliases.$inferInsert;
export type BankAccountRow = typeof bankAccounts.$inferInsert;
