/**
 * The linking module's tables (AD-4), as created by migrations/0003_linking.sql. Only this
 * module writes them; tests/module-schemas.test.ts checks these definitions against the
 * migrated database column by column.
 */
import type { LinkRequestStatus } from "@cashback/core";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const LINK_REQUEST_STATUSES = ["QUEUED", "ISSUED", "DELIVERED", "CONVERTED", "FAILED"] as const satisfies readonly LinkRequestStatus[];
export const LINK_NETWORKS = ["shopee", "accesstrade"] as const;
export type LinkNetwork = (typeof LINK_NETWORKS)[number];

export const productOffers = sqliteTable("product_offers", {
  productOfferId: text("product_offer_id").primaryKey().notNull(),
  shopId: text("shop_id"),
  name: text("name"),
  imageUrl: text("image_url"),
  price: integer("price"),
  shopeeRateBps: integer("shopee_rate_bps"),
  sellerRateBps: integer("seller_rate_bps"),
  canonicalUrl: text("canonical_url"),
  firstSeenAt: text("first_seen_at"),
  updatedAt: text("updated_at"),
  origin: text("origin", { enum: ["CUTOVER", "LOOKUP"] }).notNull(),
});

export const linkRequests = sqliteTable("link_requests", {
  requestId: text("request_id").primaryKey().notNull(),
  // References identity's customers in SQL; identity's tables are not imported across the module wall.
  customerId: text("customer_id").notNull(),
  network: text("network", { enum: LINK_NETWORKS }),
  platform: text("platform").notNull(),
  channel: text("channel"),
  status: text("status", { enum: LINK_REQUEST_STATUSES }).notNull(),
  sourceUrl: text("source_url").notNull(),
  affiliateUrl: text("affiliate_url"),
  attempts: integer("attempts").notNull().default(0),
  estimatedCommission: integer("estimated_commission"),
  productOfferId: text("product_offer_id").references(() => productOffers.productOfferId),
  productName: text("product_name"),
  productImageUrl: text("product_image_url"),
  productPrice: integer("product_price"),
  shopeeRateBps: integer("shopee_rate_bps"),
  sellerRateBps: integer("seller_rate_bps"),
  createdAt: text("created_at"),
  deliveredAt: text("delivered_at"),
  origin: text("origin", { enum: ["CUTOVER", "REQUEST"] }).notNull(),
});

export const shareCodes = sqliteTable("share_codes", {
  code: text("code").primaryKey().notNull(),
  requestId: text("request_id")
    .notNull()
    .unique()
    .references(() => linkRequests.requestId),
  createdAt: text("created_at"),
});

export type ProductOfferRow = typeof productOffers.$inferInsert;
export type LinkRequestRow = typeof linkRequests.$inferInsert;
