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
  bank_name: string
  bank_account_tail: string
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
