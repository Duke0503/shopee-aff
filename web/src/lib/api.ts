/** The shapes the Python side sends. Kept in step with web/dashboard.py. */

export interface OrderRow {
  order_id: string
  order_value: number | null
  approved_commission: number | null
  cashback_amount: number | null
  approved_at: string | null
  source_url: string | null
  affiliate_url: string | null
  product: string
}

export interface PipelineRow {
  order_id: string
  customer_id: string
  customer_code?: string
  display_name: string | null
  product: string
  order_value: number | null
  estimated_commission: number | null
  cashback: number
  recorded_at: string | null
  affiliate_url: string | null
  source_url: string | null
}

export interface Payable {
  customer_id: string
  customer_code?: string
  display_name: string
  amount: number
  bank_name: string
  bank_account: string
  account_holder: string
  has_bank: boolean
  reference: string
  /** null when the written bank name matched no bank, or more than one. */
  qr_url: string | null
  order_ids: string[]
  orders: OrderRow[]
}

export interface Snapshot {
  generated_at: string
  rate: number
  ready: Payable[]
  no_bank: Payable[]
  pipeline: PipelineRow[]
  totals: {
    owed: number
    owed_customers: number
    ready: number
    no_bank: number
    pipeline: number
    pipeline_orders: number
  }
}

export interface ActionResult {
  ok: boolean
  message: string
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return response.json() as Promise<T>
}

export const fetchSnapshot = () => get<Snapshot>("/api/payouts")
export const fetchLabels = () => get<Record<string, string>>("/api/labels")

async function post<T = ActionResult>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  return response.json() as Promise<T>
}

export const markPaid = (customerId: string, orderIds: string[]) =>
  post(`/api/customers/${customerId}/paid`, { order_ids: orderIds })

export const askForBank = (customerId: string) =>
  post(`/api/customers/${customerId}/ask-bank`)

// ---------------------------------------------------------------------
// The customer's own view
// ---------------------------------------------------------------------

export interface MyOrder {
  order_id: string
  status: "awaiting_approval" | "approved" | "rejected" | "paid"
  platform?: "shopee" | "tiktok" | string
  order_value: number | null
  estimated_commission: number | null
  approved_commission: number | null
  cashback_amount: number | null
  cashback: number
  is_estimate: boolean
  recorded_at: string | null
  approved_at: string | null
  paid_at: string | null
  rejection_reason: string | null
  affiliate_url: string | null
  source_url: string | null
  product: string
}

export interface Me {
  customer_id: string
  customer_code?: string
  display_name: string
  role?: "admin" | "employee" | "user"
  is_admin?: boolean
  is_employee?: boolean
  is_staff?: boolean
  last_login_at?: string | null
  login_count?: number
  bank_name: string
  bank_account_tail: string
  account_holder: string
  has_bank: boolean
  rate: number
  balance: {
    approved: number
    awaiting: number
    paid: number
    approved_orders: number
    awaiting_orders: number
  }
  orders: MyOrder[]
}

/** null rather than a throw: "not signed in" is a state, not an error. */
export async function fetchMe(): Promise<Me | null> {
  const response = await fetch("/api/me")
  if (response.status === 401) return null
  if (!response.ok) throw new Error(`/api/me: ${response.status}`)
  return response.json() as Promise<Me>
}

export const login = (name: string, password: string) =>
  post("/api/auth/login", { name, password })

export const logout = () => post("/api/auth/logout")

export const changePassword = (current: string, replacement: string) =>
  post("/api/auth/password", { current, replacement })

export const updateBank = (bank_name: string, bank_account: string, account_holder: string) =>
  post("/api/me/bank", { bank_name, bank_account, account_holder })

export const eraseBank = () => post("/api/me/bank/erase")

/** Figures the public pages quote. Policy, not wording. */
export interface Site {
  rate: string
  reduced: string
  days: string
}

export const fetchSite = () => get<Site>("/api/site")

// ---------------------------------------------------------------------
// Admin & Employee API
// ---------------------------------------------------------------------

export interface TrendPoint {
  day: string
  orders_count: number
  gmv: number
  commission: number
  fee?: number
  tax?: number
  net_shopee?: number
  cashback: number
  net_profit: number
}

export interface TopCustomer {
  customer_id: string
  customer_code?: string
  display_name: string | null
  zalo_user_id: string | null
  total_orders: number
  total_gmv: number
  total_commission: number
  total_cashback: number
}

export interface TopProduct {
  name: string
  orders_count: number
  total_gmv: number
  total_commission: number
  total_cashback: number
  affiliate_url: string | null
  source_url: string | null
}

export interface ChannelMetric {
  channel_id: string
  name: string
  description: string
  icon: string
  status_badge: string
  unique_users: number
  total_events: number
  converted_users: number
  conversion_rate: number
  orders_count: number
  total_gmv: number
  total_commission: number
}

export interface UserSegment {
  segment_id: string
  name: string
  description: string
  badge: string
  badge_variant: "amber" | "blue" | "emerald" | "slate" | "purple"
  icon: string
  users_count: number
  orders_count: number
  total_gmv: number
  total_commission: number
  conversion_rate: number
  avg_order_value: number
  action_hint: string
}

export interface CommunityFunnel {
  group_id?: string
  group_name?: string
  group_members: number
  total_users: number
  new_group_members: number
  new_users: number
  buyers_count: number
  repeat_buyers_count: number
  single_buyers_count: number
  orders_count: number
  conversion_rate: number
  repeat_rate: number
  avg_orders_per_buyer: number
  segments: UserSegment[]
}

export interface AdminMetrics {
  period: string
  is_admin: boolean
  total_users: number
  total_employees: number
  active_24h: number
  orders: {
    total: number
    awaiting: number
    approved: number
    paid: number
    rejected: number
  }
  kpis: {
    total_gmv: number
    aov: number
    avg_commission: number
    approval_rate: number
    net_margin: number
  }
  cached_products: number
  total_logs: number
  trends: TrendPoint[]
  top_customers: TopCustomer[]
  top_products: TopProduct[]
  channels?: ChannelMetric[]
  community_funnel?: CommunityFunnel
  campaigns?: {
    total_campaigns: number
    total_bonus: number
    bonus_paid: number
    bonus_pending: number
    total_awards: number
  }
  financials: {
    gross_commission: number | null
    shopee_fee?: number | null
    tax_withheld?: number | null
    net_from_shopee?: number | null
    cashback_paid: number | null
    cashback_ready: number | null
    cashback_pipeline: number | null
    campaign_bonus_total?: number | null
    campaign_bonus_paid?: number | null
    campaign_bonus_pending?: number | null
    total_cashback: number | null
    total_cashback_all?: number | null
    total_cashback_committed?: number | null
    net_profit: number | null
    actual_net_profit?: number | null
    estimated_net_profit?: number | null
    estimated_net_margin?: number | null
    realized_net_profit?: number | null
    realized_net_margin?: number | null
    real_net_margin?: number | null
    paper_profit?: number | null
    paper_margin?: number | null
  } | null
}

export interface AdminUser {
  customer_id: string
  customer_code?: string
  display_name: string | null
  zalo_user_id: string | null
  bank_name: string | null
  bank_account: string | null
  account_holder: string | null
  created_at: string
  last_login_at: string | null
  login_count: number
  status: string
  order_count: number
  paid_amount: number
  ready_amount: number
  total_cashback: number
  awaiting_amount: number
  last_bot_activity: string | null
  recent_requests?: {
    name: string
    created_at: string
    affiliate_url?: string
  }[]
}

export interface UserTransfer {
  id: number
  customer_id: string
  customer_code?: string
  amount: number
  transfer_code: string | null
  note: string | null
  proof_image: string | null
  created_at: string
  created_by: string | null
}

export interface UserDetailData {
  user: AdminUser & { password_hash?: string }
  orders: AdminOrder[]
  link_requests: {
    request_id: string
    source_url: string
    affiliate_url: string | null
    created_at: string
    name: string | null
    platform?: "shopee" | "tiktok" | string
  }[]
  transfers: UserTransfer[]
  stats: {
    total_cashback: number
    paid_amount: number
    ready_amount: number
    awaiting_amount: number
    total_orders: number
    total_requests: number
    total_transferred?: number
    total_admin_profit?: number
  }
}

export interface AdminEmployee {
  customer_id: string
  customer_code?: string
  display_name: string | null
  role: "admin" | "employee"
  status: "active" | "disabled"
  created_at: string
  last_login_at: string | null
  login_count: number
}

export interface OrderFinancialBreakdown {
  gross_commission: number
  shopee_rate?: number
  seller_rate?: number
  shopee_part: number
  seller_part: number
  service_fee: number
  tax_amount: number
  net_shopee: number
  cashback_amount: number
  admin_profit: number
  admin_margin: number
}

export interface AdminOrder {
  order_id: string
  customer_id: string
  customer_code?: string
  customer_name: string | null
  status: "awaiting_approval" | "approved" | "rejected" | "paid"
  order_value: number | null
  estimated_commission: number | null
  approved_commission: number | null
  cashback_amount: number | null
  recorded_at: string | null
  approved_at: string | null
  paid_at: string | null
  rejection_reason: string | null
  source_url: string | null
  affiliate_url: string | null
  product: string
  platform?: "shopee" | "tiktok" | string
  settlement_status?: "settled" | "processing" | "unsettled" | string
  payout_batch_id?: string | null
  settled_at?: string | null
  item_id?: string | null
  image_url?: string | null
  financial_breakdown?: OrderFinancialBreakdown
}

export interface ProductRequester {
  customer_id: string
  customer_code?: string
  display_name: string | null
  zalo_user_id: string | null
  bank_name: string | null
  bank_account: string | null
  account_holder: string | null
  last_requested_at: string
  request_count: number
}

export interface ProductBuyer {
  order_id: string
  customer_id: string
  customer_code?: string
  display_name: string | null
  zalo_user_id: string | null
  bank_name: string | null
  bank_account: string | null
  account_holder: string | null
  order_value: number | null
  approved_commission: number | null
  estimated_commission: number | null
  cashback_amount: number | null
  status: string
  order_date: string | null
}

export interface AdminProduct {
  item_id: string
  shop_id?: string | null
  name: string
  price: number
  price_formatted: string
  shopee_rate?: number | null
  seller_rate?: number | null
  shopee_part?: number | null
  shopee_part_formatted?: string | null
  seller_part?: number | null
  seller_part_formatted?: string | null
  total_commission: number
  commission_formatted: string
  cashback: number
  cashback_formatted: string
  rate_percent: string
  affiliate_url: string
  canonical_url: string
  image_url?: string | null
  request_count: number
  updated_at: string
  last_requested_at?: string | null
  requesters?: ProductRequester[]
  buyers?: ProductBuyer[]
  order_count?: number
  total_bought_gmv?: number
}

export interface AdminLog {
  log_id: number
  customer_id: string
  customer_code?: string
  display_name: string | null
  action: string
  path: string | null
  detail: string | null
  created_at: string
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  total_pages: number
}

export const fetchAdminMetrics = (period: string = "all") =>
  get<{ ok: boolean; metrics: AdminMetrics }>(`/api/admin/metrics?period=${period}`)

export const fetchAdminUsers = (params?: {
  page?: number
  limit?: number
  search?: string
  bank?: string
  sort_by?: string
  sort_order?: "asc" | "desc"
}) => {
  const qs = new URLSearchParams()
  if (params?.page) qs.set("page", String(params.page))
  if (params?.limit) qs.set("limit", String(params.limit))
  if (params?.search) qs.set("search", params.search)
  if (params?.bank && params.bank !== "all") qs.set("bank", params.bank)
  if (params?.sort_by) qs.set("sort_by", params.sort_by)
  if (params?.sort_order) qs.set("sort_order", params.sort_order)
  const q = qs.toString() ? `?${qs.toString()}` : ""
  return get<{ ok: boolean; users: AdminUser[]; pagination?: PaginationMeta }>(`/api/admin/users${q}`)
}

export const fetchAdminEmployees = (params?: {
  page?: number
  limit?: number
  search?: string
  role?: string
  sort_by?: string
  sort_order?: "asc" | "desc"
}) => {
  const qs = new URLSearchParams()
  if (params?.page) qs.set("page", String(params.page))
  if (params?.limit) qs.set("limit", String(params.limit))
  if (params?.search) qs.set("search", params.search)
  if (params?.role && params.role !== "all") qs.set("role", params.role)
  if (params?.sort_by) qs.set("sort_by", params.sort_by)
  if (params?.sort_order) qs.set("sort_order", params.sort_order)
  const q = qs.toString() ? `?${qs.toString()}` : ""
  return get<{ ok: boolean; employees: AdminEmployee[]; pagination?: PaginationMeta }>(`/api/admin/employees${q}`)
}

export const createAdminEmployee = (data: { username: string; password: string; display_name: string; role: "admin" | "employee" }) =>
  post("/api/admin/employees", data)
export const updateAdminEmployee = (data: { customer_id: string; role?: string; status?: string; new_password?: string }) =>
  post("/api/admin/employees/update", data)

export const fetchAdminOrders = (params?: {
  page?: number
  limit?: number
  search?: string
  status?: string
  settlement_status?: string
  customer_id?: string
  platform?: string
  sort_by?: string
  sort_order?: "asc" | "desc"
  from_date?: string
  to_date?: string
}) => {
  const qs = new URLSearchParams()
  if (params?.page) qs.set("page", String(params.page))
  if (params?.limit) qs.set("limit", String(params.limit))
  if (params?.search) qs.set("search", params.search)
  if (params?.status && params.status !== "all") qs.set("status", params.status)
  if (params?.settlement_status && params.settlement_status !== "all") qs.set("settlement_status", params.settlement_status)
  if (params?.platform && params.platform !== "all") qs.set("platform", params.platform)
  if (params?.customer_id) qs.set("customer_id", params.customer_id)
  if (params?.sort_by) qs.set("sort_by", params.sort_by)
  if (params?.sort_order) qs.set("sort_order", params.sort_order)
  if (params?.from_date) qs.set("from_date", params.from_date)
  if (params?.to_date) qs.set("to_date", params.to_date)
  const q = qs.toString() ? `?${qs.toString()}` : ""
  return get<{ ok: boolean; orders: AdminOrder[]; pagination?: PaginationMeta }>(`/api/admin/orders${q}`)
}

export const markAdminOrderPaid = (customer_id: string, order_ids: string[]) =>
  post("/api/admin/orders/mark-paid", { customer_id, order_ids })

export const fetchAdminProducts = (params?: {
  page?: number
  limit?: number
  search?: string
  sort_by?: string
  sort_order?: "asc" | "desc"
}) => {
  const qs = new URLSearchParams()
  if (params?.page) qs.set("page", String(params.page))
  if (params?.limit) qs.set("limit", String(params.limit))
  if (params?.search) qs.set("search", params.search)
  if (params?.sort_by) qs.set("sort_by", params.sort_by)
  if (params?.sort_order) qs.set("sort_order", params.sort_order)
  const q = qs.toString() ? `?${qs.toString()}` : ""
  return get<{ ok: boolean; products: AdminProduct[]; pagination?: PaginationMeta }>(`/api/admin/products${q}`)
}

export const fetchAdminLogs = (params?: {
  page?: number
  limit?: number
  search?: string
  action?: string
  sort_by?: string
  sort_order?: "asc" | "desc"
}) => {
  const qs = new URLSearchParams()
  if (params?.page) qs.set("page", String(params.page))
  if (params?.limit) qs.set("limit", String(params.limit))
  if (params?.search) qs.set("search", params.search)
  if (params?.action && params.action !== "all") qs.set("action", params.action)
  if (params?.sort_by) qs.set("sort_by", params.sort_by)
  if (params?.sort_order) qs.set("sort_order", params.sort_order)
  const q = qs.toString() ? `?${qs.toString()}` : ""
  return get<{ ok: boolean; logs: AdminLog[]; pagination?: PaginationMeta }>(`/api/admin/logs${q}`)
}

export const adminLogin = (username: string, password: string) =>
  post("/api/admin/login", { username, password })
export const adminLogout = () => post("/api/admin/logout")

export const fetchAdminUserDetail = (customerId: string) =>
  get<{ ok: boolean } & UserDetailData>(`/api/admin/users/${encodeURIComponent(customerId)}`)

export const recordAdminTransfer = (data: {
  customer_id: string
  customer_code?: string
  amount: number
  transfer_code?: string
  note?: string
  proof_image?: string
}) => post("/api/admin/transfers", data)

export interface AdminPaymentSummary {
  total_payable: number
  total_unsettled?: number
  total_awaiting: number
  total_bonus?: number
  settled_bonus?: number
  pending_bonus?: number
  ready_users: number
  needs_bank_users: number
  total_transferred: number
  total_transfers_count: number
}

export interface AdminBankInfo {
  name?: string
  shortName?: string
  bin?: string
  logo?: string
  code?: string
}

export interface AdminPaymentOrder {
  order_id: string
  order_value: number | null
  cashback_amount: number | null
  campaign_bonus?: number
  campaign_name?: string | null
  campaign_id?: string | null
  award_status?: string | null
  status: string
  settlement_status?: "settled" | "processing" | "unsettled" | string
  payout_batch_id?: string | null
  settled_at?: string | null
  recorded_at: string | null
  approved_at: string | null
  platform: string
  product: string
}

export interface AdminPaymentUser {
  customer_id: string
  display_name: string
  customer_code: string
  zalo_user_id: string
  bank_name: string
  bank_account: string
  account_holder: string
  bank_status: "valid" | "missing" | "invalid_bank" | "unsupported"
  bank_info: AdminBankInfo | null
  payable_amount: number
  awaiting_amount: number
  bonus: number
  total_bonus?: number
  settled_bonus?: number
  total_unpaid: number
  settled_payable_amount?: number
  unsettled_payable_amount?: number
  is_fully_settled?: boolean
  order_count: number
  order_ids: string[]
  orders: AdminPaymentOrder[]
  qr_url: string | null
  reference: string
  payout_status: "ready" | "needs_bank" | "awaiting_settlement" | "awaiting" | "settled"
  last_transfer: {
    id: number
    amount: number
    transfer_code: string | null
    note: string | null
    notify_mode: string | null
    notified_at: string | null
    target_group: string | null
    created_at: string
  } | null
}

export interface AdminPaymentTransfer {
  id: number
  customer_id: string
  customer_code: string | null
  display_name: string | null
  bank_name: string | null
  bank_account: string | null
  amount: number
  transfer_code: string | null
  note: string | null
  proof_image: string | null
  proof_image_direct?: string | null
  order_ids: string | null
  notify_mode: "dm" | "group" | "both" | "none" | null
  notified_at: string | null
  target_group: "test" | "main" | null
  created_at: string
  created_by: string | null
}

export interface AdminPaymentsResponse {
  ok: boolean
  summary: AdminPaymentSummary
  payables: AdminPaymentUser[]
  transfers: AdminPaymentTransfer[]
  gdrive_active?: boolean
  gdrive_webhook_url?: string
}

export const fetchAdminPayments = () => get<AdminPaymentsResponse>("/api/admin/payments")

export const confirmAdminPayment = (data: {
  customer_id: string
  amount: number
  order_ids?: string[]
  transfer_code?: string
  reference?: string
  note?: string
  proof_image?: string
  notify_mode?: "dm" | "group" | "both" | "none"
  target_group?: "test" | "main"
  include_awaiting?: boolean
}) => post("/api/admin/payments/confirm", data)

export const askCustomerBank = (data: {
  customer_id: string
  custom_note?: string
}) => post("/api/admin/payments/ask-bank", data)

export const uploadPaymentProof = (data: {
  data?: string
  gdrive_url?: string
}) => post<{ ok: boolean; url: string; direct_url?: string; message: string }>("/api/admin/payments/upload-proof", data)

export function getDirectImageUrl(url?: string | null): string {
  if (!url) return ""
  const m = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
            url.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([a-zA-Z0-9_-]+)/) ||
            url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/) ||
            url.match(/thumbnail\?(?:.*&)?id=([a-zA-Z0-9_-]+)/)
  if (m) {
    return `https://lh3.googleusercontent.com/d/${m[1]}`
  }
  return url
}

export const saveGDriveConfig = (webhookUrl: string) =>
  post<{ ok: boolean; message: string }>("/api/admin/payments/gdrive-config", {
    gdrive_webhook_url: webhookUrl,
  })

export interface PayoutBatch {
  batch_id: string
  platform: string
  status: "paid" | "processing" | "failed" | string
  amount: number
  eligible_amount: number
  created_time: string | null
  paid_time: string | null
  linked_orders_count: number
  created_at: string
  updated_at: string
}

export const fetchAdminPayoutBatches = () =>
  get<{ ok: boolean; batches: PayoutBatch[] }>("/api/admin/payout-batches")

export const syncAdminShopeePayouts = () =>
  post<{ ok: boolean; message: string; batches_count: number; orders_settled: number }>("/api/admin/shopee/sync-payouts")

export const settleAdminOrders = (data: { batch_id?: string; platform?: string; order_ids?: string[] }) =>
  post<{ ok: boolean; settled_count: number }>("/api/admin/orders/settle", data)

export interface CampaignAward {
  id: number
  campaign_id: string
  customer_id: string
  order_id: string
  amount: number
  status: "held" | "confirmed" | "paid" | "void" | string
  created_at: string
  confirmed_at: string | null
  paid_at: string | null
  notified_status: string | null
  order_value: number | null
  order_status: string
  recorded_at: string | null
  platform: string
  display_name: string | null
  customer_code: string | null
  zalo_user_id: string | null
}

export interface AdminCampaign {
  campaign_id: string
  name: string
  starts_at: string
  ends_at: string
  slots: number
  bonus_vnd: number
  min_order_value: number
  platforms: string
  excluded_customers?: string
  per_customer?: number
  awards: CampaignAward[]
  slots_used: number
  total_bonus_awarded: number
  total_bonus_paid: number
}

export interface AdminCampaignsSummary {
  total_campaigns: number
  total_bonus_awarded: number
  total_bonus_paid: number
  total_slots_used: number
}

export interface AdminCampaignsResponse {
  ok: boolean
  campaigns: AdminCampaign[]
  summary: AdminCampaignsSummary
}

export const fetchAdminCampaigns = () => get<AdminCampaignsResponse>("/api/admin/campaigns")

export const createAdminCampaign = (data: {
  campaign_id: string
  name: string
  starts_at: string
  ends_at: string
  slots: number
  bonus_vnd: number
  min_order_value?: number
  platforms?: string
  per_customer?: number
}) => post<{ ok: boolean; message: string; campaign_id?: string }>("/api/admin/campaigns", data)
