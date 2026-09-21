import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { shortDate } from "@/lib/format"
import type { ProductRequester } from "@/lib/api"
import { CreditCard, Clock, MessageSquare, AlertCircle } from "lucide-react"
import { EmptyDash } from "@/features/Admin/components/EmptyDash"

interface CustomerHoverCardProps {
  requesters: ProductRequester[]
}

export function CustomerHoverCard({ requesters }: CustomerHoverCardProps) {
  const [activeRequester, setActiveRequester] = React.useState<ProductRequester | null>(null)
  const [hoverPosition, setHoverPosition] = React.useState<{ top: number; left: number } | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  if (!requesters || requesters.length === 0) {
    return <EmptyDash value={null} />
  }

  const handleMouseEnter = (req: ProductRequester, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setActiveRequester(req)
    setHoverPosition({
      top: rect.top - 8,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - 320)),
    })
  }

  const handleMouseLeave = () => {
    setActiveRequester(null)
    setHoverPosition(null)
  }

  // Show up to 2 badges + overflow indicator
  const visible = requesters.slice(0, 2)
  const overflow = requesters.length - visible.length

  return (
    <div ref={containerRef} className="flex flex-wrap items-center gap-1.5">
      {visible.map((r) => {
        const name = r.display_name || r.customer_id

        return (
          <div
            key={r.customer_id}
            onMouseEnter={(e) => handleMouseEnter(r, e)}
            onMouseLeave={handleMouseLeave}
            className="group relative inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/80 bg-secondary/50 px-2 py-1 text-xs font-medium text-foreground transition-all hover:border-primary/50 hover:bg-secondary"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
              {name.slice(0, 1).toUpperCase()}
            </div>
            <span className="max-w-[100px] truncate">{name}</span>
            {r.request_count > 1 && (
              <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-semibold text-primary">
                x{r.request_count}
              </span>
            )}
          </div>
        )
      })}

      {overflow > 0 && (
        <Badge
          variant="secondary"
          className="text-[10px]"
          title={`${overflow} người khác cũng đã hỏi sản phẩm này`}
        >
          +{overflow} người
        </Badge>
      )}

      {/* Floating Tooltip Card */}
      {activeRequester && hoverPosition && (
        <div
          className="pointer-events-none fixed z-50 w-72 -translate-y-full rounded-xl border border-border/90 bg-popover/95 p-3.5 text-xs text-popover-foreground shadow-xl backdrop-blur-md transition-all animate-in fade-in-0 zoom-in-95"
          style={{
            top: `${hoverPosition.top}px`,
            left: `${hoverPosition.left}px`,
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-border/60 pb-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 font-bold text-primary shadow-2xs">
              {(activeRequester.display_name || activeRequester.customer_id).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold text-foreground">
                {activeRequester.display_name || activeRequester.customer_id}
              </div>
              <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <span>ID: {activeRequester.customer_id}</span>
                {activeRequester.zalo_user_id && (
                  <span>· Zalo: {activeRequester.zalo_user_id.slice(0, 8)}...</span>
                )}
              </div>
            </div>
          </div>

          {/* Body Information */}
          <div className="mt-2.5 space-y-2 text-[11px]">
            {/* Bank details */}
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                Tài khoản nhận tiền:
              </span>
              {activeRequester.bank_name && activeRequester.bank_account ? (
                <div className="mt-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>{activeRequester.bank_name}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-foreground">
                    {activeRequester.bank_account}{" "}
                    {activeRequester.account_holder ? `(${activeRequester.account_holder})` : ""}
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Khách chưa liên kết tài khoản ngân hàng</span>
                </div>
              )}
            </div>

            {/* Request statistics */}
            <div className="grid grid-cols-2 gap-2 border-t border-border/40 pt-2">
              <div>
                <span className="text-[10px] text-muted-foreground">Lượt hỏi SP này:</span>
                <div className="flex items-center gap-1 font-bold text-foreground">
                  <MessageSquare className="h-3 w-3 text-primary" />
                  <span>{activeRequester.request_count} lần</span>
                </div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Hỏi gần nhất:</span>
                <div className="flex items-center gap-1 font-medium text-foreground">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span>{shortDate(activeRequester.last_requested_at)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
