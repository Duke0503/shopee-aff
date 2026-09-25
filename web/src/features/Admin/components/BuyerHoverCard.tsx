import * as React from "react"
import { createPortal } from "react-dom"
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
  Users,
} from "lucide-react"
import { EmptyDash } from "@/features/Admin/components/EmptyDash"

interface BuyerHoverCardProps {
  buyers: ProductBuyer[]
}

export function BuyerHoverCard({ buyers }: BuyerHoverCardProps) {
  const [activeBuyer, setActiveBuyer] = React.useState<ProductBuyer | null>(null)
  const [buyerPos, setBuyerPos] = React.useState<{
    top: number
    left: number
    placement: "above" | "below"
  } | null>(null)

  const [showOverflow, setShowOverflow] = React.useState(false)
  const [overflowPos, setOverflowPos] = React.useState<{
    top: number
    left: number
    placement: "above" | "below"
  } | null>(null)

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const scheduleClose = () => {
    cancelClose()
    timeoutRef.current = setTimeout(() => {
      setActiveBuyer(null)
      setBuyerPos(null)
      setShowOverflow(false)
      setOverflowPos(null)
    }, 150)
  }

  React.useEffect(() => {
    return () => cancelClose()
  }, [])

  if (!buyers || buyers.length === 0) {
    return <EmptyDash value={null} />
  }

  const computePos = (el: HTMLElement, estimatedHeight = 320, width = 340) => {
    const rect = el.getBoundingClientRect()
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom
    const showAbove = spaceAbove >= estimatedHeight || spaceAbove > spaceBelow

    return {
      top: showAbove ? rect.top - 8 : rect.bottom + 8,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      placement: showAbove ? ("above" as const) : ("below" as const),
    }
  }

  const handleBuyerEnter = (b: ProductBuyer, e: React.MouseEvent<HTMLDivElement>) => {
    cancelClose()
    setShowOverflow(false)
    setOverflowPos(null)
    setActiveBuyer(b)
    setBuyerPos(computePos(e.currentTarget, 320, 340))
  }

  const handleOverflowEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    cancelClose()
    setActiveBuyer(null)
    setBuyerPos(null)
    setShowOverflow(true)
    setOverflowPos(computePos(e.currentTarget, 360, 360))
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
  const overflowBuyers = uniqueBuyers.slice(2)
  const overflow = overflowBuyers.length

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
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map(({ buyer, count }) => {
        const name = buyer.display_name || buyer.customer_id

        return (
          <div
            key={buyer.customer_id}
            onMouseEnter={(e) => handleBuyerEnter(buyer, e)}
            onMouseLeave={scheduleClose}
            className="group relative inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 transition-all hover:border-emerald-500 hover:bg-emerald-500/20 whitespace-nowrap shrink-0"
          >
            <ShoppingBag className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="max-w-[130px] truncate leading-tight">{name}</span>
            {count > 1 && (
              <span className="rounded-full bg-emerald-600/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 whitespace-nowrap leading-none shrink-0">
                {count} đơn
              </span>
            )}
          </div>
        )
      })}

      {overflow > 0 && (
        <div
          onMouseEnter={handleOverflowEnter}
          onMouseLeave={scheduleClose}
          onClick={(e) => {
            cancelClose()
            setShowOverflow((prev) => !prev)
            setOverflowPos(computePos(e.currentTarget, 360, 360))
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 transition-all hover:bg-emerald-500/25 hover:border-emerald-500 shrink-0 shadow-2xs"
          title={`Click hoặc rê chuột để xem chi tiết ${overflow} người mua khác`}
        >
          <Users className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          <span>+{overflow} người</span>
        </div>
      )}

      {/* Floating Single Buyer Tooltip Card */}
      {activeBuyer && buyerPos && createPortal(
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className={`fixed z-[9999] w-80 max-w-[calc(100vw-32px)] rounded-xl border border-border/90 bg-popover/98 p-3.5 text-xs text-popover-foreground shadow-2xl backdrop-blur-md transition-all animate-in fade-in-0 zoom-in-95 ${
            buyerPos.placement === "above" ? "-translate-y-full" : ""
          }`}
          style={{
            top: `${buyerPos.top}px`,
            left: `${buyerPos.left}px`,
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
                <span>ID: {activeBuyer.customer_code || activeBuyer.customer_id}</span>
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
        </div>,
        document.body
      )}

      {/* Floating Overflow Buyers List Card */}
      {showOverflow && overflowPos && createPortal(
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className={`fixed z-[9999] w-[360px] max-w-[calc(100vw-32px)] rounded-xl border border-border/90 bg-popover/98 p-3.5 text-xs text-popover-foreground shadow-2xl backdrop-blur-md transition-all animate-in fade-in-0 zoom-in-95 ${
            overflowPos.placement === "above" ? "-translate-y-full" : ""
          }`}
          style={{
            top: `${overflowPos.top}px`,
            left: `${overflowPos.left}px`,
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <div className="font-bold text-foreground">
                  +{overflow} Người Mua Khác
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Danh sách khách hàng khác đã đặt mua sản phẩm này
                </div>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono">
              {overflow} khách
            </Badge>
          </div>

          {/* List of overflow buyers */}
          <div className="mt-2.5 max-h-72 space-y-2.5 overflow-y-auto pr-1">
            {overflowBuyers.map(({ buyer, count }) => {
              const name = buyer.display_name || buyer.customer_id
              const buyerOrders = buyers.filter((b) => b.customer_id === buyer.customer_id)

              return (
                <div
                  key={buyer.customer_id}
                  className="rounded-lg border border-border/70 bg-secondary/30 p-2.5 text-[11px]"
                >
                  {/* Buyer header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                        {name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate max-w-[170px]">
                          {name}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          ID: {buyer.customer_code || buyer.customer_id}
                        </div>
                      </div>
                    </div>
                    <Badge variant="default" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] py-0">
                      {count} đơn
                    </Badge>
                  </div>

                  {/* Bank info */}
                  <div className="mt-1.5 text-[10px]">
                    {buyer.bank_name && buyer.bank_account ? (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <CreditCard className="h-3 w-3 text-primary shrink-0" />
                        <span className="font-medium text-foreground">{buyer.bank_name}:</span>
                        <span className="font-mono">{buyer.bank_account}</span>
                        {buyer.account_holder && <span>({buyer.account_holder})</span>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        <span>Chưa liên kết ngân hàng</span>
                      </div>
                    )}
                  </div>

                  {/* Orders */}
                  <div className="mt-2 space-y-1 border-t border-border/40 pt-1.5">
                    {buyerOrders.map((ord) => (
                      <div
                        key={ord.order_id}
                        className="flex items-center justify-between text-[10px]"
                      >
                        <div className="flex items-center gap-1.5 font-mono">
                          <span className="text-muted-foreground">#{ord.order_id}</span>
                          {renderStatusBadge(ord.status)}
                        </div>
                        <div className="text-right">
                          <span className="font-mono font-medium text-foreground">
                            {ord.order_value ? vnd(ord.order_value) : "-"}
                          </span>
                          <span className="text-muted-foreground mx-1">·</span>
                          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            +{ord.cashback_amount ? vnd(ord.cashback_amount) : "-"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
