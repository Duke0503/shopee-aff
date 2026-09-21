import * as React from "react"
import { Card } from "@/components/ui/card"
import { Loader2 } from "lucide-react"

export interface AdminTableLayoutProps {
  toolbar?: React.ReactNode
  children: React.ReactNode
  pagination?: React.ReactNode
  isLoading?: boolean
  isEmpty?: boolean
  loadingMessage?: string
  emptyMessage?: string
}

export function AdminTableLayout({
  toolbar,
  children,
  pagination,
  isLoading,
  isEmpty,
  loadingMessage = "Đang tải dữ liệu...",
  emptyMessage = "Không tìm thấy dữ liệu phù hợp với bộ lọc.",
}: AdminTableLayoutProps) {
  return (
    <div className="flex h-full w-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* Top Filter Toolbar */}
      {toolbar && <div className="shrink-0">{toolbar}</div>}

      {/* Main Table Card (Full Viewport Auto-fit) */}
      <Card className="flex flex-1 flex-col min-h-0 overflow-hidden border-border/80 bg-card shadow-xs">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center p-8 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
            <span>{loadingMessage}</span>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-1 items-center justify-center p-8 text-xs text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="relative flex-1 min-h-0 overflow-auto">
            {children}
          </div>
        )}

        {/* Pinned Bottom Pagination */}
        {pagination && (
          <div className="shrink-0 border-t border-border/70 bg-card/80 backdrop-blur-xs">
            {pagination}
          </div>
        )}
      </Card>
    </div>
  )
}
