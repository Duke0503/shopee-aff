import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { fetchAdminUsers, type AdminUser } from "@/lib/api"
import { vnd, shortDate } from "@/lib/format"
import {
  Search,
  CreditCard,
  Clock,
  AlertTriangle,
  Package,
  ExternalLink,
  Calendar,
  Bot,
  Eye,
  Banknote,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { PaginationBar } from "@/features/Admin/components/PaginationBar"
import { AdminTableLayout } from "@/features/Admin/components/AdminTableLayout"
import { SortableHeader } from "@/features/Admin/components/SortableHeader"
import { UserDetailDialog } from "@/features/Admin/components/UserDetailDialog"
import { EmptyDash } from "@/features/Admin/components/EmptyDash"

export function UsersView() {
  const [page, setPage] = React.useState(1)
  const [limit, setLimit] = React.useState(20)
  const [searchTerm, setSearchTerm] = React.useState("")
  const [filterBank, setFilterBank] = React.useState<"all" | "has_bank" | "no_bank">("all")
  const [sortBy, setSortBy] = React.useState<string>("last_login")
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc")
  const [hoveredUser, setHoveredUser] = React.useState<AdminUser | null>(null)
  const [tooltipPos, setTooltipPos] = React.useState<{ top: number; left: number } | null>(null)
  const [selectedUser, setSelectedUser] = React.useState<AdminUser | null>(null)

  const handleSort = (column: string, order: "asc" | "desc") => {
    setSortBy(column)
    setSortOrder(order)
    setPage(1)
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", page, limit, searchTerm, filterBank, sortBy, sortOrder],
    queryFn: () =>
      fetchAdminUsers({
        page,
        limit,
        search: searchTerm,
        bank: filterBank,
        sort_by: sortBy,
        sort_order: sortOrder,
      }),
  })

  const users = data?.users || []
  const pagination = data?.pagination || {
    page,
    limit,
    total: users.length,
    total_pages: Math.ceil(users.length / limit) || 1,
  }

  const handleMouseEnter = (u: AdminUser, e: React.MouseEvent<HTMLDivElement>) => {
    if (u.recent_requests && u.recent_requests.length > 0) {
      const rect = e.currentTarget.getBoundingClientRect()
      setHoveredUser(u)
      setTooltipPos({
        top: rect.bottom + 6,
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 340)),
      })
    }
  }

  const handleMouseLeave = () => {
    setHoveredUser(null)
    setTooltipPos(null)
  }

  const toolbar = (
    <Card className="p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setPage(1)
            }}
            placeholder="Tìm theo tên, ID khách, Zalo ID, số tài khoản..."
            className="pl-9 text-xs sm:text-sm"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setFilterBank("all")
              setPage(1)
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filterBank === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Tất cả ({pagination.total})
          </button>
          <button
            onClick={() => {
              setFilterBank("has_bank")
              setPage(1)
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filterBank === "has_bank"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Đã có TK ngân hàng
          </button>
          <button
            onClick={() => {
              setFilterBank("no_bank")
              setPage(1)
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filterBank === "no_bank"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Chưa có ngân hàng
          </button>
        </div>
      </div>
    </Card>
  )

  const paginationBar = pagination.total > 0 ? (
    <PaginationBar
      page={pagination.page}
      totalPages={pagination.total_pages}
      totalItems={pagination.total}
      limit={pagination.limit}
      onPageChange={setPage}
      onLimitChange={(newLimit) => {
        setLimit(newLimit)
        setPage(1)
      }}
    />
  ) : null

  return (
    <>
      <AdminTableLayout
        toolbar={toolbar}
        pagination={paginationBar}
        isLoading={isLoading}
        isEmpty={users.length === 0}
        loadingMessage="Đang tải danh sách khách hàng..."
        emptyMessage="Không tìm thấy khách hàng nào phù hợp với bộ lọc."
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-secondary/95 backdrop-blur-xs">
            <TableRow>
              <TableHead className="min-w-[170px]">
                <SortableHeader
                  title="Khách Hàng"
                  column="name"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                  defaultOrder="asc"
                />
              </TableHead>
              <TableHead className="whitespace-nowrap">Ngân Hàng Nhận Tiền</TableHead>
              <TableHead className="whitespace-nowrap">
                <SortableHeader
                  title="Ngày Tham Gia"
                  column="created_at"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="whitespace-nowrap">
                <SortableHeader
                  title="Hỏi Bot Cuối"
                  column="last_bot_activity"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="whitespace-nowrap">
                <SortableHeader
                  title="Vào Web Cuối"
                  column="last_login"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className="text-center whitespace-nowrap">
                <SortableHeader
                  title="Số Đơn"
                  column="orders"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                  align="center"
                />
              </TableHead>
              <TableHead className="text-right whitespace-nowrap">
                <SortableHeader
                  title="Tổng Tiền Aff"
                  column="total_cashback"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                  align="right"
                />
              </TableHead>
              <TableHead className="text-right whitespace-nowrap">
                <SortableHeader
                  title="Chờ Duyệt"
                  column="awaiting_amount"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                  align="right"
                />
              </TableHead>
              <TableHead className="text-right whitespace-nowrap">
                <SortableHeader
                  title="Có Thể Nhận"
                  column="ready_amount"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                  align="right"
                />
              </TableHead>
              <TableHead className="text-right whitespace-nowrap">
                <SortableHeader
                  title="Đã Chuyển"
                  column="paid_amount"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                  align="right"
                />
              </TableHead>
              <TableHead className="text-center whitespace-nowrap">Chi Tiết</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const hasBank = !!(u.bank_name && u.bank_account)
              const hasRequests = u.recent_requests && u.recent_requests.length > 0
              const canPayout = (u.ready_amount || 0) > 0

              return (
                <TableRow key={u.customer_id} className="hover:bg-muted/30 transition-colors">
                  <TableCell>
                    <div
                      onClick={() => setSelectedUser(u)}
                      onMouseEnter={(e) => handleMouseEnter(u, e)}
                      onMouseLeave={handleMouseLeave}
                      className="group cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-foreground group-hover:text-primary transition-colors">
                        <span>{u.display_name || u.customer_id}</span>
                        {hasRequests && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] text-primary" title="Hover để xem sản phẩm đã hỏi">
                            {u.recent_requests!.length} SP
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        ID: <span className="font-mono">{u.customer_id}</span>
                        {u.zalo_user_id && ` · Zalo: ${u.zalo_user_id.slice(0, 10)}...`}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    {hasBank ? (
                      <div className="text-xs">
                        <div className="flex items-center gap-1 font-medium text-foreground">
                          <CreditCard className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="truncate max-w-[130px]">{u.bank_name}</span>
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground truncate max-w-[150px]">
                          {u.bank_account} {u.account_holder ? `(${u.account_holder})` : ""}
                        </div>
                      </div>
                    ) : (
                      <Badge variant="warning" className="text-[10px]">
                        <AlertTriangle className="mr-1 h-3 w-3" /> Chưa liên kết
                      </Badge>
                    )}
                  </TableCell>

                  {/* Ngày Tham Gia */}
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5 opacity-70" />
                      <span>{u.created_at ? shortDate(u.created_at) : "—"}</span>
                    </div>
                  </TableCell>

                  {/* Hỏi Bot Cuối */}
                  <TableCell className="whitespace-nowrap">
                    {u.last_bot_activity ? (
                      <div className="flex items-center gap-1 text-xs text-foreground">
                        <Bot className="h-3.5 w-3.5 text-blue-500" />
                        <span>{shortDate(u.last_bot_activity)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Chưa hỏi bot</span>
                    )}
                  </TableCell>

                  {/* Vào Web Cuối */}
                  <TableCell className="whitespace-nowrap">
                    {u.last_login_at ? (
                      <div className="flex items-center gap-1 text-xs text-foreground">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{shortDate(u.last_login_at)}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground font-mono">({u.login_count || 0} lần)</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Chưa đăng nhập</span>
                    )}
                  </TableCell>

                  {/* Số Đơn */}
                  <TableCell className="text-center whitespace-nowrap">
                    <EmptyDash value={u.order_count} className="font-semibold text-foreground" />
                  </TableCell>

                  {/* Tổng Tiền Aff */}
                  <TableCell className="text-right whitespace-nowrap">
                    <EmptyDash value={u.total_cashback} type="currency" className="font-semibold text-blue-600 dark:text-blue-400" />
                  </TableCell>

                  {/* Chờ Duyệt */}
                  <TableCell className="text-right whitespace-nowrap">
                    <EmptyDash value={u.awaiting_amount} type="currency" className="font-medium text-amber-600 dark:text-amber-400" />
                  </TableCell>

                  {/* Có Thể Nhận */}
                  <TableCell className="text-right whitespace-nowrap">
                    {canPayout ? (
                      <span className="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded font-bold">
                        {vnd(u.ready_amount || 0)}
                      </span>
                    ) : (
                      <EmptyDash value={0} />
                    )}
                  </TableCell>

                  {/* Đã Chuyển */}
                  <TableCell className="text-right whitespace-nowrap">
                    <EmptyDash value={u.paid_amount} type="currency" className="font-medium text-foreground" />
                  </TableCell>

                  {/* Chi Tiết / Chuyển Khoản Button */}
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1.5">
                      {canPayout && (
                        <Button
                          size="sm"
                          variant="success"
                          onClick={() => setSelectedUser(u)}
                          className="h-7 px-2 text-[11px] gap-1 shadow-xs"
                          title="Chuyển khoản ngay"
                        >
                          <Banknote className="h-3 w-3" /> Chuyển tiền
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedUser(u)}
                        className="h-7 w-7 p-0"
                        title="Xem chi tiết lịch sử mua hàng, ấn link & chuyển khoản"
                      >
                        <Eye className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </AdminTableLayout>

      {/* Floating Hover Tooltip for Customer's Recently Asked Products */}
      {hoveredUser && tooltipPos && hoveredUser.recent_requests && (
        <div
          className="pointer-events-none fixed z-50 w-80 rounded-xl border border-border/90 bg-popover/95 p-3.5 text-xs text-popover-foreground shadow-xl backdrop-blur-md transition-all animate-in fade-in-0 zoom-in-95"
          style={{
            top: `${tooltipPos.top}px`,
            left: `${tooltipPos.left}px`,
          }}
        >
          <div className="flex items-center gap-2 border-b border-border/60 pb-2">
            <Package className="h-4 w-4 text-primary" />
            <span className="font-bold text-foreground">
              Sản phẩm {hoveredUser.display_name || hoveredUser.customer_id} đã hỏi:
            </span>
          </div>

          <div className="mt-2 space-y-2">
            {hoveredUser.recent_requests.map((r, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-border/70 bg-secondary/30 p-2 text-[11px]"
              >
                <div className="line-clamp-2 font-medium text-foreground" title={r.name}>
                  {r.name}
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{shortDate(r.created_at)}</span>
                  {r.affiliate_url && (
                    <span className="inline-flex items-center text-primary">
                      Đã tạo link <ExternalLink className="ml-0.5 h-2.5 w-2.5" />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* User Detail & Payment Transfer Modal */}
      <UserDetailDialog
        user={selectedUser}
        open={!!selectedUser}
        onOpenChange={(open) => !open && setSelectedUser(null)}
      />
    </>
  )
}
