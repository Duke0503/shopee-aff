/**
 * The operations module's tables (AD-4), as created by migrations/0005_operations.sql (and 0012, 0031, 0036, 0037). Only this
 * module writes them; tests/module-schemas.test.ts checks these definitions against the migrated
 * database column by column.
 */
import { STAFF_ROLES } from "@cashback/core";
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
  /** The staff role of a staff actor (migration 0012); NULL for other actors and older entries. */
  actorRole: text("actor_role", { enum: STAFF_ROLES }),
});

export const ALERT_DELIVERIES = ["PENDING", "SENDING", "SENT", "FAILED", "EXPIRED"] as const;

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
  /** A repeat queued behind a sent alert goes out only from this instant (migration 0031). */
  notBefore: text("not_before"),
  /** JSON `AlertDetail`: the step that found the problem, ids only (migration 0036, D65). */
  detail: text("detail"),
  /** One alert per key, outside the kind's cooldown; NULL on every alert that has a cooldown (migration 0036). */
  dedupKey: text("dedup_key").unique(),
});

export type AlertRow = typeof alerts.$inferSelect;

/** One row per reported Vietnam day (migration 0037, D66): one report per day, whatever restarts. */
export const dailyLinkReports = sqliteTable("daily_link_reports", {
  reportDate: text("report_date").primaryKey().notNull(),
  /** JSON array of the messages, written once; it holds names, so it is NULL once sent or dropped. */
  parts: text("parts"),
  partsSent: integer("parts_sent").notNull().default(0),
  sentAt: text("sent_at"),
});
