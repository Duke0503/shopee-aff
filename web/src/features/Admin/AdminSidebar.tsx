import {
  LayoutDashboard,
  Users,
  Shield,
  ShoppingBag,
  Database,
  Activity,
  LogOut,
  Sparkles,
  ChevronRight,
  X,
  CreditCard,
  Gift,
} from "lucide-react"

export type AdminTab = "dashboard" | "users" | "employees" | "orders" | "payments" | "campaigns" | "products" | "logs"

interface AdminSidebarProps {
  activeTab: AdminTab
  onSelectTab: (tab: AdminTab) => void
  isAdmin: boolean
  displayName: string
  roleTitle: string
  onLogout: () => void
  mobileOpen?: boolean
  onCloseMobile?: () => void
}

export function AdminSidebar({
  activeTab,
  onSelectTab,
  isAdmin,
  displayName,
  roleTitle,
  onLogout,
  mobileOpen,
  onCloseMobile,
}: AdminSidebarProps) {
  const navItems = [
    {
      group: "TỔNG QUAN",
      items: [
        {
          id: "dashboard" as AdminTab,
          label: "Bảng Điều Hành",
          icon: LayoutDashboard,
          adminOnly: false,
        },
      ],
    },
    {
      group: "NGHIỆP VỤ & VẬN HÀNH",
      items: [
        {
          id: "payments" as AdminTab,
          label: "Chi Trả & VietQR",
          icon: CreditCard,
          adminOnly: false,
        },
        {
          id: "campaigns" as AdminTab,
          label: "Chiến Dịch & Thưởng",
          icon: Gift,
          adminOnly: false,
        },
        {
          id: "orders" as AdminTab,
          label: "Đơn Hàng",
          icon: ShoppingBag,
          adminOnly: false,
        },
        {
          id: "users" as AdminTab,
          label: "Quản Lý Khách Hàng",
          icon: Users,
          adminOnly: false,
        },
        {
          id: "products" as AdminTab,
          label: "Kho Sản Phẩm",
          icon: Database,
          adminOnly: false,
        },
      ],
    },
    {
      group: "HỆ THỐNG & AN NINH",
      items: [
        {
          id: "employees" as AdminTab,
          label: "Nhân Sự & Phân Quyền",
          icon: Shield,
          adminOnly: true,
        },
        {
          id: "logs" as AdminTab,
          label: "Nhật Ký Hoạt Động",
          icon: Activity,
          adminOnly: false,
        },
      ],
    },
  ]

  const sidebarContent = (
    <div className="flex h-full w-56 flex-col justify-between border-r border-border/80 bg-card/95 backdrop-blur-md">
      {/* Top: Brand Header */}
      <div>
        <div className="flex h-12 items-center justify-between border-b border-border/70 px-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs shadow-primary/20">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold tracking-tight text-foreground">
                  Hoàn Tiền DP
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-none">Admin Portal</p>
            </div>
          </div>

          {/* Close button for mobile */}
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Navigation Groups */}
        <div className="space-y-4 px-2 py-3">
          {navItems.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.adminOnly || isAdmin
            )
            if (!visibleItems.length) return null

            return (
              <div key={group.group}>
                <div className="mb-1 px-2.5 text-[9.5px] font-bold tracking-wider text-muted-foreground/80 uppercase">
                  {group.group}
                </div>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon
                    const isActive = activeTab === item.id

                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          onSelectTab(item.id)
                          if (onCloseMobile) onCloseMobile()
                        }}
                        className={`group flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                          isActive
                            ? "bg-primary text-primary-foreground shadow-xs shadow-primary/25 font-semibold"
                            : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon
                            className={`h-3.5 w-3.5 shrink-0 transition-transform group-hover:scale-105 ${
                              isActive ? "text-primary-foreground" : "text-muted-foreground"
                            }`}
                          />
                          <span>{item.label}</span>
                        </div>
                        {isActive && (
                          <ChevronRight className="h-3 w-3 opacity-80" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom: User Card & Quick Links */}
      <div className="border-t border-border/70 p-2">
        {/* User Card */}
        <div className="flex items-center justify-between rounded-lg bg-secondary/50 p-2">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/20 text-[11px] font-bold text-primary">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold text-foreground">
                {displayName}
              </div>
              <div className="text-[9.5px] text-muted-foreground leading-none">
                {roleTitle}
              </div>
            </div>
          </div>

          <button
            onClick={onLogout}
            title="Đăng xuất"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop Fixed Left Sidebar */}
      <aside className="hidden h-screen shrink-0 lg:block">
        {sidebarContent}
      </aside>

      {/* Mobile Slide-over Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 flex h-full">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  )
}
