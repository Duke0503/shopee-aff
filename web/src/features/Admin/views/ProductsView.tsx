import * as React from "react"
import { useQuery } from "@tanstack/react-query"
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
import { fetchAdminProducts } from "@/lib/api"
import { shortDate, vnd } from "@/lib/format"
import {
  Search,
  ExternalLink,
  Copy,
  Check,
  Flame,
  Clock,
} from "lucide-react"
import { PaginationBar } from "@/features/Admin/components/PaginationBar"
import { AdminTableLayout } from "@/features/Admin/components/AdminTableLayout"
import { CustomerHoverCard } from "@/features/Admin/components/CustomerHoverCard"
import { BuyerHoverCard } from "@/features/Admin/components/BuyerHoverCard"
import { SortableHeader } from "@/features/Admin/components/SortableHeader"
import { EmptyDash } from "@/features/Admin/components/EmptyDash"
import { CodeBadge } from "@/features/Admin/components/CodeBadge"
import { ProductThumbnail } from "@/features/Admin/components/ProductThumbnail"

export function ProductsView() {
  const [page, setPage] = React.useState(1)
  const [limit, setLimit] = React.useState(20)
  const [searchTerm, setSearchTerm] = React.useState("")
  const [sortBy, setSortBy] = React.useState<string>("requests")
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc")
  const [copiedId, setCopiedId] = React.useState<string | null>(null)

  const handleSort = (column: string, order: "asc" | "desc") => {
    setSortBy(column)
    setSortOrder(order)
    setPage(1)
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admin-products", page, limit, searchTerm, sortBy, sortOrder],
    queryFn: () =>
      fetchAdminProducts({
        page,
        limit,
        search: searchTerm,
        sort_by: sortBy,
        sort_order: sortOrder,
      }),
  })

  const products = data?.products || []
  const pagination = data?.pagination || {
    page,
    limit,
    total: products.length,
    total_pages: Math.ceil(products.length / limit) || 1,
  }

  const copyToClipboard = (url: string, id: string) => {
    navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const toolbar = (
    <Card className="p-3">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value)
            setPage(1)
          }}
          placeholder="Tìm kiếm sản phẩm theo tên hoặc mã Shopee..."
          className="pl-9 text-xs sm:text-sm"
        />
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
      isEmpty={products.length === 0}
      loadingMessage="Đang tải dữ liệu sản phẩm cache..."
      emptyMessage="Không tìm thấy sản phẩm nào trong kho cache."
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-secondary/95 backdrop-blur-xs">
          <TableRow>
            <TableHead className="min-w-[220px]">
              <SortableHeader
                title="Sản Phẩm"
                column="name"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                defaultOrder="asc"
              />
            </TableHead>
            <TableHead className="whitespace-nowrap">Mã Shopee</TableHead>
            <TableHead className="text-right whitespace-nowrap">
              <SortableHeader
                title="Giá Bán"
                column="price"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                align="right"
              />
            </TableHead>
            <TableHead className="text-right whitespace-nowrap text-orange-600 dark:text-orange-400">
              <SortableHeader
                title="Hoa Hồng Sàn"
                column="shopee_rate"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                align="right"
              />
            </TableHead>
            <TableHead className="text-right whitespace-nowrap text-indigo-600 dark:text-indigo-400">
              <SortableHeader
                title="Hoa Hồng Shop"
                column="seller_rate"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                align="right"
              />
            </TableHead>
            <TableHead className="text-right whitespace-nowrap">
              <SortableHeader
                title="Tổng Hoa Hồng"
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
            <TableHead className="text-center whitespace-nowrap">
              <SortableHeader
                title="Lượt Hỏi"
                column="requests"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                align="center"
              />
            </TableHead>
            <TableHead className="whitespace-nowrap">Người Hỏi (Khách)</TableHead>
            <TableHead className="whitespace-nowrap">
              <SortableHeader
                title="Thời Gian Hỏi"
                column="last_requested_at"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
              />
            </TableHead>
            <TableHead className="text-center whitespace-nowrap">
              <SortableHeader
                title="Lượt Mua"
                column="orders"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
                align="center"
              />
            </TableHead>
            <TableHead className="whitespace-nowrap">Người Mua (Khách)</TableHead>
            <TableHead className="whitespace-nowrap">
              <SortableHeader
                title="Cập Nhật Cuối"
                column="updated_at"
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onSort={handleSort}
              />
            </TableHead>
            <TableHead className="text-right whitespace-nowrap">Liên Kết</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => {
            const isHot = (p.request_count || 1) >= 3

            return (
              <TableRow key={p.item_id}>
                {/* Sản Phẩm */}
                <TableCell className="min-w-[220px] max-w-[320px]">
                  <div className="flex items-center gap-2.5">
                    <ProductThumbnail src={p.image_url} alt={p.name} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-foreground truncate text-xs" title={p.name}>
                        {p.name}
                      </div>
                    </div>
                  </div>
                </TableCell>

                {/* Mã Shopee */}
                <TableCell className="whitespace-nowrap">
                  <CodeBadge code={p.item_id} label="SP:" />
                </TableCell>

                {/* Giá Bán */}
                <TableCell className="text-right text-xs font-mono font-medium text-foreground whitespace-nowrap">
                  <EmptyDash value={p.price_formatted} />
                </TableCell>

                {/* Hoa Hồng Sàn (Shopee) */}
                <TableCell className="text-right text-xs font-mono whitespace-nowrap">
                  <div className="font-semibold text-orange-600 dark:text-orange-400">
                    {p.shopee_rate ? `${p.shopee_rate}%` : "--"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    <EmptyDash value={p.shopee_part_formatted || (p.shopee_part ? vnd(p.shopee_part) : null)} />
                  </div>
                </TableCell>

                {/* Hoa Hồng Shop */}
                <TableCell className="text-right text-xs font-mono whitespace-nowrap">
                  <div className="font-semibold text-indigo-600 dark:text-indigo-400">
                    {p.seller_rate && p.seller_rate > 0 ? `${p.seller_rate}%` : "--"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {p.seller_rate && p.seller_rate > 0 ? (
                      p.seller_part_formatted || (p.seller_part ? vnd(p.seller_part) : "--")
                    ) : (
                      <span className="text-muted-foreground/50">0đ</span>
                    )}
                  </div>
                </TableCell>

                {/* Tổng Hoa Hồng (Gộp) */}
                <TableCell className="text-right text-xs font-mono whitespace-nowrap">
                  <div className="font-bold text-amber-600 dark:text-amber-400">
                    <EmptyDash value={p.commission_formatted} />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-sans">
                    (Gộp 100%)
                  </span>
                </TableCell>

                {/* Hoàn Tiền Khách */}
                <TableCell className="text-right text-xs font-mono whitespace-nowrap">
                  <div className="font-bold text-emerald-600 dark:text-emerald-400">
                    <EmptyDash value={p.cashback_formatted} />
                  </div>
                  <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 font-sans">
                    80% thực nhận
                  </span>
                </TableCell>

                {/* Lượt Hỏi */}
                <TableCell className="text-center whitespace-nowrap">
                  {isHot ? (
                    <Badge variant="default" className="bg-amber-500 text-white">
                      <Flame className="mr-1 h-3 w-3" /> {p.request_count} lượt
                    </Badge>
                  ) : (p.request_count || 0) > 0 ? (
                    <Badge variant="secondary" className="font-mono text-[11px]">
                      {p.request_count}
                    </Badge>
                  ) : (
                    <EmptyDash value={0} />
                  )}
                </TableCell>

                {/* Requesters Column with Customer Profile Tooltip */}
                <TableCell className="min-w-[160px]">
                  <CustomerHoverCard requesters={p.requesters || []} />
                </TableCell>

                {/* Thời Gian Hỏi Cuối */}
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap font-mono">
                  {p.last_requested_at ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-foreground/90">
                      <Clock className="h-3 w-3 text-primary/70 shrink-0" />
                      <span>{shortDate(p.last_requested_at)}</span>
                    </div>
                  ) : (
                    <EmptyDash value={null} />
                  )}
                </TableCell>

                {/* Lượt Mua */}
                <TableCell className="text-center whitespace-nowrap">
                  {(p.order_count || 0) > 0 ? (
                    <Badge variant="success" className="font-bold text-[11px]">
                      {p.order_count} đơn
                    </Badge>
                  ) : (
                    <EmptyDash value={0} />
                  )}
                </TableCell>

                {/* Buyers Column with Order & Buyer Profile Tooltip */}
                <TableCell className="min-w-[160px]">
                  <BuyerHoverCard buyers={p.buyers || []} />
                </TableCell>

                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {shortDate(p.updated_at)}
                </TableCell>

                <TableCell className="text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1.5">
                    {p.affiliate_url && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(p.affiliate_url, p.item_id)}
                        className="h-7 px-2 text-xs"
                        title="Sao chép link Affiliate rút gọn"
                      >
                        {copiedId === p.item_id ? (
                          <>
                            <Check className="mr-1 h-3 w-3 text-emerald-500" /> Đã chép
                          </>
                        ) : (
                          <>
                            <Copy className="mr-1 h-3 w-3" /> Link Aff
                          </>
                        )}
                      </Button>
                    )}
                    {p.canonical_url && (
                      <a
                        href={p.canonical_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center rounded-md border border-border/80 px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                        title="Mở trên Shopee"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </AdminTableLayout>
  )
}
