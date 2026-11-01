/**
 * The messaging module's tables (AD-4), as created by migrations/0004_messaging.sql and
 * 0026_outbox_delivery.sql. Only this module writes them; tests/module-schemas.test.ts checks
 * these definitions against the migrated database column by column.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const OUTBOX_DROP_REASONS = ["expired", "no_recipient", "undeliverable", "superseded"] as const;
export type OutboxDropReason = (typeof OUTBOX_DROP_REASONS)[number];

export const outbox = sqliteTable("outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dedupKey: text("dedup_key").notNull().unique(),
  // References identity's customers in SQL; identity's tables are not imported across the module wall.
  customerId: text("customer_id").notNull(),
  messageKey: text("message_key").notNull(),
  params: text("params").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  dueAt: text("due_at"),
  sentAt: text("sent_at"),
  attempts: integer("attempts").notNull().default(0),
  origin: text("origin", { enum: ["EVENT", "CUTOVER_SEED"] }).notNull(),
  // Migration 0026 (Stories 6.4, 6.10).
  handedOutAt: text("handed_out_at"),
  silencedAt: text("silenced_at"),
  droppedAt: text("dropped_at"),
  dropReason: text("drop_reason", { enum: OUTBOX_DROP_REASONS }),
});

export type OutboxRow = typeof outbox.$inferSelect;

export const messagingSettings = sqliteTable("messaging_settings", {
  id: integer("id").primaryKey().notNull(),
  silent: integer("silent").notNull().default(0),
  changedAt: text("changed_at"),
  changedBy: text("changed_by"),
});

export const outboxCapDays = sqliteTable("outbox_cap_days", {
  day: text("day").primaryKey().notNull(),
  reachedAt: text("reached_at").notNull(),
});
