import * as React from "react"
import { vnd } from "@/lib/format"
import type { AdminOrder } from "@/lib/api"
import {
  TrendingUp,
  Info,
  DollarSign,
  Receipt,
  Gift,
  Building2,
  Store,
  HelpCircle,
  X,
} from "lucide-react"

interface OrderFinancialCardProps {
  order: AdminOrder
  trigger?: React.ReactNode
}

export function OrderFinancialCard({ order, trigger }: OrderFinancialCardProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [popupPos, setPopupPos] = React.useState<{ top: number; left: number } | null>(null)
  const triggerRef = React.useRef<HTMLDivElement>(null)

  const fin = order.financial_breakdown || {
    gross_commission: order.approved_commission || order.estimated_commission || 0,
    shopee_part: Math.round((order.approved_commission || order.estimated_commission || 0) * 0.4),
    seller_part: Math.round((order.approved_commission || order.estimated_commission || 0) * 0.6),
    service_fee: Math.round((order.approved_commission || order.estimated_commission || 0) * 0.0098),
    tax_amount: Math.round((order.approved_commission || order.estimated_commission || 0) * 0.10),
    net_shopee:
      (order.approved_commission || order.estimated_commission || 0) -
      Math.round((order.approved_commission || order.estimated_commission || 0) * 0.0098) -
      Math.round((order.approved_commission || order.estimated_commission || 0) * 0.10),
    cashback_amount: order.cashback_amount || 0,
    admin_profit:
      order.status === "rejected"
        ? 0
        : (order.approved_commission || order.estimated_commission || 0) -
          Math.round((order.approved_commission || order.estimated_commission || 0) * 0.0098) -
          Math.round((order.approved_commission || order.estimated_commission || 0) * 0.10) -
          (order.cashback_amount || 0),
    admin_margin: 9.0,
  }

  const isRejected = order.status === "rejected"

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isOpen) {
      setIsOpen(false)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const popoverWidth = 340
    let left = rect.right - popoverWidth
    if (left < 16) left = 16
    if (left + popoverWidth > window.innerWidth - 16) {
      left = window.innerWidth - popoverWidth - 16
    }
    const top = rect.bottom + 6
    setPopupPos({ top, left })
    setIsOpen(true)
  }

  React.useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className="relative inline-block" ref={triggerRef}>
      <div onClick={handleToggle} className="cursor-pointer">
        {trigger || (
          <div className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 hover:underline">
            <span>{isRejected ? "--" : vnd(fin.admin_profit)}</span>
            <Info className="h-3 w-3 opacity-70" />
          </div>
        )}
      </div>

      {isOpen && popupPos && (
        <div
          style={{ top: `${popupPos.top}px`, left: `${popupPos.left}px` }}
          className="fixed z-50 w-[340px] rounded-xl border border-border/80 bg-card p-4 shadow-xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150 text-left text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Receipt className="h-4 w-4" />
              </div>
              <div>
                <div className="font-bold text-foreground text-xs">Hạch Toán Lợi Nhuận Đơn</div>
                <div className="font-mono text-[10px] text-muted-foreground">Mã: {order.order_id}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Product name & GMV */}
          <div className="mt-2.5 space-y-1 rounded-lg bg-secondary/30 p-2 text-[11px]">
            <div className="line-clamp-1 font-medium text-foreground" title={order.product}>
              {order.product || "Đơn hàng Shopee"}
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Giá trị đơn (GMV):</span>
              <span className="font-mono font-semibold text-foreground">{vnd(order.order_value)}</span>
            </div>
          </div>

          {/* Breakdown Steps */}
          <div className="mt-3 space-y-2 text-[11px]">
            {/* Step 1: Gross Commission */}
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 space-y-1.5">
              <div className="flex items-center justify-between font-semibold text-amber-700 dark:text-amber-300">
                <span className="flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> 1. Hoa hồng gộp (Gross)
                </span>
                <span className="font-mono">{vnd(fin.gross_commission)}</span>
              </div>
              <div className="pl-4 space-y-1 text-[10px] text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> Sàn Shopee trả (Base):
                  </span>
                  <span className="font-mono">{vnd(fin.shopee_part)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Store className="h-3 w-3" /> Shop/Người bán trả (Xtra):
                  </span>
                  <span className="font-mono">{vnd(fin.seller_part)}</span>
                </div>
              </div>
            </div>

            {/* Step 2: Deductions */}
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2 space-y-1.5">
              <div className="flex items-center justify-between font-semibold text-destructive">
                <span>2. Khấu trừ tại nguồn</span>
                <span className="font-mono">-{vnd(fin.service_fee + fin.tax_amount)}</span>
              </div>
              <div className="pl-4 space-y-1 text-[10px] text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Phí dịch vụ Shopee (0.98%):</span>
                  <span className="font-mono text-destructive">-{vnd(fin.service_fee)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Thuế TNCN tạm khấu trừ (10%):</span>
                  <span className="font-mono text-destructive">-{vnd(fin.tax_amount)}</span>
                </div>
              </div>
            </div>

            {/* Step 3: Net from Shopee */}
            <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-2.5 py-1.5 font-medium text-foreground">
              <span>3. Thực nhận từ Shopee:</span>
              <span className="font-mono font-bold">{vnd(fin.net_shopee)}</span>
            </div>

            {/* Step 4: Customer Cashback */}
            <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 font-medium text-primary">
              <span className="flex items-center gap-1.5">
                <Gift className="h-3.5 w-3.5" /> 4. Hoàn tiền cho khách:
              </span>
              <span className="font-mono font-bold">-{vnd(fin.cashback_amount)}</span>
            </div>

            {/* Step 5: Real Admin Profit */}
            <div className="mt-1 rounded-xl border-2 border-emerald-500/40 bg-emerald-500/10 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-800 dark:text-emerald-200 flex items-center gap-1">
                  <DollarSign className="h-4 w-4 text-emerald-600" /> 5. Lợi nhuận thực tế (Admin):
                </span>
                <span className="font-mono text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                  {isRejected ? "0 ₫" : vnd(fin.admin_profit)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-emerald-700/80 dark:text-emerald-300/80">
                <span>Tỷ suất lợi nhuận thực:</span>
                <span className="font-mono font-semibold">
                  {isRejected ? "0%" : `${fin.admin_margin}%`}
                </span>
              </div>
            </div>
          </div>

          {/* Footer Explanation */}
          <div className="mt-2.5 text-[10px] text-muted-foreground leading-snug border-t border-border/40 pt-2 flex items-start gap-1">
            <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 mt-0.5" />
            <span>
              Lợi nhuận ròng đút túi sau khi Shopee đã khấu trừ đủ 10% thuế TNCN và 0.98% phí sàn, và trừ số tiền hoàn lại cho người mua.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
