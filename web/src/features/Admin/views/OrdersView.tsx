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
  fetchAdminOrders,
  markAdminOrderPaid,
  type AdminOrder,
} from "@/lib/api"
import { shortDate } from "@/lib/format"
import {
  Search,
  ExternalLink,
  CheckCircle2,
  Clock,
  PackageCheck,
  XCircle,
  Banknote,
} from "lucide-react"
import { PaginationBar } from "@/features/Admin/components/PaginationBar"
import { AdminTableLayout } from "@/features/Admin/components/AdminTableLayout"
import { SortableHeader } from "@/features/Admin/components/SortableHeader"
import { EmptyDash } from "@/features/Admin/components/EmptyDash"

export function OrdersView() {
  const queryClient = useQueryClient()
  const [page, setPage] = React.useState(1)
  const [limit, setLimit] = React.useState(20)
  const [searchTerm, setSearchTerm] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [sortBy, setSortBy] = React.useState<string>("date")
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc")

  const handleSort = (column: string, order: "asc" | "desc") => {
    setSortBy(column)
    setSortOrder(order)
    setPage(1)
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orders", page, limit, searchTerm, statusFilter, sortBy, sortOrder],
    queryFn: () =>
      fetchAdminOrders({
        page,
        limit,
        search: searchTerm,
        status: statusFilter,
        sort_by: sortBy,
        sort_order: sortOrder,
      }),
  })

  const payMutation = useMutation({
    mutationFn: ({ customerId, orderIds }: { customerId: string; orderIds: string[] }) =>
      markAdminOrderPaid(customerId, orderIds),
    onSuccess: (res) => {
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["admin-orders"] })
        queryClient.invalidateQueries({ queryKey: ["admin-metrics"] })
        queryClient.invalidateQueries({ queryKey: ["admin-users"] })
      } else {
        alert(res.message || "Xử lý thất bại")
      }
    },
  })

  const orders = data?.orders || []
  const pagination = data?.pagination || {
    page,
    limit,
    total: orders.length,
    total_pages: Math.ceil(orders.length / limit) || 1,
  }

  const renderStatus = (status: AdminOrder["status"]) => {
    switch (status) {
      case "awaiting_approval":
        return (
          <Badge variant="warning">
            <Clock className="mr-1 h-3 w-3" /> Chờ Shopee đối soát
          </Badge>
        )
      case "approved":
        return (
          <Badge variant="info">
            <PackageCheck className="mr-1 h-3 w-3" /> Đã duyệt (Chờ chi trả)
          </Badge>
        )
      case "paid":
        return (
          <Badge variant="success">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Đã hoàn tiền
          </Badge>
        )
      case "rejected":
        return (
          <Badge variant="danger">
            <XCircle className="mr-1 h-3 w-3" /> Shopee từ chối
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
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
            placeholder="Tìm theo mã đơn, khách hàng, tên sản phẩm..."
            className="pl-9 text-xs sm:text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setStatusFilter("all")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Tất cả ({pagination.total})
          </button>
          <button
            onClick={() => {
              setStatusFilter("awaiting_approval")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "awaiting_approval"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Chờ đối soát
          </button>
          <button
            onClick={() => {
              setStatusFilter("approved")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "approved"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Đã duyệt (Chờ hoàn)
          </button>
          <button
            onClick={() => {
              setStatusFilter("paid")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "paid"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Đã hoàn tiền
          </button>
          <button
            onClick={() => {
              setStatusFilter("rejected")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "rejected"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Từ chối / Hủy
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
    <AdminTableLayout
      toolbar={toolbar}
      pagination={paginationBar}
      isLoading={isLoading}
      isEmpty={orders.length === 0}
      loadingMessage="Đang tải dữ liệu đơn hàng..."
      emptyMessage="Không tìm thấy đơn hàng nào phù hợp với bộ lọc."
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-secondary/95 backdrop-blur-xs">
          <TableRow>
            <TableHead className="min-w-[180px]">
              <SortableHeader
                title="Mã Đơn / Khách Hàng"
                column="customer"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                defaultOrder="asc"
              />
            </TableHead>
            <TableHead className="min-w-[200px]">Sản Phẩm</TableHead>
            <TableHead className="text-right whitespace-nowrap">
              <SortableHeader
                title="Giá Trị Đơn"
                column="order_value"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                align="right"
              />
            </TableHead>
            <TableHead className="text-right whitespace-nowrap">
              <SortableHeader
                title="Hoa Hồng Shopee"
                column="commission"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                align="right"
              />
            </TableHead>
            <TableHead className="text-right whitespace-nowrap">
              <SortableHeader
                title="Hoàn Tiền Khách"
                column="cashback"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                align="right"
              />
            </TableHead>
            <TableHead className="whitespace-nowrap">
              <SortableHeader
                title="Trạng Thái"
                column="status"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
              />
            </TableHead>
            <TableHead className="whitespace-nowrap">
              <SortableHeader
                title="Ngày Đặt"
                column="date"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
              />
            </TableHead>
            <TableHead className="text-right whitespace-nowrap">Hành Động</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => {
            const canPay = o.status === "approved" && !o.paid_at
            const commission = o.approved_commission || o.estimated_commission
            const cashback = o.cashback_amount

            return (
              <TableRow key={o.order_id}>
                <TableCell>
                  <div className="font-mono font-semibold text-foreground">
                    {o.order_id}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {o.customer_name ? (
                      <span className="font-medium text-foreground">{o.customer_name}</span>
                    ) : null}
                    <span className="font-mono"> ({o.customer_id})</span>
                  </div>
                </TableCell>

                <TableCell className="max-w-[280px]">
                  <div className="line-clamp-2 text-xs font-medium text-foreground" title={o.product}>
                    {o.product || "Đơn hàng Shopee"}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    {o.source_url && (
                      <a
                        href={o.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-muted-foreground hover:text-foreground"
                      >
                        Shopee <ExternalLink className="ml-0.5 h-3 w-3" />
                      </a>
                    )}
                    {o.affiliate_url && (
                      <a
                        href={o.affiliate_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-primary hover:underline"
                      >
                        Link Aff <ExternalLink className="ml-0.5 h-3 w-3" />
                      </a>
                    )}
                  </div>
                </TableCell>

                <TableCell className="text-right font-medium text-foreground whitespace-nowrap">
                  <EmptyDash value={o.order_value} type="currency" />
                </TableCell>

                <TableCell className="text-right font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">
                  <EmptyDash value={commission} type="currency" />
                </TableCell>

                <TableCell className="text-right font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                  <EmptyDash value={cashback} type="currency" />
                </TableCell>

                <TableCell className="whitespace-nowrap">{renderStatus(o.status)}</TableCell>

                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {shortDate(o.recorded_at || o.approved_at)}
                </TableCell>

                <TableCell className="text-right whitespace-nowrap">
                  {canPay ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        payMutation.mutate({
                          customerId: o.customer_id,
                          orderIds: [o.order_id],
                        })
                      }
                      disabled={payMutation.isPending}
                      className="h-7 bg-emerald-600 px-2.5 text-[11px] text-white hover:bg-emerald-700"
                    >
                      <Banknote className="mr-1 h-3.5 w-3.5" /> Hoàn Tiền
                    </Button>
                  ) : o.paid_at ? (
                    <span className="text-[11px] text-muted-foreground">
                      Đã thanh toán
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </AdminTableLayout>
  )
}
