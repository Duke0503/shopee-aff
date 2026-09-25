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
import { fetchAdminLogs } from "@/lib/api"
import { shortDate } from "@/lib/format"
import {
  Search,
  Activity,
  LogIn,
  Link2,
  UserPlus,
  MessageSquare,
  Bot,
} from "lucide-react"
import { PaginationBar } from "@/features/Admin/components/PaginationBar"
import { AdminTableLayout } from "@/features/Admin/components/AdminTableLayout"
import { SortableHeader } from "@/features/Admin/components/SortableHeader"

export function LogsView() {
  const [page, setPage] = React.useState(1)
  const [limit, setLimit] = React.useState(20)
  const [searchTerm, setSearchTerm] = React.useState("")
  const [actionFilter, setActionFilter] = React.useState<string>("all")
  const [sortBy, setSortBy] = React.useState<string>("date")
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc")

  const handleSort = (column: string, order: "asc" | "desc") => {
    setSortBy(column)
    setSortOrder(order)
    setPage(1)
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admin-logs", page, limit, searchTerm, actionFilter, sortBy, sortOrder],
    queryFn: () =>
      fetchAdminLogs({
        page,
        limit,
        search: searchTerm,
        action: actionFilter,
        sort_by: sortBy,
        sort_order: sortOrder,
      }),
  })

  const logs = data?.logs || []
  const pagination = data?.pagination || {
    page,
    limit,
    total: logs.length,
    total_pages: Math.ceil(logs.length / limit) || 1,
  }

  const renderActionBadge = (action: string) => {
    switch (action) {
      case "login":
        return (
          <Badge variant="info">
            <LogIn className="mr-1 h-3 w-3" /> Đăng nhập
          </Badge>
        )
      case "link_request":
        return (
          <Badge variant="default" className="bg-primary text-primary-foreground">
            <Link2 className="mr-1 h-3 w-3" /> Yêu cầu link
          </Badge>
        )
      case "group_join":
        return (
          <Badge variant="success">
            <UserPlus className="mr-1 h-3 w-3" /> Vào nhóm
          </Badge>
        )
      case "group_message":
        return (
          <Badge variant="warning">
            <MessageSquare className="mr-1 h-3 w-3" /> Chat nhóm
          </Badge>
        )
      case "bot_dm":
        return (
          <Badge variant="info">
            <Bot className="mr-1 h-3 w-3" /> Chat bot
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary">
            <Activity className="mr-1 h-3 w-3" /> {action}
          </Badge>
        )
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
            placeholder="Tìm theo hành động, ID khách, đường dẫn..."
            className="pl-9 text-xs sm:text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setActionFilter("all")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              actionFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Tất cả ({pagination.total})
          </button>
          <button
            onClick={() => {
              setActionFilter("group_join")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              actionFilter === "group_join"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Vào nhóm
          </button>
          <button
            onClick={() => {
              setActionFilter("group_message")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              actionFilter === "group_message"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Chat nhóm
          </button>
          <button
            onClick={() => {
              setActionFilter("bot_dm")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              actionFilter === "bot_dm"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Chat bot
          </button>
          <button
            onClick={() => {
              setActionFilter("link_request")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              actionFilter === "link_request"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Yêu cầu link
          </button>
          <button
            onClick={() => {
              setActionFilter("login")
              setPage(1)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              actionFilter === "login"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            Đăng nhập
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
      isEmpty={logs.length === 0}
      loadingMessage="Đang tải dữ liệu nhật ký..."
      emptyMessage="Chưa có ghi nhận nhật ký nào phù hợp."
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-secondary/95 backdrop-blur-xs">
          <TableRow>
            <TableHead className="whitespace-nowrap">
              <SortableHeader
                title="Thời Gian"
                column="date"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
              />
            </TableHead>
            <TableHead className="min-w-[180px]">
              <SortableHeader
                title="Tài Khoản / Khách Hàng"
                column="customer"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                defaultOrder="asc"
              />
            </TableHead>
            <TableHead className="whitespace-nowrap">
              <SortableHeader
                title="Hành Động"
                column="action"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                defaultOrder="asc"
              />
            </TableHead>
            <TableHead className="min-w-[240px]">Đường Dẫn / Chi Tiết</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((l) => (
            <TableRow key={l.log_id}>
              <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                {shortDate(l.created_at)}
              </TableCell>

              <TableCell className="whitespace-nowrap">
                <div className="font-semibold text-foreground">
                  {l.display_name || l.customer_id}
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {l.customer_code || l.customer_id}
                </div>
              </TableCell>

              <TableCell className="whitespace-nowrap">{renderActionBadge(l.action)}</TableCell>

              <TableCell className="max-w-[320px]">
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {l.path || l.detail || "-"}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminTableLayout>
  )
}
