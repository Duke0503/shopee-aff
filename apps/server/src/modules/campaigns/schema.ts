/**
 * The campaigns module's tables (AD-4), as created by migrations/0006_campaigns.sql. Only this
 * module writes them; tests/module-schemas.test.ts checks these definitions against the migrated
 * database column by column.
 */
import type { CampaignAwardStatus } from "@cashback/core";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const CAMPAIGN_AWARD_STATUSES = ["HELD", "CONFIRMED", "PAID", "VOID"] as const satisfies readonly CampaignAwardStatus[];

export const campaigns = sqliteTable("campaigns", {
  campaignId: text("campaign_id").primaryKey().notNull(),
  name: text("name").notNull(),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  slots: integer("slots").notNull(),
  bonus: integer("bonus").notNull(),
  minOrderValue: integer("min_order_value").notNull().default(0),
  platforms: text("platforms").notNull().default(""),
  excludedCustomers: text("excluded_customers").notNull().default(""),
  perCustomer: integer("per_customer").notNull().default(0),
  acceptsAwards: integer("accepts_awards", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at"),
  origin: text("origin", { enum: ["CUTOVER", "STAFF"] }).notNull(),
});

export const campaignAwards = sqliteTable("campaign_awards", {
  awardId: integer("award_id").primaryKey({ autoIncrement: true }),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.campaignId),
  // References identity's customers and orders' orders in SQL; their tables are not imported across the module wall.
  customerId: text("customer_id").notNull(),
  orderId: text("order_id").notNull(),
  amount: integer("amount").notNull(),
  status: text("status", { enum: CAMPAIGN_AWARD_STATUSES }).notNull(),
  createdAt: text("created_at"),
  confirmedAt: text("confirmed_at"),
  paidAt: text("paid_at"),
  voidedAt: text("voided_at"),
  origin: text("origin", { enum: ["CUTOVER", "RULE"] }).notNull(),
});

export type CampaignRow = typeof campaigns.$inferInsert;
export type CampaignAwardRow = typeof campaignAwards.$inferInsert;
