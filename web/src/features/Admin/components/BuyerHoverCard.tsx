import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { vnd, shortDate } from "@/lib/format"
import type { ProductBuyer } from "@/lib/api"
import {
  ShoppingBag,
  CreditCard,
  Clock,
  CheckCircle2,
  PackageCheck,
  XCircle,
  AlertCircle,
} from "lucide-react"
import { EmptyDash } from "@/features/Admin/components/EmptyDash"

interface BuyerHoverCardProps {
  buyers: ProductBuyer[]
}

export function BuyerHoverCard({ buyers }: BuyerHoverCardProps) {
  const [activeBuyer, setActiveBuyer] = React.useState<ProductBuyer | null>(null)
  const [hoverPosition, setHoverPosition] = React.useState<{ top: number; left: number } | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  if (!buyers || buyers.length === 0) {
    return <EmptyDash value={null} />
  }

  const handleMouseEnter = (b: ProductBuyer, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setActiveBuyer(b)
    setHoverPosition({
      top: rect.top - 8,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - 340)),
    })
  }

  const handleMouseLeave = () => {
    setActiveBuyer(null)
    setHoverPosition(null)
  }

  // Deduplicate buyers by customer_id for badges
  const buyerMap = new Map<string, { buyer: ProductBuyer; count: number; totalGmv: number }>()
  for (const b of buyers) {
    const existing = buyerMap.get(b.customer_id)
    if (existing) {
      existing.count += 1
      existing.totalGmv += b.order_value || 0
    } else {
      buyerMap.set(b.customer_id, { buyer: b, count: 1, totalGmv: b.order_value || 0 })
    }
  }

  const uniqueBuyers = Array.from(buyerMap.values())
  const visible = uniqueBuyers.slice(0, 2)
  const overflow = uniqueBuyers.length - visible.length

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "awaiting_approval":
        return (
          <Badge variant="warning" className="text-[10px] px-1.5 py-0">
            <Clock className="mr-1 h-2.5 w-2.5" /> Chờ đối soát
          </Badge>
        )
      case "approved":
        return (
          <Badge variant="info" className="text-[10px] px-1.5 py-0">
            <PackageCheck className="mr-1 h-2.5 w-2.5" /> Đã duyệt
          </Badge>
        )
      case "paid":
        return (
          <Badge variant="success" className="text-[10px] px-1.5 py-0">
            <CheckCircle2 className="mr-1 h-2.5 w-2.5" /> Đã hoàn tiền
          </Badge>
        )
      case "rejected":
        return (
          <Badge variant="danger" className="text-[10px] px-1.5 py-0">
            <XCircle className="mr-1 h-2.5 w-2.5" /> Từ chối
          </Badge>
        )
      default:
        return <Badge variant="outline" className="text-[10px] px-1.5 py-0">{status}</Badge>
    }
  }

  return (
    <div ref={containerRef} className="flex flex-wrap items-center gap-1.5">
      {visible.map(({ buyer, count }) => {
        const name = buyer.display_name || buyer.customer_id

        return (
          <div
            key={buyer.customer_id}
            onMouseEnter={(e) => handleMouseEnter(buyer, e)}
            onMouseLeave={handleMouseLeave}
            className="group relative inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 transition-all hover:border-emerald-500 hover:bg-emerald-500/20"
          >
            <ShoppingBag className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <span className="max-w-[100px] truncate">{name}</span>
            {count > 1 && (
              <span className="rounded-full bg-emerald-600/20 px-1.5 py-0.2 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                {count} đơn
              </span>
            )}
          </div>
        )
      })}

      {overflow > 0 && (
        <Badge
          variant="secondary"
          className="text-[10px]"
          title={`${overflow} người khác cũng đã đặt mua`}
        >
          +{overflow} người
        </Badge>
      )}

      {/* Floating Hover Tooltip Card */}
      {activeBuyer && hoverPosition && (
        <div
          className="pointer-events-none fixed z-50 w-80 -translate-y-full rounded-xl border border-border/90 bg-popover/95 p-3.5 text-xs text-popover-foreground shadow-xl backdrop-blur-md transition-all animate-in fade-in-0 zoom-in-95"
          style={{
            top: `${hoverPosition.top}px`,
            left: `${hoverPosition.left}px`,
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-border/60 pb-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 font-bold text-emerald-600 dark:text-emerald-400 shadow-2xs">
              <ShoppingBag className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold text-foreground">
                {activeBuyer.display_name || activeBuyer.customer_id} (Người mua)
              </div>
              <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <span>ID: {activeBuyer.customer_id}</span>
                {activeBuyer.zalo_user_id && (
                  <span>· Zalo: {activeBuyer.zalo_user_id.slice(0, 8)}...</span>
                )}
              </div>
            </div>
          </div>

          {/* Body Information */}
          <div className="mt-2.5 space-y-2 text-[11px]">
            {/* Bank details */}
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                Tài khoản nhận tiền hoàn:
              </span>
              {activeBuyer.bank_name && activeBuyer.bank_account ? (
                <div className="mt-1 rounded-lg border border-border/70 bg-secondary/30 p-2">
                  <div className="flex items-center gap-1.5 font-bold text-foreground">
                    <CreditCard className="h-3.5 w-3.5 text-primary" />
                    <span>{activeBuyer.bank_name}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {activeBuyer.bank_account}{" "}
                    {activeBuyer.account_holder ? `(${activeBuyer.account_holder})` : ""}
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Chưa liên kết tài khoản ngân hàng</span>
                </div>
              )}
            </div>

            {/* Orders for this product */}
            <div className="border-t border-border/40 pt-2 space-y-2">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                Chi tiết đơn hàng đã mua:
              </span>
              {buyers
                .filter((b) => b.customer_id === activeBuyer.customer_id)
                .map((ord) => (
                  <div
                    key={ord.order_id}
                    className="rounded-lg border border-border/60 bg-secondary/40 p-2 text-[11px]"
                  >
                    <div className="flex items-center justify-between font-mono font-bold text-foreground">
                      <span>#{ord.order_id}</span>
                      {renderStatusBadge(ord.status)}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1 text-[10px]">
                      <div>
                        <span className="text-muted-foreground">Giá trị đơn: </span>
                        <strong className="text-foreground">{ord.order_value ? vnd(ord.order_value) : "-"}</strong>
                      </div>
                      <div className="text-right">
                        <span className="text-muted-foreground">Hoàn tiền: </span>
                        <strong className="text-emerald-600 dark:text-emerald-400">
                          {ord.cashback_amount ? vnd(ord.cashback_amount) : "-"}
                        </strong>
                      </div>
                    </div>
                    {ord.order_date && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Ngày đặt: {shortDate(ord.order_date)}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
