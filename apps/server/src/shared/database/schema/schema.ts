import { sqliteTable, AnySQLiteColumn, uniqueIndex, check, text, integer, index, foreignKey, real } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const customers = sqliteTable("customers", {
	customerId: text("customer_id").primaryKey(),
	zaloUserId: text("zalo_user_id"),
	privateChatId: text("private_chat_id"),
	displayName: text("display_name"),
	bankName: text("bank_name"),
	bankAccount: text("bank_account"),
	accountHolder: text("account_holder"),
	consentAt: text("consent_at"),
	status: text().default("active").notNull(),
	createdAt: text("created_at").notNull(),
	passwordHash: text("password_hash"),
	passwordSetAt: text("password_set_at"),
	failedLogins: integer("failed_logins").default(0).notNull(),
	lockedUntil: text("locked_until"),
	role: text().default("user").notNull(),
	lastLoginAt: text("last_login_at"),
	loginCount: integer("login_count").default(0).notNull(),
	customerCode: text("customer_code"),
},
(table) => {
	return {
		idxCustomersCode: uniqueIndex("idx_customers_code").on(table.customerCode),
		idxCustomersZalo: uniqueIndex("idx_customers_zalo").on(table.zaloUserId),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const linkRequests = sqliteTable("link_requests", {
	requestId: text("request_id").primaryKey(),
	customerId: text("customer_id").notNull().references(() => customers.customerId),
	createdAt: text("created_at").notNull(),
	sourceUrl: text("source_url").notNull(),
	affiliateUrl: text("affiliate_url"),
	estimatedCommission: integer("estimated_commission"),
	channel: text(),
	status: text().default("pending").notNull(),
	notifiedAt: text("notified_at"),
	estimateSource: text("estimate_source"),
	estimateDetail: text("estimate_detail"),
	attempts: integer().default(0).notNull(),
	platform: text().default("shopee").notNull(),
	shareCode: text("share_code"),
},
(table) => {
	return {
		idxReqShareCode: uniqueIndex("idx_req_share_code").on(table.shareCode),
		idxReqPlatform: index("idx_req_platform").on(table.platform),
		idxReqStatus: index("idx_req_status").on(table.status),
		idxReqCustomer: index("idx_req_customer").on(table.customerId),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const orders = sqliteTable("orders", {
	orderId: text("order_id").primaryKey(),
	customerId: text("customer_id").references(() => customers.customerId),
	requestId: text("request_id").references(() => linkRequests.requestId),
	orderValue: integer("order_value"),
	estimatedCommission: integer("estimated_commission"),
	approvedCommission: integer("approved_commission"),
	cashbackAmount: integer("cashback_amount"),
	status: text().notNull(),
	rejectionReason: text("rejection_reason"),
	recordedAt: text("recorded_at"),
	approvedAt: text("approved_at"),
	paidAt: text("paid_at"),
	updatedAt: text("updated_at").notNull(),
	notifiedStatus: text("notified_status"),
	platform: text().default("shopee").notNull(),
	settlementStatus: text("settlement_status").default("unsettled").notNull(),
	payoutBatchId: text("payout_batch_id"),
	settledAt: text("settled_at"),
},
(table) => {
	return {
		idxOrdersSettlement: index("idx_orders_settlement").on(table.settlementStatus),
		idxOrdersBatch: index("idx_orders_batch").on(table.payoutBatchId),
		idxOrdersPlatform: index("idx_orders_platform").on(table.platform),
		idxOrderStatus: index("idx_order_status").on(table.status),
		idxOrderCustomer: index("idx_order_customer").on(table.customerId),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const stateHistory = sqliteTable("state_history", {
	id: integer().primaryKey({ autoIncrement: true }),
	orderId: text("order_id").notNull(),
	fromStatus: text("from_status"),
	toStatus: text("to_status").notNull(),
	changedAt: text("changed_at").notNull(),
	note: text(),
},
(table) => {
	return {
		idxHistoryOrder: index("idx_history_order").on(table.orderId),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const manualReview = sqliteTable("manual_review", {
	id: integer().primaryKey({ autoIncrement: true }),
	orderId: text("order_id"),
	rawData: text("raw_data").notNull(),
	reason: text().notNull(),
	createdAt: text("created_at").notNull(),
	resolved: integer().default(0).notNull(),
},
(table) => {
	return {
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const reconciliationRuns = sqliteTable("reconciliation_runs", {
	id: integer().primaryKey({ autoIncrement: true }),
	ranAt: text("ran_at").notNull(),
	source: text().notNull(),
	periodStart: text("period_start"),
	periodEnd: text("period_end"),
	rowsRead: integer("rows_read").default(0).notNull(),
	ordersNew: integer("orders_new").default(0).notNull(),
	approved: integer().default(0).notNull(),
	rejected: integer().default(0).notNull(),
	skipped: integer().default(0).notNull(),
	needsReview: integer("needs_review").default(0).notNull(),
	error: text(),
},
(table) => {
	return {
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const sessions = sqliteTable("sessions", {
	tokenHash: text("token_hash").primaryKey(),
	customerId: text("customer_id").notNull(),
	createdAt: text("created_at").notNull(),
	expiresAt: text("expires_at").notNull(),
},
(table) => {
	return {
		idxSessionsCustomer: index("idx_sessions_customer").on(table.customerId),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const productsCache = sqliteTable("products_cache", {
	itemId: text("item_id").primaryKey(),
	shopId: text("shop_id"),
	name: text(),
	price: integer(),
	priceFormatted: text("price_formatted"),
	shopeeRate: real("shopee_rate"),
	sellerRate: real("seller_rate"),
	shopeePart: integer("shopee_part"),
	shopeePartFormatted: text("shopee_part_formatted"),
	sellerPart: integer("seller_part"),
	sellerPartFormatted: text("seller_part_formatted"),
	totalCommission: integer("total_commission"),
	commissionFormatted: text("commission_formatted"),
	isCapped: integer("is_capped").default(0),
	cashback: integer(),
	cashbackFormatted: text("cashback_formatted"),
	ratePercent: text("rate_percent"),
	affiliateUrl: text("affiliate_url"),
	canonicalUrl: text("canonical_url"),
	requestCount: integer("request_count").default(1),
	firstSeenAt: text("first_seen_at").notNull(),
	updatedAt: text("updated_at").notNull(),
	imageUrl: text("image_url"),
},
(table) => {
	return {
		idxProductsCacheCanonical: index("idx_products_cache_canonical").on(table.canonicalUrl),
		idxProdCount: index("idx_prod_count").on(table.requestCount),
		idxProdUpdated: index("idx_prod_updated").on(table.updatedAt),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const activityLogs = sqliteTable("activity_logs", {
	id: integer().primaryKey({ autoIncrement: true }),
	customerId: text("customer_id"),
	action: text().notNull(),
	path: text(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	detail: text(),
	createdAt: text("created_at").notNull(),
},
(table) => {
	return {
		idxActivityTime: index("idx_activity_time").on(table.createdAt),
		idxActivityCustomer: index("idx_activity_customer").on(table.customerId),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const paymentTransfers = sqliteTable("payment_transfers", {
	id: integer().primaryKey({ autoIncrement: true }),
	customerId: text("customer_id").notNull(),
	amount: integer().notNull(),
	transferCode: text("transfer_code"),
	note: text(),
	proofImage: text("proof_image"),
	orderIds: text("order_ids"),
	createdAt: text("created_at").notNull(),
	createdBy: text("created_by"),
	notifyMode: text("notify_mode"),
	notifiedAt: text("notified_at"),
	targetGroup: text("target_group"),
},
(table) => {
	return {
		idxTransferTime: index("idx_transfer_time").on(table.createdAt),
		idxTransferCustomer: index("idx_transfer_customer").on(table.customerId),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const groupInfo = sqliteTable("group_info", {
	groupId: text("group_id").primaryKey(),
	groupName: text("group_name").notNull(),
	totalMembers: integer("total_members").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => {
	return {
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const customerAliases = sqliteTable("customer_aliases", {
	alias: text().primaryKey(),
	customerId: text("customer_id").notNull(),
	createdAt: text("created_at").notNull(),
	note: text(),
},
(table) => {
	return {
		idxAliasesCustomer: index("idx_aliases_customer").on(table.customerId),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const customerCodeCounter = sqliteTable("customer_code_counter", {
	id: integer().primaryKey(),
	last: integer().notNull(),
},
(table) => {
	return {
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const featuredDeals = sqliteTable("featured_deals", {
	id: text().primaryKey(),
	itemId: text("item_id").notNull(),
	name: text().notNull(),
	platform: text().default("Shopee Mall").notNull(),
	category: text().notNull(),
	originalPrice: integer("original_price").notNull(),
	salePrice: integer("sale_price").notNull(),
	commissionRate: real("commission_rate").notNull(),
	cashback: integer().notNull(),
	imageUrl: text("image_url").notNull(),
	url: text().notNull(),
	isActive: integer("is_active").default(1),
	sortOrder: integer("sort_order").default(0),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => {
	return {
		idxDealsCat: index("idx_deals_cat").on(table.category, table.isActive, table.sortOrder),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const campaigns = sqliteTable("campaigns", {
	campaignId: text("campaign_id").primaryKey(),
	name: text().notNull(),
	startsAt: text("starts_at").notNull(),
	endsAt: text("ends_at").notNull(),
	slots: integer().notNull(),
	bonusVnd: integer("bonus_vnd").notNull(),
	minOrderValue: integer("min_order_value").default(0).notNull(),
	platforms: text().default("shopee,shopeefood,tiktok").notNull(),
	excludedCustomers: text("excluded_customers").default("").notNull(),
	perCustomer: integer("per_customer").default(0).notNull(),
	status: text().default("active").notNull(),
	createdAt: text("created_at").notNull(),
},
(table) => {
	return {
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const campaignAwards = sqliteTable("campaign_awards", {
	id: integer().primaryKey({ autoIncrement: true }),
	campaignId: text("campaign_id").notNull().references(() => campaigns.campaignId),
	customerId: text("customer_id").notNull(),
	orderId: text("order_id").notNull(),
	amount: integer().notNull(),
	status: text().notNull(),
	createdAt: text("created_at").notNull(),
	confirmedAt: text("confirmed_at"),
	paidAt: text("paid_at"),
	voidedAt: text("voided_at"),
	notifiedStatus: text("notified_status"),
},
(table) => {
	return {
		idxAwardOrderLookup: index("idx_award_order_lookup").on(table.orderId),
		idxAwardOrder: uniqueIndex("idx_award_order").on(table.campaignId, table.orderId),
		idxAwardCustomerLookup: index("idx_award_customer_lookup").on(table.campaignId, table.customerId),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const linkClicks = sqliteTable("link_clicks", {
	id: integer().primaryKey({ autoIncrement: true }),
	requestId: text("request_id").notNull(),
	clickedAt: text("clicked_at").notNull(),
	agent: text().notNull(),
},
(table) => {
	return {
		idxClicksRequest: index("idx_clicks_request").on(table.requestId),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const fnbVouchers = sqliteTable("fnb_vouchers", {
	id: integer().primaryKey({ autoIncrement: true }),
	brand: text().notNull(),
	title: text().notNull(),
	description: text(),
	voucherType: text("voucher_type").default("counter").notNull(),
	code: text(),
	barcodeUrl: text("barcode_url"),
	affiliateUrl: text("affiliate_url"),
	discountText: text("discount_text"),
	minOrder: integer("min_order").default(0),
	startDate: text("start_date"),
	endDate: text("end_date"),
	isHot: integer("is_hot").default(0),
	isActive: integer("is_active").default(1),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => {
	return {
		idxFnbHot: index("idx_fnb_hot").on(table.isHot, table.isActive),
		idxFnbBrandActive: index("idx_fnb_brand_active").on(table.brand, table.isActive),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const systemKv = sqliteTable("system_kv", {
	key: text().primaryKey(),
	value: text(),
	updatedAt: text("updated_at").notNull(),
},
(table) => {
	return {
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

export const payoutBatches = sqliteTable("payout_batches", {
	batchId: text("batch_id").primaryKey(),
	platform: text().default("shopee").notNull(),
	status: text().notNull(),
	amount: integer().default(0).notNull(),
	eligibleAmount: integer("eligible_amount").default(0).notNull(),
	createdTime: text("created_time"),
	paidTime: text("paid_time"),
	rawJson: text("raw_json"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
},
(table) => {
	return {
		idxBatchesPlatform: index("idx_batches_platform").on(table.platform, table.status),
		customerCodeCounterCheck1: check("customer_code_counter_check_1", sql`id = 1`),
	}
});

