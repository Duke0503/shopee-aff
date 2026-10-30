/**
 * The messaging module's tables (AD-4), as created by migrations/0004_messaging.sql. Only this
 * module writes them; tests/module-schemas.test.ts checks these definitions against the
 * migrated database column by column.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
});

export type OutboxRow = typeof outbox.$inferSelect;
