import { Badge } from "@/components/ui/badge"
import { Menu, RefreshCw, Shield, Activity, ChevronRight } from "lucide-react"
import type { AdminTab } from "./AdminSidebar"

interface AdminHeaderProps {
  activeTab: AdminTab
  isAdmin: boolean
  isFetching: boolean
  onRefresh: () => void
  onOpenMobileMenu: () => void
}

const TAB_TITLES: Record<AdminTab, { title: string; category: string }> = {
  dashboard: { title: "Bảng Điều Hành & KPIs", category: "Tổng Quan" },
  payments: { title: "Quản Lý Chi Trả & VietQR", category: "Nghiệp Vụ" },
  campaigns: { title: "Chiến Dịch & Thưởng Sự Kiện", category: "Nghiệp Vụ" },
  orders: { title: "Quản Lý Đơn Hàng Shopee", category: "Nghiệp Vụ" },
  users: { title: "Quản Lý Khách Hàng", category: "Nghiệp Vụ" },
  products: { title: "Kho Sản Phẩm", category: "Nghiệp Vụ" },
  employees: { title: "Nhân Sự & Phân Quyền", category: "Hệ Thống" },
  logs: { title: "Nhật Ký Hoạt Động & Tracking", category: "Hệ Thống" },
}

export function AdminHeader({
  activeTab,
  isAdmin,
  isFetching,
  onRefresh,
  onOpenMobileMenu,
}: AdminHeaderProps) {
  const current = TAB_TITLES[activeTab] || { title: "Quản Trị", category: "Hệ Thống" }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 bg-card/50 px-3 backdrop-blur-md sm:px-4">
      {/* Left: Mobile Toggle & Breadcrumbs */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenMobileMenu}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">Quản Trị</span>
          <ChevronRight className="hidden h-3 w-3 opacity-60 sm:inline" />
          <span className="hidden text-muted-foreground/80 md:inline">{current.category}</span>
          <ChevronRight className="hidden h-3 w-3 opacity-60 md:inline" />
          <span className="font-semibold text-foreground text-xs sm:text-[11.5px]">
            {current.title}
          </span>
        </div>
      </div>

      {/* Right: Status Pill & Controls */}
      <div className="flex items-center gap-2">
        {/* Live Bot Zalo Indicator */}
        <div className="hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-600 sm:flex dark:text-emerald-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <span>Bot Zalo Trực Tuyến</span>
        </div>

        {/* Role Pill */}
        {isAdmin ? (
          <Badge variant="default" className="hidden bg-emerald-600 px-2 py-0.5 text-[10px] text-white sm:inline-flex">
            <Shield className="mr-1 h-2.5 w-2.5" /> Admin
          </Badge>
        ) : (
          <Badge variant="info" className="hidden px-2 py-0.5 text-[10px] sm:inline-flex">
            <Activity className="mr-1 h-2.5 w-2.5" /> Staff
          </Badge>
        )}

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground shadow-2xs transition-colors hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin text-primary" : ""}`} />
          <span className="hidden sm:inline">Làm mới</span>
        </button>
      </div>
    </header>
  )
}
