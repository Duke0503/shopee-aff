import * as React from "react"
import { createPortal } from "react-dom"
import { Badge } from "@/components/ui/badge"
import { shortDate } from "@/lib/format"
import type { ProductRequester } from "@/lib/api"
import { CreditCard, Clock, MessageSquare, AlertCircle, Users } from "lucide-react"
import { EmptyDash } from "@/features/Admin/components/EmptyDash"

interface CustomerHoverCardProps {
  requesters: ProductRequester[]
}

export function CustomerHoverCard({ requesters }: CustomerHoverCardProps) {
  const [activeRequester, setActiveRequester] = React.useState<ProductRequester | null>(null)
  const [requesterPos, setRequesterPos] = React.useState<{
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
      setActiveRequester(null)
      setRequesterPos(null)
      setShowOverflow(false)
      setOverflowPos(null)
    }, 150)
  }

  React.useEffect(() => {
    return () => cancelClose()
  }, [])

  if (!requesters || requesters.length === 0) {
    return <EmptyDash value={null} />
  }

  const computePos = (el: HTMLElement, estimatedHeight = 280, width = 320) => {
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

  const handleRequesterEnter = (req: ProductRequester, e: React.MouseEvent<HTMLDivElement>) => {
    cancelClose()
    setShowOverflow(false)
    setOverflowPos(null)
    setActiveRequester(req)
    setRequesterPos(computePos(e.currentTarget, 280, 300))
  }

  const handleOverflowEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    cancelClose()
    setActiveRequester(null)
    setRequesterPos(null)
    setShowOverflow(true)
    setOverflowPos(computePos(e.currentTarget, 340, 340))
  }

  // Show up to 2 badges + overflow indicator
  const visible = requesters.slice(0, 2)
  const overflowRequesters = requesters.slice(2)
  const overflow = overflowRequesters.length

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((r) => {
        const name = r.display_name || r.customer_id

        return (
          <div
            key={r.customer_id}
            onMouseEnter={(e) => handleRequesterEnter(r, e)}
            onMouseLeave={scheduleClose}
            className="group relative inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/80 bg-secondary/50 px-2 py-1 text-[11px] font-medium text-foreground transition-all hover:border-primary/50 hover:bg-secondary whitespace-nowrap shrink-0"
          >
            <div className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
              {name.slice(0, 1).toUpperCase()}
            </div>
            <span className="max-w-[120px] truncate leading-tight">{name}</span>
            {r.request_count > 1 && (
              <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary whitespace-nowrap leading-none shrink-0">
                x{r.request_count}
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
            setOverflowPos(computePos(e.currentTarget, 340, 340))
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary transition-all hover:bg-primary/20 hover:border-primary shrink-0 shadow-2xs"
          title={`Click hoặc rê chuột để xem chi tiết ${overflow} người hỏi khác`}
        >
          <Users className="h-3 w-3" />
          <span>+{overflow} người</span>
        </div>
      )}

      {/* Floating Single Requester Tooltip Card */}
      {activeRequester && requesterPos && createPortal(
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className={`fixed z-[9999] w-76 max-w-[calc(100vw-32px)] rounded-xl border border-border/90 bg-popover/98 p-3.5 text-xs text-popover-foreground shadow-2xl backdrop-blur-md transition-all animate-in fade-in-0 zoom-in-95 ${
            requesterPos.placement === "above" ? "-translate-y-full" : ""
          }`}
          style={{
            top: `${requesterPos.top}px`,
            left: `${requesterPos.left}px`,
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
                <span>ID: {activeRequester.customer_code || activeRequester.customer_id}</span>
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
        </div>,
        document.body
      )}

      {/* Floating Overflow Requesters List Card */}
      {showOverflow && overflowPos && createPortal(
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className={`fixed z-[9999] w-[340px] max-w-[calc(100vw-32px)] rounded-xl border border-border/90 bg-popover/98 p-3.5 text-xs text-popover-foreground shadow-2xl backdrop-blur-md transition-all animate-in fade-in-0 zoom-in-95 ${
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
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary font-bold">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <div className="font-bold text-foreground">
                  +{overflow} Người Hỏi Khác
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Danh sách khách hàng khác đã hỏi sản phẩm này
                </div>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono">
              {overflow} khách
            </Badge>
          </div>

          {/* List of overflow requesters */}
          <div className="mt-2.5 max-h-72 space-y-2 overflow-y-auto pr-1">
            {overflowRequesters.map((req) => {
              const name = req.display_name || req.customer_id

              return (
                <div
                  key={req.customer_id}
                  className="rounded-lg border border-border/70 bg-secondary/30 p-2.5 text-[11px]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                        {name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate max-w-[170px]">
                          {name}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          ID: {req.customer_code || req.customer_id}
                        </div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[10px] py-0 font-medium">
                      {req.request_count} lần hỏi
                    </Badge>
                  </div>

                  {/* Bank info */}
                  <div className="mt-1.5 text-[10px]">
                    {req.bank_name && req.bank_account ? (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <CreditCard className="h-3 w-3 text-primary shrink-0" />
                        <span className="font-medium text-foreground">{req.bank_name}:</span>
                        <span className="font-mono">{req.bank_account}</span>
                        {req.account_holder && <span>({req.account_holder})</span>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        <span>Chưa liên kết ngân hàng</span>
                      </div>
                    )}
                  </div>

                  {/* Last requested date */}
                  {req.last_requested_at && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground border-t border-border/40 pt-1">
                      <Clock className="h-3 w-3" />
                      <span>Hỏi gần nhất: {shortDate(req.last_requested_at)}</span>
                    </div>
                  )}
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
