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

async function post(path: string, body?: unknown): Promise<ActionResult> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  return response.json() as Promise<ActionResult>
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
  financials: {
    gross_commission: number | null
    shopee_fee?: number | null
    tax_withheld?: number | null
    net_from_shopee?: number | null
    cashback_paid: number | null
    cashback_ready: number | null
    cashback_pipeline: number | null
    total_cashback: number | null
    net_profit: number | null
    actual_net_profit?: number | null
    real_net_margin?: number | null
    paper_profit?: number | null
    paper_margin?: number | null
  } | null
}

export interface AdminUser {
  customer_id: string
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
  display_name: string | null
  role: "admin" | "employee"
  status: "active" | "disabled"
  created_at: string
  last_login_at: string | null
  login_count: number
}

export interface OrderFinancialBreakdown {
  gross_commission: number
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
  financial_breakdown?: OrderFinancialBreakdown
}

export interface ProductRequester {
  customer_id: string
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
  name: string
  price: number
  price_formatted: string
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
  requesters?: ProductRequester[]
  buyers?: ProductBuyer[]
  order_count?: number
  total_bought_gmv?: number
}

export interface AdminLog {
  log_id: number
  customer_id: string
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
  customer_id?: string
  sort_by?: string
  sort_order?: "asc" | "desc"
}) => {
  const qs = new URLSearchParams()
  if (params?.page) qs.set("page", String(params.page))
  if (params?.limit) qs.set("limit", String(params.limit))
  if (params?.search) qs.set("search", params.search)
  if (params?.status && params.status !== "all") qs.set("status", params.status)
  if (params?.customer_id) qs.set("customer_id", params.customer_id)
  if (params?.sort_by) qs.set("sort_by", params.sort_by)
  if (params?.sort_order) qs.set("sort_order", params.sort_order)
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
  amount: number
  transfer_code?: string
  note?: string
  proof_image?: string
}) => post("/api/admin/transfers", data)

