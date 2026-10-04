import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  fetchAdminPayments,
  confirmAdminPayment,
  askCustomerBank,
  uploadPaymentProof,
  saveGDriveConfig,
  syncAdminShopeePayouts,
  type AdminPaymentUser,
} from "@/lib/api"
import { vnd, shortDate } from "@/lib/format"
import { CodeBadge } from "@/features/Admin/components/CodeBadge"
import {
  CreditCard,
  QrCode,
  Search,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Bell,
  Send,
  Clock,
  Building,
  User,
  Users2,
  VolumeX,
  History,
  Coins,
  ShieldCheck,
  Upload,
  Image as ImageIcon,
  X,
  Link,
  Cloud,
} from "lucide-react"

export function PaymentsView() {
  const queryClient = useQueryClient()

  // State
  const [activeSubTab, setActiveSubTab] = React.useState<"queue" | "history">("queue")
  const [searchTerm, setSearchTerm] = React.useState("")
  const [filterBank, setFilterBank] = React.useState<"all" | "ready" | "needs_bank">("all")
  const [filterSettlement, setFilterSettlement] = React.useState<"all" | "settled" | "unsettled">("all")
  const [includeAwaiting, setIncludeAwaiting] = React.useState(true)
  const [selectedUser, setSelectedUser] = React.useState<AdminPaymentUser | null>(null)
  const [gdriveModalOpen, setGDriveModalOpen] = React.useState(false)
  const [toastMessage, setToastMessage] = React.useState<{ text: string; type: "success" | "error" | "info" } | null>(null)

  // Copy helper
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)
  const copyToClipboard = (key: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  // Toast auto-dismiss
  React.useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4500)
      return () => clearTimeout(timer)
    }
  }, [toastMessage])

  // Query
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-payments"],
    queryFn: fetchAdminPayments,
    refetchInterval: 30_000,
  })

  // Ask bank mutation
  const askBankMutation = useMutation({
    mutationFn: (customerId: string) => askCustomerBank({ customer_id: customerId }),
    onSuccess: (res) => {
      setToastMessage({
        text: res.message || `Đã gửi tin nhắn nhắc cung cấp STK tới khách hàng qua Zalo!`,
        type: "success",
      })
      queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
    },
    onError: (err: any) => {
      setToastMessage({
        text: err.message || "Lỗi khi gửi tin nhắn qua bot",
        type: "error",
      })
    },
  })

  // Sync Shopee payouts mutation
  const syncShopeeMutation = useMutation({
    mutationFn: syncAdminShopeePayouts,
    onSuccess: (res) => {
      setToastMessage({
        text: res.message || `Đồng bộ hoàn tất: ${res.batches_count || 0} đợt thanh toán, ${res.orders_settled || 0} đơn đã quyết toán!`,
        type: "success",
      })
      queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] })
    },
    onError: (err: any) => {
      setToastMessage({
        text: err.message || "Lỗi đồng bộ quyết toán Shopee",
        type: "error",
      })
    },
  })

  // Filter queue
  const payables = data?.payables || []
  const transfers = data?.transfers || []
  const summary = data?.summary || {
    total_payable: 0,
    total_awaiting: 0,
    ready_users: 0,
    needs_bank_users: 0,
    total_transferred: 0,
    total_transfers_count: 0,
  }


  const filteredPayables = React.useMemo(() => {
    return payables.filter((user) => {
      // Amount check: if not includeAwaiting, user must have payable_amount > 0
      if (!includeAwaiting && user.payable_amount <= 0) {
        return false
      }
      // If includeAwaiting, user must have at least some unpaid money
      if (includeAwaiting && user.total_unpaid <= 0) {
        return false
      }

      // Bank filter
      if (filterBank === "ready" && user.bank_status !== "valid") return false
      if (filterBank === "needs_bank" && user.bank_status === "valid") return false

      // Settlement filter
      if (filterSettlement === "settled" && !user.is_fully_settled) return false
      if (filterSettlement === "unsettled" && user.is_fully_settled) return false

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim()
        const matchName = user.display_name?.toLowerCase().includes(q)
        const matchCode = user.customer_code?.toLowerCase().includes(q)
        const matchId = user.customer_id?.toLowerCase().includes(q)
        const matchBankAcc = user.bank_account?.toLowerCase().includes(q)
        const matchBankName = user.bank_name?.toLowerCase().includes(q)
        if (!matchName && !matchCode && !matchId && !matchBankAcc && !matchBankName) {
          return false
        }
      }

      return true
    })
  }, [payables, filterBank, filterSettlement, includeAwaiting, searchTerm])

  const filteredTransfers = React.useMemo(() => {
    if (!searchTerm.trim()) return transfers
    const q = searchTerm.toLowerCase().trim()
    return transfers.filter((t) => {
      const matchName = t.display_name?.toLowerCase().includes(q)
      const matchCode = t.customer_code?.toLowerCase().includes(q)
      const matchId = t.customer_id?.toLowerCase().includes(q)
      const matchBank = t.bank_account?.toLowerCase().includes(q) || t.bank_name?.toLowerCase().includes(q)
      const matchTx = t.transfer_code?.toLowerCase().includes(q) || t.note?.toLowerCase().includes(q)
      return matchName || matchCode || matchId || matchBank || matchTx
    })
  }, [transfers, searchTerm])

  return (
    <div className="flex flex-1 flex-col min-h-0 space-y-4">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl px-4 py-3 shadow-lg border backdrop-blur-md animate-in fade-in slide-in-from-top-2 ${
            toastMessage.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : toastMessage.type === "error"
              ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
              : "bg-blue-500/10 border-blue-500/30 text-blue-400"
          }`}
        >
          {toastMessage.type === "success" && <CheckCircle2 className="h-5 w-5 shrink-0" />}
          {toastMessage.type === "error" && <AlertTriangle className="h-5 w-5 shrink-0" />}
          {toastMessage.type === "info" && <Bell className="h-5 w-5 shrink-0" />}
          <span className="text-xs font-medium">{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 rounded-full p-1 hover:bg-white/10 text-muted-foreground"
          >
            ×
          </button>
        </div>
      )}

      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4 shrink-0">
        {/* Card 1: Payable (Approved & Settled) */}
        <Card className="relative overflow-hidden border-border/70 bg-gradient-to-br from-card to-card/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Sẵn Sàng Chi Trả (Sàn Đã Chốt)</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Coins className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-emerald-500 sm:text-2xl">
            {vnd(summary.total_payable)}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>{summary.ready_users} khách đủ ĐK</span>
            </div>
            <span className="text-emerald-500 font-semibold" title="Shopee đã thanh toán về ngân hàng">
              🛡️ An toàn giải ngân
            </span>
          </div>
        </Card>

        {/* Card 2: Unsettled (Approved by customer but waiting for Shopee payout) */}
        <Card className="relative overflow-hidden border-border/70 bg-gradient-to-br from-card to-card/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Chờ Sàn Quyết Toán (Đã Duyệt)</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-amber-500 sm:text-2xl">
            {vnd(summary.total_unsettled || 0)}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span>Chờ Shopee chốt kỳ</span>
            </div>
            <span className="text-muted-foreground" title="Đơn khách mới đặt hoặc đang giao hàng">
              Tạm tính: {vnd(summary.total_awaiting)}
            </span>
          </div>
        </Card>

        {/* Card 3: Needs Bank Details */}
        <Card className="relative overflow-hidden border-border/70 bg-gradient-to-br from-card to-card/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Thiếu / Lỗi Số Tài Khoản</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-amber-500 sm:text-2xl">
            {summary.needs_bank_users}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>Cần gửi tin nhắn nhắc khách gửi STK</span>
          </div>
        </Card>

        {/* Card 4: Historical Transferred */}
        <Card className="relative overflow-hidden border-border/70 bg-gradient-to-br from-card to-card/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Tổng Đã Chi Trả</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <History className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {vnd(summary.total_transferred)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            <span>{summary.total_transfers_count} lượt chuyển khoản thành công</span>
          </div>
        </Card>
      </div>

      {/* Main Container */}
      <Card className="flex flex-1 flex-col min-h-0 overflow-hidden border-border/70 bg-card/80 backdrop-blur-sm">
        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-3 sm:px-4 shrink-0">
          {/* Sub-tabs: Queue vs History */}
          <div className="flex items-center gap-1 rounded-lg bg-secondary/80 p-1">
            <button
              onClick={() => setActiveSubTab("queue")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                activeSubTab === "queue"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CreditCard className="h-3.5 w-3.5" />
              <span>Chờ Chi Trả</span>
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px] bg-primary/10 text-primary">
                {payables.length}
              </Badge>
            </button>
            <button
              onClick={() => setActiveSubTab("history")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                activeSubTab === "history"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>Lịch Sử Giao Dịch</span>
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                {transfers.length}
              </Badge>
            </button>
          </div>

          {/* Right Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative w-48 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Tìm mã KH, tên, STK..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 pl-8 text-xs bg-card/50"
              />
            </div>

            {/* Filter by bank status (only for queue) */}
            {activeSubTab === "queue" && (
              <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/40 p-0.5 text-xs">
                <button
                  onClick={() => setFilterBank("all")}
                  className={`rounded px-2 py-1 text-[11px] transition-colors ${
                    filterBank === "all" ? "bg-card font-semibold text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Tất cả TK
                </button>
                <button
                  onClick={() => setFilterBank("ready")}
                  className={`rounded px-2 py-1 text-[11px] transition-colors ${
                    filterBank === "ready" ? "bg-card font-semibold text-emerald-500 shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Sẵn sàng VietQR
                </button>
                <button
                  onClick={() => setFilterBank("needs_bank")}
                  className={`rounded px-2 py-1 text-[11px] transition-colors ${
                    filterBank === "needs_bank" ? "bg-card font-semibold text-amber-500 shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  ⚠️ Thiếu/Lỗi STK
                </button>
              </div>
            )}

            {/* Filter by settlement status (Safe Cashflow) */}
            {activeSubTab === "queue" && (
              <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/40 p-0.5 text-xs">
                <button
                  onClick={() => setFilterSettlement("all")}
                  className={`rounded px-2 py-1 text-[11px] transition-colors ${
                    filterSettlement === "all" ? "bg-card font-semibold text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Tất cả sàn
                </button>
                <button
                  onClick={() => setFilterSettlement("settled")}
                  className={`rounded px-2 py-1 text-[11px] transition-colors flex items-center gap-1 ${
                    filterSettlement === "settled" ? "bg-card font-semibold text-emerald-500 shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Các khách hàng mà Shopee đã chuyển tiền về ngân hàng của bạn"
                >
                  <ShieldCheck className="h-3 w-3 text-emerald-500" />
                  <span>Sàn đã trả (An toàn bank)</span>
                </button>
                <button
                  onClick={() => setFilterSettlement("unsettled")}
                  className={`rounded px-2 py-1 text-[11px] transition-colors flex items-center gap-1 ${
                    filterSettlement === "unsettled" ? "bg-card font-semibold text-amber-500 shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Khách hàng có đơn mà Shopee chưa thanh toán về ngân hàng"
                >
                  <Clock className="h-3 w-3 text-amber-500" />
                  <span>Chờ sàn trả</span>
                </button>
              </div>
            )}

            {/* Include awaiting toggle (only for queue) */}
            {activeSubTab === "queue" && (
              <label className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1 text-[11px] text-muted-foreground cursor-pointer select-none hover:text-foreground">
                <input
                  type="checkbox"
                  checked={includeAwaiting}
                  onChange={(e) => setIncludeAwaiting(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
                />
                <span>Hiện cả đơn chờ duyệt (Test)</span>
              </label>
            )}

            {/* Sync Shopee Payouts */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncShopeeMutation.mutate()}
              disabled={syncShopeeMutation.isPending}
              className="h-8 gap-1.5 px-2.5 text-xs border-orange-500/40 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10"
              title="Đồng bộ lịch sử giải ngân & quyết toán tiền từ Shopee Affiliate"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncShopeeMutation.isPending ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">
                {syncShopeeMutation.isPending ? "Đang đồng bộ..." : "Đồng bộ Shopee"}
              </span>
            </Button>

            {/* Google Drive Config */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGDriveModalOpen(true)}
              className={`h-8 gap-1.5 px-2.5 text-xs transition-colors ${
                data?.gdrive_active
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
              }`}
              title="Cấu hình Google Drive lưu ảnh biên lai tự động"
            >
              <Cloud className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Google Drive</span>
              {data?.gdrive_active ? (
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              ) : (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-amber-500/40 text-amber-400">
                  Cài đặt
                </Badge>
              )}
            </Button>

            {/* Refresh */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8 gap-1.5 px-2.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Làm mới</span>
            </Button>
          </div>
        </div>

        {/* Content: Queue Table */}
        {activeSubTab === "queue" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {isLoading ? (
              <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin text-primary" /> Đang tải danh sách chi trả...
              </div>
            ) : filteredPayables.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/70 text-muted-foreground">
                  <CreditCard className="h-6 w-6 opacity-60" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-foreground">Không có yêu cầu chi trả nào</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                  {searchTerm
                    ? "Không tìm thấy khách hàng nào khớp với từ khoá tìm kiếm."
                    : "Tất cả khách hàng đã được thanh toán hoặc không có đơn hàng đủ điều kiện."}
                </p>
              </div>
            ) : (
              <>
                {/* Mobile View: Cards (md:hidden) */}
                <div className="md:hidden divide-y divide-border/60">
                  {filteredPayables.map((user) => {
                    const isBankValid = user.bank_status === "valid"
                    const hasPayable = user.payable_amount > 0
                    const targetAmount = hasPayable
                      ? user.payable_amount
                      : ((user.unsettled_payable_amount ?? 0) > 0 ? (user.unsettled_payable_amount ?? 0) : user.awaiting_amount)

                    return (
                      <div key={user.customer_id} className="p-3.5 space-y-3 hover:bg-secondary/10 transition-colors">
                        {/* Top: Customer & Target Amount */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {user.customer_code ? (
                                <CodeBadge code={user.customer_code} />
                              ) : (
                                <Badge variant="outline" className="text-[10px]">
                                  DP???
                                </Badge>
                              )}
                              <span className="font-semibold text-xs text-foreground truncate max-w-[150px]">
                                {user.display_name || "Khách hàng"}
                              </span>
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              UID: {user.zalo_user_id || user.customer_id}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-emerald-500">
                              {vnd(targetAmount)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {user.order_count} đơn hàng
                            </div>
                          </div>
                        </div>

                        {/* Middle: Bank details & Settlement Badge */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-secondary/30 rounded-lg p-2.5">
                          {isBankValid ? (
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] font-semibold">
                                  {user.bank_info?.shortName || user.bank_name}
                                </Badge>
                                <span className="font-mono font-medium text-xs text-foreground">
                                  {user.bank_account}
                                </span>
                                <button
                                  onClick={() => copyToClipboard(`stk-${user.customer_id}`, user.bank_account)}
                                  className="text-muted-foreground hover:text-foreground"
                                  title="Copy STK"
                                >
                                  {copiedKey === `stk-${user.customer_id}` ? (
                                    <Check className="h-3 w-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                              <div className="text-[10px] text-muted-foreground uppercase">
                                {user.account_holder || "—"}
                              </div>
                            </div>
                          ) : user.bank_status === "missing" ? (
                            <div className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-500">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span>Chưa có STK nhận tiền</span>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-500">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span>Ngân hàng không khớp</span>
                            </div>
                          )}

                          <div>
                            {user.is_fully_settled ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-medium flex items-center gap-0.5">
                                <ShieldCheck className="h-2.5 w-2.5 text-emerald-400" />
                                <span>Sàn đã chốt 100%</span>
                              </Badge>
                            ) : (user.unsettled_payable_amount ?? 0) > 0 ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 bg-amber-500/10 text-amber-400 font-medium flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5 text-amber-400" />
                                <span>Chờ sàn chốt ({vnd(user.unsettled_payable_amount || 0)})</span>
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/40 bg-blue-500/10 text-blue-400 font-medium flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5 text-blue-400" />
                                <span>Tạm tính</span>
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Bottom Action: Big touch-friendly button */}
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            variant={isBankValid ? "default" : "outline"}
                            className={`flex-1 h-9 gap-1.5 text-xs font-semibold ${
                              isBankValid
                                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
                                : "border-border/60 hover:bg-secondary"
                            }`}
                            onClick={() => setSelectedUser(user)}
                          >
                            <QrCode className="h-4 w-4" />
                            <span>{isBankValid ? "Quét VietQR & Trả Tiền" : "Xem Đơn & Chi Trả"}</span>
                          </Button>

                          {!isBankValid && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 px-3 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                              onClick={() => askBankMutation.mutate(user.customer_id)}
                              disabled={askBankMutation.isPending}
                              title="Gửi tin nhắn riêng qua Zalo nhắc khách cung cấp STK"
                            >
                              <Bell className="h-3.5 w-3.5 mr-1" />
                              <span>Nhắc STK</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Desktop View: Full Table (hidden md:block) */}
                <div className="hidden md:block">
                  <Table>
                <TableHeader className="bg-secondary/40 sticky top-0 z-10 backdrop-blur-md">
                  <TableRow className="border-border/60">
                    <TableHead className="w-56 text-xs font-semibold">Khách Hàng</TableHead>
                    <TableHead className="text-xs font-semibold">Tài Khoản Nhận Tiền</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Số Tiền Cần Chi</TableHead>
                    <TableHead className="text-xs font-semibold">Trạng Thái & Lịch Sử</TableHead>
                    <TableHead className="w-52 text-xs font-semibold text-right">Thao Tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayables.map((user) => {
                    const isBankValid = user.bank_status === "valid"
                    const hasPayable = user.payable_amount > 0
                    const targetAmount = hasPayable ? user.payable_amount : user.awaiting_amount

                    return (
                      <TableRow key={user.customer_id} className="border-border/50 hover:bg-secondary/20">
                        {/* Column 1: Customer */}
                        <TableCell className="align-top py-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              {user.customer_code ? (
                                <CodeBadge code={user.customer_code} />
                              ) : (
                                <Badge variant="outline" className="text-[10px]">
                                  DP???
                                </Badge>
                              )}
                              <span className="font-semibold text-xs text-foreground truncate max-w-[130px]">
                                {user.display_name || "Khách hàng"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <span className="font-mono text-[10px] text-muted-foreground/80">
                                UID: {user.zalo_user_id || user.customer_id}
                              </span>
                              <button
                                onClick={() => copyToClipboard(`uid-${user.customer_id}`, user.zalo_user_id || user.customer_id)}
                                className="text-muted-foreground hover:text-foreground"
                                title="Copy UID"
                              >
                                {copiedKey === `uid-${user.customer_id}` ? (
                                  <Check className="h-3 w-3 text-emerald-500" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                          </div>
                        </TableCell>

                        {/* Column 2: Bank Info */}
                        <TableCell className="align-top py-3">
                          {isBankValid ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] font-semibold">
                                  {user.bank_info?.shortName || user.bank_name}
                                </Badge>
                                <span className="font-mono font-medium text-xs text-foreground">
                                  {user.bank_account}
                                </span>
                                <button
                                  onClick={() => copyToClipboard(`stk-${user.customer_id}`, user.bank_account)}
                                  className="text-muted-foreground hover:text-foreground"
                                  title="Copy STK"
                                >
                                  {copiedKey === `stk-${user.customer_id}` ? (
                                    <Check className="h-3 w-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                              <div className="text-[11px] text-muted-foreground uppercase font-medium">
                                {user.account_holder || "—"}
                              </div>
                            </div>
                          ) : user.bank_status === "missing" ? (
                            <div className="space-y-1">
                              <div className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500 border border-amber-500/20">
                                <AlertTriangle className="h-3 w-3" />
                                <span>Chưa có STK</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                Cần nhắc khách gửi thông tin nhận tiền
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-500 border border-rose-500/20">
                                <AlertTriangle className="h-3 w-3" />
                                <span>Ngân hàng không khớp</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                Nhập: &ldquo;{user.bank_name}&rdquo; - STK: {user.bank_account || "trống"}
                              </div>
                            </div>
                          )}
                        </TableCell>

                        {/* Column 3: Amount */}
                        <TableCell className="align-top py-3 text-right">
                          <div className="space-y-0.5">
                            <div className="text-sm font-bold text-emerald-500">
                              {vnd(targetAmount)}
                            </div>
                            <div className="flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
                              {hasPayable ? (
                                <span className="text-emerald-400/90 font-medium">Sẵn sàng: {vnd(user.payable_amount)}</span>
                              ) : (
                                <span className="text-amber-400 font-medium">Chờ sàn chốt: {vnd(user.unsettled_payable_amount || user.awaiting_amount)}</span>
                              )}
                              <span>• {user.order_count} đơn</span>
                            </div>
                            {user.bonus > 0 && (
                              <div className="text-[10px] text-amber-400 font-medium">
                                + {vnd(user.bonus)} thưởng campaign
                              </div>
                            )}
                            {(user.unsettled_payable_amount ?? 0) > 0 && hasPayable && (
                              <div className="text-[10px] text-amber-500/90 font-medium">
                                (còn {vnd(user.unsettled_payable_amount || 0)} chờ sàn chốt)
                              </div>
                            )}
                            {hasPayable && (
                              <div className="flex items-center justify-end gap-1 pt-0.5">
                                {user.is_fully_settled ? (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-medium flex items-center gap-0.5">
                                    <ShieldCheck className="h-2.5 w-2.5 text-emerald-400" />
                                    <span>Sàn đã chốt 100%</span>
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 bg-amber-500/10 text-amber-400 font-medium flex items-center gap-0.5" title="Shopee chưa chuyển tiền đợt này về tài khoản ngân hàng của bạn">
                                    <Clock className="h-2.5 w-2.5 text-amber-400" />
                                    <span>Có đơn chờ chốt</span>
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {/* Column 4: Status & Past transfer */}
                        <TableCell className="align-top py-3">
                          <div className="space-y-1">
                            {user.last_transfer ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-[11px]">
                                  <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500 bg-emerald-500/5">
                                    Đã chi {vnd(user.last_transfer.amount)}
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground">
                                    {shortDate(user.last_transfer.created_at)}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1 text-[10px]">
                                  {user.last_transfer.notify_mode === "dm" && (
                                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-blue-500/10 text-blue-400">
                                      👤 Đã gửi DM
                                    </Badge>
                                  )}
                                  {user.last_transfer.notify_mode === "group" && (
                                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-indigo-500/10 text-indigo-400">
                                      👥 Đã gửi Nhóm ({user.last_transfer.target_group === "test" ? "Dev" : "Chính"})
                                    </Badge>
                                  )}
                                  {user.last_transfer.notify_mode === "both" && (
                                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-emerald-500/10 text-emerald-400">
                                      🔔 Đã gửi DM & Nhóm
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                {isBankValid ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                                    <CheckCircle2 className="h-3 w-3" /> Sẵn sàng quét QR
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                                    <AlertTriangle className="h-3 w-3" /> Cần STK nhận tiền
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {/* Column 5: Action Buttons */}
                        <TableCell className="align-top py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* VietQR button */}
                            <Button
                              size="sm"
                              variant={isBankValid ? "default" : "outline"}
                              className={`h-8 gap-1.5 text-xs font-semibold ${
                                isBankValid
                                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
                                  : "border-border/60 hover:bg-secondary"
                              }`}
                              onClick={() => setSelectedUser(user)}
                            >
                              <QrCode className="h-3.5 w-3.5" />
                              <span>{isBankValid ? "Quét VietQR & Trả" : "Xem / Chi Trả"}</span>
                            </Button>

                            {/* Reminder button for missing bank */}
                            {!isBankValid && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1 px-2 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                                onClick={() => askBankMutation.mutate(user.customer_id)}
                                disabled={askBankMutation.isPending}
                                title="Gửi tin nhắn riêng qua Zalo nhắc khách cung cấp STK"
                              >
                                <Bell className="h-3.5 w-3.5" />
                                <span className="hidden xl:inline">Nhắc STK</span>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
          </div>
        )}

        {/* Content: History Table */}
        {activeSubTab === "history" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {filteredTransfers.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <History className="h-8 w-8 text-muted-foreground/60 mb-2" />
                <h3 className="text-sm font-semibold text-foreground">Chưa có lịch sử chi trả nào</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Các khoản chuyển khoản sau khi xác nhận sẽ được ghi nhận chi tiết tại đây.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-secondary/40 sticky top-0 z-10 backdrop-blur-md">
                  <TableRow className="border-border/60">
                    <TableHead className="w-20 text-xs font-semibold">Mã GD</TableHead>
                    <TableHead className="text-xs font-semibold">Khách Hàng</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Số Tiền</TableHead>
                    <TableHead className="text-xs font-semibold">Tài Khoản Nhận</TableHead>
                    <TableHead className="text-xs font-semibold">Thông Báo Zalo</TableHead>
                    <TableHead className="text-xs font-semibold">Ghi Chú & Mã Tham Chiếu</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Thời Gian</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransfers.map((tx) => (
                    <TableRow key={tx.id} className="border-border/50 hover:bg-secondary/20">
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        #{tx.id}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {tx.customer_code ? (
                            <CodeBadge code={tx.customer_code} />
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              DP???
                            </Badge>
                          )}
                          <span className="font-medium text-xs text-foreground">
                            {tx.display_name || tx.customer_id}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold text-xs text-emerald-500">
                        {vnd(tx.amount)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium text-foreground">{tx.bank_name || "—"}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{tx.bank_account || "—"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {tx.notify_mode === "dm" && (
                            <Badge variant="secondary" className="text-[10px] bg-blue-500/10 text-blue-400">
                              👤 Tin riêng (DM)
                            </Badge>
                          )}
                          {tx.notify_mode === "group" && (
                            <Badge variant="secondary" className="text-[10px] bg-indigo-500/10 text-indigo-400">
                              👥 Nhóm {tx.target_group === "test" ? "Dev" : "Chính"}
                            </Badge>
                          )}
                          {tx.notify_mode === "both" && (
                            <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-400">
                              🔔 Cả hai ({tx.target_group === "test" ? "Dev" : "Chính"})
                            </Badge>
                          )}
                          {(!tx.notify_mode || tx.notify_mode === "none") && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              🔕 Không gửi
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="truncate max-w-[200px]">
                          {tx.transfer_code && (
                            <span className="font-mono text-foreground font-medium mr-1.5">
                              [{tx.transfer_code}]
                            </span>
                          )}
                          {tx.note || "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {shortDate(tx.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </Card>

      {/* Payment Confirmation & VietQR Modal */}
      {selectedUser && (
        <PaymentDialog
          user={selectedUser}
          includeAwaitingDefault={includeAwaiting}
          gdriveActive={data?.gdrive_active}
          onOpenGDriveSetup={() => setGDriveModalOpen(true)}
          onClose={() => setSelectedUser(null)}
          onSuccess={(res) => {
            setSelectedUser(null)
            setToastMessage({
              text: res.message || "Đã ghi nhận chi trả thành công!",
              type: "success",
            })
            queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
            queryClient.invalidateQueries({ queryKey: ["admin-orders"] })
          }}
          onAskBank={() => {
            askBankMutation.mutate(selectedUser.customer_id)
          }}
        />
      )}

      {/* Google Drive Setup Modal */}
      <GDriveSetupModal
        isOpen={gdriveModalOpen}
        onClose={() => setGDriveModalOpen(false)}
        currentUrl={data?.gdrive_webhook_url || ""}
        isActive={!!data?.gdrive_active}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["admin-payments"] })
          setToastMessage({
            text: "Đã cập nhật cấu hình Google Drive thành công!",
            type: "success",
          })
        }}
      />
    </div>
  )
}

// ----------------------------------------------------------------------
// Payment & VietQR Dialog Component
// ----------------------------------------------------------------------
interface PaymentDialogProps {
  user: AdminPaymentUser
  includeAwaitingDefault?: boolean
  gdriveActive?: boolean
  onOpenGDriveSetup: () => void
  onClose: () => void
  onSuccess: (result: any) => void
  onAskBank: () => void
}

function PaymentDialog({
  user,
  gdriveActive,
  onOpenGDriveSetup,
  onClose,
  onSuccess,
  onAskBank,
}: PaymentDialogProps) {
  const isBankValid = user.bank_status === "valid"

  // Order selection state: default to all settled approved orders
  const [selectedOrderIds, setSelectedOrderIds] = React.useState<Set<string>>(() => {
    const settledIds = (user.orders || [])
      .filter((o) => o.status === "approved" && o.settlement_status === "settled")
      .map((o) => o.order_id)
    return new Set(settledIds)
  })

  // Selected orders & amounts:
  const selectedOrders = React.useMemo(() => {
    return (user.orders || []).filter((o) => selectedOrderIds.has(o.order_id))
  }, [user.orders, selectedOrderIds])

  const calculatedCashback = React.useMemo(() => {
    return selectedOrders.reduce((sum, o) => sum + (o.cashback_amount || 0), 0)
  }, [selectedOrders])

  const selectedSettledCount = React.useMemo(() => {
    return selectedOrders.filter((o) => o.settlement_status === "settled").length
  }, [selectedOrders])

  const selectedUnsettledCount = React.useMemo(() => {
    return selectedOrders.filter((o) => o.settlement_status !== "settled").length
  }, [selectedOrders])

  const bonusAmount = React.useMemo(() => {
    return selectedOrders.reduce((sum, o) => sum + (o.campaign_bonus || 0), 0)
  }, [selectedOrders])

  const calculatedTotal = calculatedCashback + bonusAmount

  // Form State: amount is synced with calculatedTotal
  const [amount, setAmount] = React.useState<number>(calculatedTotal)
  const [transferCode, setTransferCode] = React.useState("")
  const [note, setNote] = React.useState("")
  const [notifyMode, setNotifyMode] = React.useState<"dm" | "group" | "both" | "none">("both")
  const [targetGroup, setTargetGroup] = React.useState<"test" | "main">("test") // Default to test group per user request!

  // Sync amount whenever selected orders change
  React.useEffect(() => {
    setAmount(calculatedTotal)
  }, [calculatedTotal])

  const toggleOrder = (orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) {
        next.delete(orderId)
      } else {
        next.add(orderId)
      }
      return next
    })
  }

  const selectAllSettled = () => {
    const ids = (user.orders || [])
      .filter((o) => o.status === "approved" && o.settlement_status === "settled")
      .map((o) => o.order_id)
    setSelectedOrderIds(new Set(ids))
  }

  const selectAll = () => {
    setSelectedOrderIds(new Set((user.orders || []).map((o) => o.order_id)))
  }

  const clearAll = () => {
    setSelectedOrderIds(new Set())
  }

  // Transfer Memo (Neutral Content for Tax & AML Safety)
  const custCode = user.customer_code || user.customer_id
  const defaultMemo = user.reference || custCode || "DP"
  const [transferMemo, setTransferMemo] = React.useState<string>(defaultMemo)

  // Copy feedback
  const [copiedField, setCopiedField] = React.useState<string | null>(null)
  const handleCopy = (field: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 1800)
  }

  // Preset options for neutral memo
  const todayStr = React.useMemo(() => {
    const d = new Date()
    const dd = String(d.getDate()).padStart(2, "0")
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    return `${dd}${mm}`
  }, [])

  const presetChips = React.useMemo(() => {
    const chips = [
      { label: custCode, desc: "Mã định danh (Khuyên dùng)", value: custCode },
      { label: `${custCode} ${todayStr}`, desc: "Kèm ngày (Dễ soát sao kê)", value: `${custCode} ${todayStr}` },
    ]
    const numMatch = custCode.match(/\d+/)
    if (numMatch) {
      chips.push({
        label: `DP${parseInt(numMatch[0], 10)}`,
        desc: "Mã rút gọn",
        value: `DP${parseInt(numMatch[0], 10)}`,
      })
    }
    return chips
  }, [custCode, todayStr])

  // Calculate dynamic QR URL based on custom amount & transferMemo
  const qrUrl = React.useMemo(() => {
    if (!isBankValid || !user.bank_info || amount <= 0) return null
    const memo = transferMemo.trim() || custCode
    const params = new URLSearchParams({
      amount: String(amount),
      addInfo: memo,
      accountName: user.account_holder || "",
    })
    return `https://img.vietqr.io/image/${user.bank_info.bin}-${user.bank_account}-compact2.png?${params.toString()}`
  }, [isBankValid, user, amount, transferMemo, custCode])

  // Proof Image State & Upload
  const [proofImage, setProofImage] = React.useState("")
  const [isUploading, setIsUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const handleFileUpload = async (file: File) => {
    if (!file || !file.type.startsWith("image/")) return
    setIsUploading(true)
    setUploadError(null)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const base64 = reader.result as string
          const res = await uploadPaymentProof({ data: base64 })
          if (res.ok && res.url) {
            setProofImage(res.url)
          } else {
            setUploadError(res.message || "Không thể tải ảnh lên")
          }
        } catch (err: any) {
          setUploadError(err.message || "Lỗi khi tải ảnh")
        } finally {
          setIsUploading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (err: any) {
      setUploadError(err.message || "Lỗi đọc file")
      setIsUploading(false)
    }
  }

  // Handle paste image from clipboard anywhere inside dialog
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile()
        if (file) {
          e.preventDefault()
          handleFileUpload(file)
          break
        }
      }
    }
  }

  // Confirm Mutation
  const confirmMutation = useMutation({
    mutationFn: () =>
      confirmAdminPayment({
        customer_id: user.customer_id,
        amount,
        order_ids: Array.from(selectedOrderIds),
        transfer_code: transferCode.trim() || undefined,
        reference: transferMemo.trim() || undefined,
        proof_image: proofImage.trim() || undefined,
        note: note.trim() || undefined,
        notify_mode: notifyMode,
        target_group: targetGroup,
        include_awaiting: false,
      }),
    onSuccess: (data) => {
      onSuccess(data)
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onPaste={handlePaste}
        className="sm:max-w-4xl lg:max-w-5xl w-[96vw] max-h-[90vh] flex flex-col p-0 overflow-hidden border-border/80 bg-card shadow-2xl rounded-2xl"
      >
        {/* Sticky Fixed Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-border/70 px-6 py-4 bg-secondary/30">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-xs">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base font-bold text-foreground">
                  Chi Trả Tiền Hoàn & Quét VietQR
                </DialogTitle>
                {user.customer_code ? (
                  <CodeBadge code={user.customer_code} />
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    {user.customer_id}
                  </Badge>
                )}
              </div>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Khách hàng: <strong className="text-foreground">{user.display_name}</strong> •{" "}
                <span className="font-mono">{user.zalo_user_id || user.customer_id}</span> •{" "}
                {user.order_count} đơn hàng
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Scrollable Center Body (Two Columns on Desktop) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {/* Dynamic Cashflow & Settlement Safety Alert based on Selected Orders */}
          {selectedOrders.length === 0 ? (
            <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-start gap-3 shadow-xs">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <div className="font-semibold text-amber-500 flex items-center gap-1.5 text-sm">
                  ⚠️ Chưa Chọn Đơn Hàng Nào Để Thanh Toán
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Vui lòng tick chọn các đơn hàng bạn muốn chuyển khoản ở bảng bên dưới. Số tiền chuyển khoản và mã VietQR sẽ được tự động tính toán chính xác theo các đơn đã chọn.
                </p>
              </div>
            </div>
          ) : selectedUnsettledCount === 0 ? (
            <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-start gap-3 shadow-xs">
              <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <div className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 text-sm">
                  🛡️ An Toàn Tuyệt Đối: Shopee Đã Quyết Toán {selectedSettledCount} Đơn Này Về Ngân Hàng
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Toàn bộ <strong>{selectedOrders.length} đơn hàng</strong> đang chọn (tổng hoa hồng: <strong>{vnd(calculatedTotal)}</strong>) đã được sàn Shopee quyết toán và thực tế chuyển khoản về ngân hàng của bạn. Bạn có thể an tâm quét QR chi trả cho khách ngay mà không lo thâm hụt dòng tiền vốn.
                </p>
              </div>
            </div>
          ) : (
            <div className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-start gap-3 shadow-xs">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <div className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 text-sm">
                  ⚠️ Cảnh Báo Dòng Tiền: Có {selectedUnsettledCount} Đơn Shopee Chưa Chốt Tiền Về Bank
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Trong các đơn đang chọn, có <strong>{selectedUnsettledCount} đơn</strong> mà Shopee <strong>chưa chuyển khoản tiền hoa hồng về ngân hàng của bạn</strong>.
                  Nếu bạn bấm xác nhận chuyển khoản ngay bây giờ, bạn sẽ phải <em>tự ứng tiền túi</em> trước. <strong>Khuyên dùng:</strong> Bấm nút &ldquo;Chỉ chọn đơn sàn đã chốt&rdquo; bên dưới để an toàn dòng tiền!
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Left Column (5 cols): VietQR & Protection Notice */}
            <div className="md:col-span-5 flex flex-col items-center space-y-4">
              {isBankValid && qrUrl ? (
                <div className="w-full flex flex-col items-center space-y-3.5">
                  {/* VietQR Code Container */}
                  <div className="relative w-full max-w-[280px] aspect-square rounded-2xl border-2 border-emerald-500/30 bg-white p-3 shadow-md flex items-center justify-center overflow-hidden group">
                    <img
                      src={qrUrl}
                      alt="VietQR Code"
                      className="w-full h-full object-contain"
                    />
                    <a
                      href={qrUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-xs font-semibold gap-2 backdrop-blur-xs"
                    >
                      <ExternalLink className="h-6 w-6" />
                      <span>Mở ảnh QR lớn / Tải về</span>
                    </a>
                  </div>

                  {/* Bank info badges */}
                  <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
                    <Badge variant="secondary" className="bg-primary/10 text-primary font-semibold flex items-center gap-1">
                      <Building className="h-3 w-3" />
                      <span>{user.bank_info?.shortName || user.bank_name}</span>
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      BIN: {user.bank_info?.bin}
                    </Badge>
                  </div>

                  <p className="text-[11px] text-center text-muted-foreground leading-normal px-2">
                    Mở app Ngân hàng quét QR để tự động điền STK, Số tiền ({vnd(amount)}) và Nội dung ({transferMemo}).
                  </p>

                  {/* Anti-Tax / Anti-AML Protection Box */}
                  <div className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-left space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                      <span>Bảo vệ tài khoản & Tránh quét Thuế</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Nội dung chuyển khoản mặc định sử dụng <strong>mã định danh ({custCode})</strong> thay vì từ khoá thương mại (<em>hoàn tiền, shopee, hoa hồng</em>), giúp hệ thống AI ngân hàng không phân loại giao dịch thương mại/chịu thuế.
                    </p>
                  </div>
                </div>
              ) : isBankValid && amount <= 0 ? (
                <div className="w-full rounded-xl border border-dashed border-border/80 bg-secondary/20 p-5 text-center space-y-3">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    <QrCode className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      Chưa tạo mã VietQR (Số tiền: 0đ)
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ngân hàng <strong>{user.bank_info?.shortName || user.bank_name}</strong> đã khớp NAPAS 24/7. Hãy tick chọn các đơn hàng bên dưới để hệ thống tạo mã QR VietQR tương ứng.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-xs">
                    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                      <Building className="h-3 w-3" />
                      <span>{user.bank_info?.shortName || user.bank_name}</span>
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      BIN: {user.bank_info?.bin}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-center space-y-3">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-amber-500">
                      {user.bank_status === "missing" ? "Chưa có thông tin STK" : "Ngân hàng không xác định"}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      {user.bank_status === "missing"
                        ? "Khách hàng chưa cung cấp số tài khoản nhận tiền hoàn."
                        : `Tên ngân hàng "${user.bank_name}" chưa khớp với danh mục ngân hàng NAPAS.`}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-2 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/20"
                    onClick={onAskBank}
                  >
                    <Bell className="h-4 w-4" />
                    <span>Nhắc Khách Gửi STK Qua Zalo</span>
                  </Button>
                </div>
              )}
            </div>

            {/* Right Column (7 cols): Transfer Details & Settings */}
            <div className="md:col-span-7 space-y-4">
              {/* Quick Copy Info Card */}
              <div className="rounded-xl border border-border/70 bg-secondary/30 p-3.5 space-y-2">
                <div className="flex items-center justify-between pb-1 border-b border-border/40">
                  <span className="text-xs font-semibold text-muted-foreground tracking-wide">
                    THÔNG TIN CHUYỂN KHOẢN
                  </span>
                  <span className="text-[11px] font-medium text-emerald-400">1-Click Copy</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {/* Bank */}
                  <div className="flex items-center justify-between py-1 border-b border-border/30">
                    <span className="text-muted-foreground">Ngân hàng:</span>
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <span>{user.bank_info?.shortName || user.bank_name || "Chưa có"}</span>
                      {user.bank_name && (
                        <button
                          onClick={() => handleCopy("bank", user.bank_info?.shortName || user.bank_name)}
                          className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                          title="Copy Ngân hàng"
                        >
                          {copiedField === "bank" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Account Holder */}
                  <div className="flex items-center justify-between py-1 border-b border-border/30">
                    <span className="text-muted-foreground">Chủ TK:</span>
                    <div className="flex items-center gap-1.5 font-semibold uppercase text-foreground">
                      <span className="truncate max-w-[140px]">{user.account_holder || "—"}</span>
                      {user.account_holder && (
                        <button
                          onClick={() => handleCopy("name", user.account_holder)}
                          className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                          title="Copy Chủ tài khoản"
                        >
                          {copiedField === "name" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Account Number */}
                  <div className="flex items-center justify-between py-1 border-b border-border/30">
                    <span className="text-muted-foreground">Số tài khoản:</span>
                    <div className="flex items-center gap-1.5 font-mono font-bold text-foreground">
                      <span>{user.bank_account || "Chưa có"}</span>
                      {user.bank_account && (
                        <button
                          onClick={() => handleCopy("stk", user.bank_account)}
                          className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                          title="Copy Số tài khoản"
                        >
                          {copiedField === "stk" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="flex items-center justify-between py-1 border-b border-border/30">
                    <span className="text-muted-foreground">Số tiền:</span>
                    <div className="flex items-center gap-1.5 font-bold text-emerald-500">
                      <span>{vnd(amount)}</span>
                      <button
                        onClick={() => handleCopy("amount", String(amount))}
                        className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                        title="Copy Số tiền"
                      >
                        {copiedField === "amount" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Memo row */}
                <div className="flex items-center justify-between pt-1 text-xs">
                  <span className="text-muted-foreground">Nội dung CK:</span>
                  <div className="flex items-center gap-1.5 font-mono font-semibold text-primary">
                    <span>{transferMemo}</span>
                    <button
                      onClick={() => handleCopy("ref", transferMemo)}
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                      title="Copy Nội dung"
                    >
                      {copiedField === "ref" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Memo Customization & Quick Chips */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                    <span>Nội dung chuyển khoản (Memo)</span>
                  </label>
                  <span className="text-[10px] text-muted-foreground">Cập nhật QR tức thì</span>
                </div>
                <Input
                  value={transferMemo}
                  onChange={(e) => setTransferMemo(e.target.value)}
                  placeholder="Nhập nội dung chuyển khoản..."
                  className="h-8 text-xs font-mono font-medium"
                />
                {/* Quick Chips */}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[10px] text-muted-foreground">Gợi ý an toàn:</span>
                  {presetChips.map((chip) => (
                    <button
                      key={chip.value}
                      type="button"
                      onClick={() => setTransferMemo(chip.value)}
                      className={`text-[10px] px-2 py-0.5 rounded-md font-mono border transition-all ${
                        transferMemo === chip.value
                          ? "bg-primary text-primary-foreground border-primary font-semibold shadow-2xs"
                          : "bg-secondary/60 hover:bg-secondary text-foreground border-border/60"
                      }`}
                      title={chip.desc}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount adjustment & Bank Transfer code */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    Số tiền chi trả (VND)
                  </label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="h-8 text-xs font-bold text-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    Mã GD ngân hàng (FT Code)
                  </label>
                  <Input
                    placeholder="VD: FT2409... (tuỳ chọn)"
                    value={transferCode}
                    onChange={(e) => setTransferCode(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Live Selected Orders Summary Banner */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs">
                <div className="flex items-center gap-1.5 text-foreground font-semibold">
                  <Coins className="h-4 w-4 text-emerald-500" />
                  <span>Đã chọn: <strong className="text-emerald-500">{selectedOrderIds.size}</strong>/{user.orders?.length || 0} đơn</span>
                </div>
                <div className="text-[11px] text-muted-foreground font-medium">
                  {selectedUnsettledCount > 0 ? (
                    <span className="text-amber-500">Gồm {selectedUnsettledCount} đơn chờ chốt</span>
                  ) : (
                    <span className="text-emerald-500">100% đơn sàn đã chốt</span>
                  )}
                </div>
              </div>

              {/* Notification Mode Selection */}
              <div className="space-y-2 pt-2 border-t border-border/60">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Send className="h-3.5 w-3.5 text-primary" />
                  <span>Chế Độ Thông Báo Sau Khi Chuyển</span>
                </span>

                <div className="grid grid-cols-2 gap-2">
                  {/* 1. DM */}
                  <button
                    type="button"
                    onClick={() => setNotifyMode("dm")}
                    className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                      notifyMode === "dm"
                        ? "border-primary bg-primary/10 shadow-xs"
                        : "border-border/60 bg-secondary/30 hover:bg-secondary/60"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <User className="h-3.5 w-3.5 text-blue-400" />
                      <span>Tin riêng (DM)</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      Gửi tin nhắn riêng Zalo cho khách
                    </span>
                  </button>

                  {/* 2. Group */}
                  <button
                    type="button"
                    onClick={() => setNotifyMode("group")}
                    className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                      notifyMode === "group"
                        ? "border-primary bg-primary/10 shadow-xs"
                        : "border-border/60 bg-secondary/30 hover:bg-secondary/60"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Users2 className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Nhóm Zalo</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      Bắn thông báo chúc mừng vào nhóm
                    </span>
                  </button>

                  {/* 3. Both */}
                  <button
                    type="button"
                    onClick={() => setNotifyMode("both")}
                    className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                      notifyMode === "both"
                        ? "border-emerald-500 bg-emerald-500/10 shadow-xs"
                        : "border-border/60 bg-secondary/30 hover:bg-secondary/60"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                      <Bell className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Cả hai (Khuyên dùng)</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      Gửi cả tin riêng Zalo và nhóm
                    </span>
                  </button>

                  {/* 4. None */}
                  <button
                    type="button"
                    onClick={() => setNotifyMode("none")}
                    className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                      notifyMode === "none"
                        ? "border-primary bg-primary/10 shadow-xs"
                        : "border-border/60 bg-secondary/30 hover:bg-secondary/60"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      <VolumeX className="h-3.5 w-3.5" />
                      <span>Không thông báo</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      Chỉ ghi nhận đã thanh toán
                    </span>
                  </button>
                </div>

                {/* Target Group Selector */}
                {(notifyMode === "group" || notifyMode === "both") && (
                  <div className="rounded-lg border border-border/70 bg-secondary/40 p-2.5 space-y-1.5">
                    <div className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                      <span>Chọn nhóm Zalo phát thông báo:</span>
                      <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/20">
                        Mặc định Dev
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex flex-1 items-center gap-2 rounded-lg border border-border/60 bg-card p-2 text-xs cursor-pointer hover:border-primary">
                        <input
                          type="radio"
                          name="targetGroup"
                          checked={targetGroup === "test"}
                          onChange={() => setTargetGroup("test")}
                          className="text-primary focus:ring-primary h-3.5 w-3.5"
                        />
                        <div>
                          <div className="font-semibold text-foreground">🧪 Nhóm Dev / Test</div>
                          <div className="text-[10px] text-muted-foreground font-mono">ID: 8786316503449470342</div>
                        </div>
                      </label>

                      <label className="flex flex-1 items-center gap-2 rounded-lg border border-border/60 bg-card p-2 text-xs cursor-pointer hover:border-primary">
                        <input
                          type="radio"
                          name="targetGroup"
                          checked={targetGroup === "main"}
                          onChange={() => setTargetGroup("main")}
                          className="text-primary focus:ring-primary h-3.5 w-3.5"
                        />
                        <div>
                          <div className="font-semibold text-foreground">🚀 Nhóm Hoàn Tiền Chính</div>
                          <div className="text-[10px] text-muted-foreground font-mono">ID: 2813090100064697955</div>
                        </div>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Proof Image / Google Drive Link Section */}
              <div className="space-y-2 rounded-xl border border-border/70 bg-secondary/30 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5 text-primary" />
                    <span>Ảnh Biên Lai / Bill Chuyển Khoản (Đính kèm DM Zalo)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {isUploading && (
                      <span className="text-[11px] text-primary flex items-center gap-1 font-medium">
                        <RefreshCw className="h-3 w-3 animate-spin" /> Đang tải ảnh...
                      </span>
                    )}
                    {gdriveActive ? (
                      <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <Cloud className="h-3 w-3" /> Auto Google Drive
                      </Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={onOpenGDriveSetup}
                        className="text-[10px] text-amber-400 hover:underline flex items-center gap-1"
                        title="Bấm để thiết lập tự động tải ảnh lên Google Drive"
                      >
                        <Cloud className="h-3 w-3" /> Cài Drive tự động
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Link className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Dán link Google Drive hoặc tải ảnh bill..."
                      value={proofImage}
                      onChange={(e) => setProofImage(e.target.value)}
                      className="h-8 pl-8 text-xs font-mono"
                    />
                  </div>

                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFileUpload(file)
                    }}
                  />

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="h-8 gap-1.5 text-xs shrink-0"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>Tải ảnh</span>
                  </Button>
                </div>

                {uploadError && (
                  <div className="text-[11px] text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    <span>{uploadError}</span>
                  </div>
                )}

                {/* Image Preview if available */}
                {proofImage && (
                  <div className="flex items-center justify-between gap-3 p-2 rounded-lg bg-card border border-border/60">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-10 w-10 rounded-md border border-border overflow-hidden bg-secondary shrink-0 flex items-center justify-center">
                        {proofImage.startsWith("http") || proofImage.startsWith("/") ? (
                          <img src={proofImage} alt="Bill proof" className="h-full w-full object-cover" />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground truncate max-w-[280px]">
                          {proofImage.includes("drive.google.com") ? "Link Google Drive" : "Ảnh biên lai ngân hàng"}
                        </div>
                        <a
                          href={proofImage}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                        >
                          <span>Mở xem ảnh</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setProofImage("")}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      title="Xoá ảnh"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}

                <div className="text-[10px] text-muted-foreground leading-relaxed flex items-center justify-between">
                  <span>💡 Mẹo: Bạn có thể chụp màn hình bill và bấm <strong>Ctrl + V</strong> để dán trực tiếp.</span>
                  {proofImage && (
                    <Badge variant="secondary" className="text-[9px] bg-emerald-500/10 text-emerald-400">
                      ✓ Đã đính kèm vào tin Zalo
                    </Badge>
                  )}
                </div>
              </div>

              {/* Note input */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Ghi chú nội bộ
                </label>
                <Input
                  placeholder="VD: Đã chuyển khoản qua VCB sáng nay..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Interactive Order Selection Table & Mobile Cards */}
          {user.orders && user.orders.length > 0 && (
            <div className="mt-6 rounded-2xl border border-border/80 bg-secondary/20 p-3.5 sm:p-4 space-y-3 shadow-xs">
              {/* Header with Title and Quick Selector Buttons */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border/60">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs sm:text-sm font-bold text-foreground">
                      Bảng Chọn Đơn Hàng Chi Trả ({selectedOrderIds.size}/{user.orders.length} đơn)
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Tick chọn từng đơn hàng để chuyển khoản. Mã VietQR và số tiền sẽ tự động cập nhật.
                  </p>
                </div>

                {/* Quick Selection Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={selectAllSettled}
                    className="h-7 px-2.5 text-[11px] font-semibold border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                    title="Chỉ chọn những đơn Shopee đã quyết toán tiền về tài khoản ngân hàng"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-1 text-emerald-500" />
                    <span>Chỉ đơn đã chốt ({(user.orders || []).filter(o => o.status === "approved" && o.settlement_status === "settled").length})</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={selectAll}
                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Chọn tất cả
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={clearAll}
                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                  >
                    Bỏ chọn
                  </Button>
                </div>
              </div>

              {/* Selection Summary Pill */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card/80 border border-border/60 p-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-muted-foreground">Đang chọn:</span>
                  <Badge variant="secondary" className="bg-primary/10 text-primary font-bold">
                    {selectedOrderIds.size} / {user.orders.length} đơn
                  </Badge>
                  {selectedUnsettledCount > 0 ? (
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500 font-medium text-[10px]">
                      ⚠️ {selectedUnsettledCount} đơn chờ chốt
                    </Badge>
                  ) : selectedOrderIds.size > 0 ? (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 font-medium text-[10px]">
                      🛡️ 100% đã chốt sàn
                    </Badge>
                  ) : null}
                </div>

                <div className="font-mono text-xs">
                  <span className="text-muted-foreground">Tổng tiền chi trả: </span>
                  <strong className="text-emerald-500 font-bold text-sm">
                    {vnd(calculatedTotal)}
                  </strong>
                  {bonusAmount > 0 && (
                    <span className="text-amber-400 text-[10px] ml-1">
                      (gồm {vnd(bonusAmount)} thưởng)
                    </span>
                  )}
                </div>
              </div>

              {/* 1. Desktop Table View (sm:block) */}
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-border/70 bg-card/60">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/60 text-muted-foreground font-semibold border-b border-border/60">
                    <tr>
                      <th className="p-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.size === user.orders.length && user.orders.length > 0}
                          ref={(el) => {
                            if (el) {
                              el.indeterminate = selectedOrderIds.size > 0 && selectedOrderIds.size < user.orders.length
                            }
                          }}
                          onChange={(e) => (e.target.checked ? selectAll() : clearAll())}
                          className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                        />
                      </th>
                      <th className="p-3 font-semibold">Mã Đơn & Sàn</th>
                      <th className="p-3 font-semibold">Sản Phẩm & Thời Gian</th>
                      <th className="p-3 font-semibold">Trạng Thái Chốt Sàn</th>
                      <th className="p-3 font-semibold text-right">Tiền Hoàn (Cashback)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {user.orders.map((o) => {
                      const isSelected = selectedOrderIds.has(o.order_id)
                      const isSettled = o.settlement_status === "settled"
                      return (
                        <tr
                          key={o.order_id}
                          onClick={() => toggleOrder(o.order_id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? "bg-emerald-500/10 hover:bg-emerald-500/15" : "hover:bg-secondary/40"
                          }`}
                        >
                          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleOrder(o.order_id)}
                              className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                            />
                          </td>
                          <td className="p-3">
                            <div className="font-mono font-bold text-foreground">{o.order_id}</div>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              <Badge variant="outline" className="text-[9px] px-1 py-0 font-medium">
                                {o.platform === "tiktok" ? "TikTok" : "Shopee"}
                              </Badge>
                              {o.status === "awaiting_approval" ? (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-blue-500/10 text-blue-400">
                                  Chờ duyệt
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-emerald-500/10 text-emerald-400">
                                  Đã duyệt
                                </Badge>
                              )}
                              {Boolean(o.campaign_bonus) && (
                                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-amber-500/15 text-amber-500 border border-amber-500/30 font-semibold flex items-center gap-0.5">
                                  🎁 +{vnd(o.campaign_bonus!)} {o.campaign_name ? `(${o.campaign_name})` : ""}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="p-3 max-w-[280px]">
                            <div className="truncate text-foreground font-medium" title={o.product || "Sản phẩm"}>
                              {o.product || "Sản phẩm"}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Ngày đặt: {shortDate(o.approved_at || o.recorded_at)}
                            </div>
                          </td>
                          <td className="p-3">
                            {isSettled ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20"
                                title={`Shopee đã quyết toán đợt ${o.payout_batch_id || ""}`}
                              >
                                <ShieldCheck className="h-3 w-3" />
                                <span>Sàn đã chốt {o.payout_batch_id ? `(#${o.payout_batch_id.slice(-6)})` : ""}</span>
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20"
                                title="Shopee chưa chuyển tiền đợt này về tài khoản ngân hàng của bạn"
                              >
                                <Clock className="h-3 w-3" />
                                <span>Chờ Shopee chốt</span>
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div className="font-mono font-bold text-emerald-500 text-sm">
                              {vnd((o.cashback_amount || 0) + (o.campaign_bonus || 0))}
                            </div>
                            {Boolean(o.campaign_bonus) && (
                              <div className="text-[10px] text-amber-400 font-medium">
                                {vnd(o.cashback_amount || 0)} + {vnd(o.campaign_bonus!)} thưởng
                              </div>
                            )}
                            {o.order_value && o.order_value > 0 && (
                              <div className="text-[10px] text-muted-foreground">
                                Đơn: {vnd(o.order_value)}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* 2. Mobile Card List View (sm:hidden) */}
              <div className="sm:hidden space-y-2 max-h-72 overflow-y-auto pr-0.5">
                {user.orders.map((o) => {
                  const isSelected = selectedOrderIds.has(o.order_id)
                  const isSettled = o.settlement_status === "settled"
                  return (
                    <div
                      key={o.order_id}
                      onClick={() => toggleOrder(o.order_id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer select-none ${
                        isSelected
                          ? "border-emerald-500 bg-emerald-500/10 shadow-xs"
                          : "border-border/60 bg-card hover:bg-secondary/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}} // handled by parent onClick
                            className="rounded border-border text-primary focus:ring-primary h-5 w-5 shrink-0 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-xs font-bold text-foreground">{o.order_id}</span>
                              <Badge variant="outline" className="text-[9px] px-1 py-0">
                                {o.platform === "tiktok" ? "TikTok" : "Shopee"}
                              </Badge>
                              {Boolean(o.campaign_bonus) && (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-amber-500/15 text-amber-500 border border-amber-500/30 font-semibold">
                                  🎁 +{vnd(o.campaign_bonus!)}
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate max-w-[200px] mt-0.5">
                              {o.product || "Sản phẩm Shopee"}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-xs font-bold text-emerald-500">
                            {vnd((o.cashback_amount || 0) + (o.campaign_bonus || 0))}
                          </div>
                          {Boolean(o.campaign_bonus) && (
                            <div className="text-[9px] text-amber-400 font-medium">
                              +{vnd(o.campaign_bonus!)} thưởng
                            </div>
                          )}
                          <div className="text-[10px] text-muted-foreground">
                            {shortDate(o.approved_at || o.recorded_at)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between text-[10px]">
                        <div>
                          {isSettled ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                              <ShieldCheck className="h-3 w-3" />
                              <span>Sàn đã chốt {o.payout_batch_id ? `(#${o.payout_batch_id.slice(-6)})` : ""}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                              <Clock className="h-3 w-3" />
                              <span>Chờ Shopee chốt</span>
                            </span>
                          )}
                        </div>
                        <span className={isSelected ? "font-semibold text-emerald-500" : "text-muted-foreground"}>
                          {isSelected ? "✓ Đã chọn" : "Chạm để chọn"}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sticky Fixed Footer for both Web & Mobile */}
        <div className="shrink-0 border-t border-border/70 p-3 sm:px-6 sm:py-3.5 bg-secondary/30">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <div className="flex items-center justify-between sm:justify-start gap-3">
              <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-8">
                Đóng
              </Button>
              <div className="text-xs text-muted-foreground">
                Đã chọn: <strong className="text-foreground">{selectedOrderIds.size}</strong> đơn •{" "}
                Số tiền: <strong className="text-emerald-500 font-bold">{vnd(amount)}</strong>
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending || amount <= 0 || selectedOrderIds.size === 0}
              className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-5 py-2 h-9 shadow-sm w-full sm:w-auto"
            >
              {confirmMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Đang xử lý & gửi thông báo...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Xác Nhận Đã Chuyển ({vnd(amount)})</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ----------------------------------------------------------------------
// Google Drive Webhook Setup Modal
// ----------------------------------------------------------------------
const GDRIVE_SCRIPT_TEMPLATE = `// Đặt mật mã bảo vệ nếu muốn chống người lạ spam (hoặc để trống "" nếu không cần):
var SECRET_TOKEN = "";

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    
    // Kiểm tra mã bảo mật nếu bạn có đặt SECRET_TOKEN
    var reqToken = (e.parameter && e.parameter.token) || data.token;
    if (SECRET_TOKEN && reqToken !== SECRET_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false,
        error: "Unauthorized: Sai mã bí mật"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var filename = data.filename || ("bienlai_" + new Date().getTime() + ".jpg");
    var mimeType = data.mimeType || "image/jpeg";
    var decoded = Utilities.base64Decode(data.base64);
    var blob = Utilities.newBlob(decoded, mimeType, filename);
    
    // Thư mục lưu ảnh trên Google Drive (tự tạo nếu chưa có)
    var folderName = "BienLai_HoanTien";
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    
    // Lưu file vào thư mục và bật quyền xem công khai qua link
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      drive_url: file.getUrl()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}`

interface GDriveSetupModalProps {
  isOpen: boolean
  onClose: () => void
  currentUrl: string
  isActive: boolean
  onSaved: () => void
}

function GDriveSetupModal({
  isOpen,
  onClose,
  currentUrl,
  isActive,
  onSaved,
}: GDriveSetupModalProps) {
  const [url, setUrl] = React.useState(currentUrl)
  const [copiedCode, setCopiedCode] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setUrl(currentUrl)
    setError(null)
  }, [currentUrl, isOpen])

  const handleCopyCode = () => {
    navigator.clipboard.writeText(GDRIVE_SCRIPT_TEMPLATE)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const handleSave = async (targetUrl: string) => {
    setSaving(true)
    setError(null)
    try {
      const res = await saveGDriveConfig(targetUrl.trim())
      if (res.ok) {
        onSaved()
        onClose()
      } else {
        setError(res.message || "Không thể lưu cấu hình")
      }
    } catch (err: any) {
      setError(err.message || "Lỗi khi lưu cấu hình")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-card border-border/80">
        <div className="shrink-0 border-b border-border/70 p-5 bg-secondary/20">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <Cloud className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                Cấu Hình Tự Động Lưu Ảnh Vào Google Drive
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Chỉ 1 phút thiết lập miễn phí qua Google Apps Script — không cần thẻ tín dụng hay GCP Console.
              </DialogDescription>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Status banner */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between ${
              isActive
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-amber-500/10 border-amber-500/30 text-amber-400"
            }`}
          >
            <div className="flex items-center gap-2">
              {isActive ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
              <div>
                <span className="font-semibold">
                  {isActive ? "Google Drive Đang Hoạt Động" : "Chưa Kết Nối Google Drive"}
                </span>
                <p className="text-[11px] opacity-80 mt-0.5">
                  {isActive
                    ? "Ảnh bill dán vào sẽ tự động tải lên thư mục 'BienLai_HoanTien' và lấy link công khai."
                    : "Hiện tại ảnh tải lên chỉ lưu tạm trên ổ cứng server nội bộ."}
                </p>
              </div>
            </div>
            {isActive && (
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                Active
              </Badge>
            )}
          </div>

          {/* Setup Guide */}
          <div className="space-y-3 rounded-xl border border-border/70 bg-secondary/30 p-4">
            <h4 className="font-semibold text-foreground text-xs flex items-center gap-1.5">
              <span>📋 3 Bước Thiết Lập Miễn Phí (1 Phút)</span>
            </h4>

            {/* Step 1 */}
            <div className="space-y-1">
              <div className="font-medium text-foreground">
                1. Mở dự án Google Apps Script mới:
              </div>
              <p className="text-muted-foreground text-[11px]">
                Truy cập{" "}
                <a
                  href="https://script.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline font-medium inline-flex items-center gap-0.5"
                >
                  script.google.com <ExternalLink className="h-2.5 w-2.5" />
                </a>{" "}
                (bằng tài khoản Gmail bạn muốn lưu ảnh) và bấm nút <strong>"Dự án mới" (New project)</strong>.
              </p>
            </div>

            {/* Step 2 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-medium text-foreground">
                <span>2. Xóa code cũ và dán đoạn mã này vào:</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCopyCode}
                  className="h-6 gap-1 px-2 text-[10px]"
                >
                  {copiedCode ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedCode ? "Đã chép mã" : "Sao chép mã"}</span>
                </Button>
              </div>
              <pre className="max-h-36 overflow-y-auto rounded-lg bg-black/60 p-2.5 font-mono text-[11px] text-emerald-300 border border-border/50">
                {GDRIVE_SCRIPT_TEMPLATE}
              </pre>
            </div>

            {/* Step 3 */}
            <div className="space-y-1">
              <div className="font-medium text-foreground">
                3. Triển khai Web App và lấy Webhook URL:
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] text-muted-foreground ml-1">
                <li>Bấm nút màu xanh <strong>Triển khai (Deploy)</strong> ở góc trên bên phải &gt; chọn <strong>Tùy chọn triển khai mới (New deployment)</strong>.</li>
                <li>Bấm biểu tượng bánh răng ⚙️ cạnh <em>Chọn loại</em> &gt; chọn <strong>Ứng dụng web (Web app)</strong>.</li>
                <li>Thực thi dưới dạng (Execute as): chọn <strong>Tôi (Me)</strong>.</li>
                <li>Ai có quyền truy cập (Who has access): chọn <strong>Bất kỳ ai (Anyone)</strong> *(Rất quan trọng)*.</li>
                <li>Bấm <strong>Triển khai (Deploy)</strong> &gt; Cho phép quyền Google Drive &gt; <strong>Sao chép URL ứng dụng web (Web app URL)</strong> kết thúc bằng <code>/exec</code>.</li>
              </ul>
            </div>
          </div>

          {/* Webhook Input */}
          <div className="space-y-2">
            <label className="font-semibold text-foreground text-xs block">
              Dán Webhook URL Google Apps Script của bạn vào đây:
            </label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/AKfycb.../exec"
              className="h-9 text-xs font-mono"
            />
            {error && (
              <div className="text-[11px] text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-border/70 p-4 bg-secondary/20">
          <div>
            {isActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleSave("")}
                disabled={saving}
                className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                Hủy kết nối Drive
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="text-xs">
              Đóng
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => handleSave(url)}
              disabled={saving || !url.trim()}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs h-8 px-4"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              <span>{saving ? "Đang lưu..." : "Lưu Cấu Hình"}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
