import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { fetchMe, fetchAdminMetrics, adminLogout } from "@/lib/api"
import { AdminLogin } from "@/features/Admin/AdminLogin"
import { AdminSidebar, type AdminTab } from "@/features/Admin/AdminSidebar"
import { AdminHeader } from "@/features/Admin/AdminHeader"
import { DashboardView } from "@/features/Admin/views/DashboardView"
import { UsersView } from "@/features/Admin/views/UsersView"
import { EmployeesView } from "@/features/Admin/views/EmployeesView"
import { OrdersView } from "@/features/Admin/views/OrdersView"
import { ProductsView } from "@/features/Admin/views/ProductsView"
import { LogsView } from "@/features/Admin/views/LogsView"
import { Loader2 } from "lucide-react"

function resolveTabFromPath(path: string): AdminTab {
  const clean = path.replace(/\/+$/, "").toLowerCase()
  if (clean.includes("/employee")) return "employees"
  if (clean.includes("/user")) return "users"
  if (clean.includes("/order")) return "orders"
  if (clean.includes("/product")) return "products"
  if (clean.includes("/log")) return "logs"
  return "dashboard"
}

export function Console() {
  const queryClient = useQueryClient()

  // 1. Session check
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 30_000,
  })

  const me = meQuery.data
  const isStaff = !!(me && (me.role === "admin" || me.role === "employee" || me.is_staff))
  const isAdmin = !!(me && (me.role === "admin" || me.is_admin))

  // 2. Tab management
  const [activeTab, setActiveTabState] = React.useState<AdminTab>(() =>
    resolveTabFromPath(window.location.pathname)
  )
  const [mobileOpen, setMobileOpen] = React.useState(false)

  const setActiveTab = (tab: AdminTab) => {
    setActiveTabState(tab)
    const newPath = tab === "dashboard" ? "/admin" : `/admin/${tab}`
    if (window.location.pathname !== newPath) {
      window.history.pushState({}, "", newPath)
    }
  }

  React.useEffect(() => {
    const handlePopState = () => {
      setActiveTabState(resolveTabFromPath(window.location.pathname))
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  // 3. Fetch admin metrics if authenticated as staff
  const metricsQuery = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: () => fetchAdminMetrics("all"),
    enabled: isStaff,
    staleTime: 15_000,
  })

  // 4. Logout action
  const handleLogout = async () => {
    try {
      await adminLogout()
    } finally {
      queryClient.setQueryData(["me"], null)
      await queryClient.invalidateQueries({ queryKey: ["me"] })
      window.history.pushState({}, "", "/admin")
    }
  }

  // Loading state
  if (meQuery.isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2.5 rounded-xl border border-border/80 bg-card p-4 text-xs font-medium text-muted-foreground shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Đang xác thực phiên quản trị...</span>
        </div>
      </div>
    )
  }

  // Not logged in OR not staff -> Show AdminLogin
  if (!me || !isStaff) {
    return (
      <AdminLogin
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["me"] })
        }}
      />
    )
  }

  const roleTitle = isAdmin ? "Quản Trị Viên (Admin)" : "Nhân Viên Vận Hành"

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Left Sidebar (Desktop Fixed + Mobile Drawer) */}
      <AdminSidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isAdmin={isAdmin}
        displayName={me.display_name || me.customer_id}
        roleTitle={roleTitle}
        onLogout={handleLogout}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* Main Workspace (Full Width & Full Height) */}
      <div className="flex flex-1 flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Header Bar */}
        <AdminHeader
          activeTab={activeTab}
          isAdmin={isAdmin}
          isFetching={metricsQuery.isFetching}
          onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: ["admin-metrics"] })
            queryClient.invalidateQueries({ queryKey: ["admin-orders"] })
            queryClient.invalidateQueries({ queryKey: ["admin-users"] })
            queryClient.invalidateQueries({ queryKey: ["admin-products"] })
            queryClient.invalidateQueries({ queryKey: ["admin-employees"] })
            queryClient.invalidateQueries({ queryKey: ["admin-logs"] })
          }}
          onOpenMobileMenu={() => setMobileOpen(true)}
        />

        {/* Viewport Canvas (Auto-fit height for tables, scrollable for dashboard) */}
        <main
          className={`flex-1 min-h-0 ${
            activeTab === "dashboard"
              ? "overflow-y-auto p-4 sm:p-6 lg:p-8"
              : "flex flex-col overflow-hidden p-3 sm:p-4 lg:p-5"
          }`}
        >
          <div
            className={`w-full max-w-full ${
              activeTab === "dashboard" ? "mx-auto" : "flex flex-1 min-h-0 flex-col"
            }`}
          >
            {activeTab === "dashboard" && (
              metricsQuery.isLoading ? (
                <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" /> Đang tải số liệu tổng quan...
                </div>
              ) : metricsQuery.data?.metrics ? (
                <DashboardView
                  metrics={metricsQuery.data.metrics}
                  role={me.role || "user"}
                  onNavigateTab={(tab) => setActiveTab(tab as AdminTab)}
                />
              ) : (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-8 text-center text-xs text-destructive">
                  Không thể tải dữ liệu tổng quan. Vui lòng kiểm tra lại quyền truy cập.
                </div>
              )
            )}

            {activeTab === "orders" && <OrdersView />}
            {activeTab === "users" && <UsersView />}
            {activeTab === "products" && <ProductsView />}
            {activeTab === "employees" && (
              isAdmin ? (
                <EmployeesView />
              ) : (
                <Card className="p-8 text-center text-xs text-destructive">
                  Bạn không có quyền truy cập khu vực quản trị nhân sự.
                </Card>
              )
            )}
            {activeTab === "logs" && <LogsView />}
          </div>
        </main>
      </div>
    </div>
  )
}
