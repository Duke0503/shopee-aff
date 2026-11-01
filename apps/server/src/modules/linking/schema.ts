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
  // The folded product name of the snapshot (migration 0019), for the Orders list's search.
  searchText: text("search_text").notNull().default(""),
  // When a failed QUEUED request may be tried again (migration 0022); null means now.
  nextAttemptAt: text("next_attempt_at"),
  // The product the request is for (migration 0023, Story 5.2); the reuse lookup's key.
  productKey: text("product_key"),
  // A request's own page errors in a row and the first one's time (migration 0024, Story 5.5).
  pageErrors: integer("page_errors").notNull().default(0),
  pageErrorSince: text("page_error_since"),
});

export const shareCodes = sqliteTable("share_codes", {
  code: text("code").primaryKey().notNull(),
  requestId: text("request_id")
    .notNull()
    .unique()
    .references(() => linkRequests.requestId),
  createdAt: text("created_at"),
});

export const BRIDGE_JOB_KINDS = ["LINK", "LOOKUP", "REPORT_PAGE"] as const;
export const BRIDGE_JOB_STATUSES = ["PENDING", "DONE", "FAILED"] as const;

/** The affiliate browser's work list (migration 0022, AD-14): one LINK job is one request, so one customer. */
export const bridgeJobs = sqliteTable("bridge_jobs", {
  jobId: integer("job_id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: BRIDGE_JOB_KINDS }).notNull(),
  status: text("status", { enum: BRIDGE_JOB_STATUSES }).notNull(),
  requestId: text("request_id").references(() => linkRequests.requestId),
  customerId: text("customer_id"),
  subId1: text("sub_id1"),
  subId2: text("sub_id2"),
  sourceUrl: text("source_url"),
  resultUrl: text("result_url"),
  failure: text("failure"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
  // Times in a row the browser took the job and went silent (migration 0023, Story 5.3).
  noAnswers: integer("no_answers").notNull().default(0),
});

export type ProductOfferRow = typeof productOffers.$inferInsert;
export type LinkRequestRow = typeof linkRequests.$inferInsert;

/** Whether the Shopee link queue is held (captcha, page error) or paused (login lost) (migration 0024, Story 5.5). */
export const linkQueueState = sqliteTable("link_queue_state", {
  queue: text("queue", { enum: ["shopee"] }).primaryKey().notNull(),
  pausedReason: text("paused_reason", { enum: ["login_redirect"] }),
  pausedAt: text("paused_at"),
  heldReason: text("held_reason", { enum: ["captcha", "page_error"] }),
  heldUntil: text("held_until"),
  lastPageErrorRequest: text("last_page_error_request"),
});
