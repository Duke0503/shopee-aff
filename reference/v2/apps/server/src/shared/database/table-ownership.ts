/**
 * Which module OWNS each table (ADR-04). The owner is the ONLY writer.
 * Until Phase 6, Python still owns parts of some tables (see the writers
 * table in the migration plan); after Phase 6 this mapping is the rule.
 *
 * `system_kv` is owned PER KEY: each key's prefix names the module that may
 * write it (for example "orders.last_reconcile_at").
 */
export type ModuleName = "identity" | "affiliate" | "orders" | "ledger" | "by-key";

export const TABLE_OWNERSHIP = {
  // Identity
  customers: "identity",
  customer_aliases: "identity",
  customer_code_counter: "identity",
  sessions: "identity",
  activity_logs: "identity",
  group_info: "identity",
  // Affiliate
  link_requests: "affiliate",
  products_cache: "affiliate",
  link_clicks: "affiliate",
  featured_deals: "affiliate",
  fnb_vouchers: "affiliate",
  // Orders
  orders: "orders",
  state_history: "orders",
  reconciliation_runs: "orders",
  manual_review: "orders",
  campaigns: "orders",
  campaign_awards: "orders",
  telegram_order_alerts: "orders",
  // Ledger
  payment_transfers: "ledger",
  payout_batches: "ledger",
  // By key prefix
  system_kv: "by-key",
} as const satisfies Record<string, ModuleName>;

export type TableName = keyof typeof TABLE_OWNERSHIP;
