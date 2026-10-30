/**
 * The operations module's tables (AD-4), as created by migrations/0005_operations.sql. Only this
 * module writes them; tests/module-schemas.test.ts checks these definitions against the migrated
 * database column by column.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { ALERT_SEVERITIES } from "../../platform/ports/alert.port";
import { ACTOR_KINDS } from "../../platform/ports/audit.port";

export const auditEntries = sqliteTable("audit_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordedAt: text("recorded_at").notNull(),
  actorKind: text("actor_kind", { enum: ACTOR_KINDS }).notNull(),
  actorId: text("actor_id").notNull(),
  event: text("event").notNull(),
  entityId: text("entity_id").notNull(),
  payload: text("payload").notNull().default("{}"),
  reason: text("reason"),
});

export const ALERT_DELIVERIES = ["PENDING", "SENDING", "SENT", "FAILED"] as const;

export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  severity: text("severity", { enum: ALERT_SEVERITIES }).notNull(),
  raisedAt: text("raised_at").notNull(),
  suppressed: integer("suppressed").notNull().default(0),
  delivery: text("delivery", { enum: ALERT_DELIVERIES }).notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  sendAttempt: text("send_attempt"),
  deliveredAt: text("delivered_at"),
});

export type AlertRow = typeof alerts.$inferSelect;
