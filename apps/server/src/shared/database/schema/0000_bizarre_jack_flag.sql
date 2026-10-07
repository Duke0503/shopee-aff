-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE `customers` (
	`customer_id` text PRIMARY KEY,
	`zalo_user_id` text,
	`private_chat_id` text,
	`display_name` text,
	`bank_name` text,
	`bank_account` text,
	`account_holder` text,
	`consent_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`password_hash` text,
	`password_set_at` text,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`role` text DEFAULT 'user' NOT NULL,
	`last_login_at` text,
	`login_count` integer DEFAULT 0 NOT NULL,
	`customer_code` text,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customers_code` ON `customers` (`customer_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customers_zalo` ON `customers` (`zalo_user_id`);--> statement-breakpoint
CREATE TABLE `link_requests` (
	`request_id` text PRIMARY KEY,
	`customer_id` text NOT NULL,
	`created_at` text NOT NULL,
	`source_url` text NOT NULL,
	`affiliate_url` text,
	`estimated_commission` integer,
	`channel` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`notified_at` text,
	`estimate_source` text,
	`estimate_detail` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`platform` text DEFAULT 'shopee' NOT NULL,
	`share_code` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`customer_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_req_share_code` ON `link_requests` (`share_code`);--> statement-breakpoint
CREATE INDEX `idx_req_platform` ON `link_requests` (`platform`);--> statement-breakpoint
CREATE INDEX `idx_req_status` ON `link_requests` (`status`);--> statement-breakpoint
CREATE INDEX `idx_req_customer` ON `link_requests` (`customer_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`order_id` text PRIMARY KEY,
	`customer_id` text,
	`request_id` text,
	`order_value` integer,
	`estimated_commission` integer,
	`approved_commission` integer,
	`cashback_amount` integer,
	`status` text NOT NULL,
	`rejection_reason` text,
	`recorded_at` text,
	`approved_at` text,
	`paid_at` text,
	`updated_at` text NOT NULL,
	`notified_status` text,
	`platform` text DEFAULT 'shopee' NOT NULL,
	`settlement_status` text DEFAULT 'unsettled' NOT NULL,
	`payout_batch_id` text,
	`settled_at` text,
	FOREIGN KEY (`request_id`) REFERENCES `link_requests`(`request_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`customer_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_orders_settlement` ON `orders` (`settlement_status`);--> statement-breakpoint
CREATE INDEX `idx_orders_batch` ON `orders` (`payout_batch_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_platform` ON `orders` (`platform`);--> statement-breakpoint
CREATE INDEX `idx_order_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_order_customer` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE TABLE `state_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`order_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`changed_at` text NOT NULL,
	`note` text,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_history_order` ON `state_history` (`order_id`);--> statement-breakpoint
CREATE TABLE `manual_review` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`order_id` text,
	`raw_data` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`ran_at` text NOT NULL,
	`source` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`rows_read` integer DEFAULT 0 NOT NULL,
	`orders_new` integer DEFAULT 0 NOT NULL,
	`approved` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`needs_review` integer DEFAULT 0 NOT NULL,
	`error` text,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY,
	`customer_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_customer` ON `sessions` (`customer_id`);--> statement-breakpoint
CREATE TABLE `products_cache` (
	`item_id` text PRIMARY KEY,
	`shop_id` text,
	`name` text,
	`price` integer,
	`price_formatted` text,
	`shopee_rate` real,
	`seller_rate` real,
	`shopee_part` integer,
	`shopee_part_formatted` text,
	`seller_part` integer,
	`seller_part_formatted` text,
	`total_commission` integer,
	`commission_formatted` text,
	`is_capped` integer DEFAULT 0,
	`cashback` integer,
	`cashback_formatted` text,
	`rate_percent` text,
	`affiliate_url` text,
	`canonical_url` text,
	`request_count` integer DEFAULT 1,
	`first_seen_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`image_url` text,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_products_cache_canonical` ON `products_cache` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `idx_prod_count` ON `products_cache` (`request_count`);--> statement-breakpoint
CREATE INDEX `idx_prod_updated` ON `products_cache` (`updated_at`);--> statement-breakpoint
CREATE TABLE `activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`customer_id` text,
	`action` text NOT NULL,
	`path` text,
	`ip_address` text,
	`user_agent` text,
	`detail` text,
	`created_at` text NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_activity_time` ON `activity_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_activity_customer` ON `activity_logs` (`customer_id`);--> statement-breakpoint
CREATE TABLE `payment_transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`customer_id` text NOT NULL,
	`amount` integer NOT NULL,
	`transfer_code` text,
	`note` text,
	`proof_image` text,
	`order_ids` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`notify_mode` text,
	`notified_at` text,
	`target_group` text,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_transfer_time` ON `payment_transfers` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_transfer_customer` ON `payment_transfers` (`customer_id`);--> statement-breakpoint
CREATE TABLE `group_info` (
	`group_id` text PRIMARY KEY,
	`group_name` text NOT NULL,
	`total_members` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE TABLE `customer_aliases` (
	`alias` text PRIMARY KEY,
	`customer_id` text NOT NULL,
	`created_at` text NOT NULL,
	`note` text,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_aliases_customer` ON `customer_aliases` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_code_counter` (
	`id` integer PRIMARY KEY,
	`last` integer NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE TABLE `featured_deals` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`platform` text DEFAULT 'Shopee Mall' NOT NULL,
	`category` text NOT NULL,
	`original_price` integer NOT NULL,
	`sale_price` integer NOT NULL,
	`commission_rate` real NOT NULL,
	`cashback` integer NOT NULL,
	`image_url` text NOT NULL,
	`url` text NOT NULL,
	`is_active` integer DEFAULT 1,
	`sort_order` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_deals_cat` ON `featured_deals` (`category`,`is_active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`campaign_id` text PRIMARY KEY,
	`name` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`slots` integer NOT NULL,
	`bonus_vnd` integer NOT NULL,
	`min_order_value` integer DEFAULT 0 NOT NULL,
	`platforms` text DEFAULT 'shopee,shopeefood,tiktok' NOT NULL,
	`excluded_customers` text DEFAULT '' NOT NULL,
	`per_customer` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE TABLE `campaign_awards` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`campaign_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`order_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`confirmed_at` text,
	`paid_at` text,
	`voided_at` text,
	`notified_status` text,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`campaign_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_award_order_lookup` ON `campaign_awards` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_award_order` ON `campaign_awards` (`campaign_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `idx_award_customer_lookup` ON `campaign_awards` (`campaign_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `link_clicks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`request_id` text NOT NULL,
	`clicked_at` text NOT NULL,
	`agent` text NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_clicks_request` ON `link_clicks` (`request_id`);--> statement-breakpoint
CREATE TABLE `fnb_vouchers` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`brand` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`voucher_type` text DEFAULT 'counter' NOT NULL,
	`code` text,
	`barcode_url` text,
	`affiliate_url` text,
	`discount_text` text,
	`min_order` integer DEFAULT 0,
	`start_date` text,
	`end_date` text,
	`is_hot` integer DEFAULT 0,
	`is_active` integer DEFAULT 1,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_fnb_hot` ON `fnb_vouchers` (`is_hot`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_fnb_brand_active` ON `fnb_vouchers` (`brand`,`is_active`);--> statement-breakpoint
CREATE TABLE `system_kv` (
	`key` text PRIMARY KEY,
	`value` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE TABLE `payout_batches` (
	`batch_id` text PRIMARY KEY,
	`platform` text DEFAULT 'shopee' NOT NULL,
	`status` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`eligible_amount` integer DEFAULT 0 NOT NULL,
	`created_time` text,
	`paid_time` text,
	`raw_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "customer_code_counter_check_1" CHECK(id = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_batches_platform` ON `payout_batches` (`platform`,`status`);
*/