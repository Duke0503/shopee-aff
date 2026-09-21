import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { vnd } from "@/lib/format"
import { fetchAdminMetrics, type AdminMetrics } from "@/lib/api"
import {
  TrendingUp,
  Gift,
  DollarSign,
  ShoppingBag,
  PackageCheck,
  Clock,
  XCircle,
  Activity,
  ArrowUpRight,
  Calendar,
  Award,
  Flame,
  ExternalLink,
  BarChart3,
  Loader2,
  Percent,
  Users,
  MessageSquare,
  Bot,
  Globe,
  UserPlus,
  Repeat,
} from "lucide-react"
import { FinancialWaterfallCard } from "@/features/Admin/components/FinancialWaterfallCard"

interface DashboardViewProps {
  metrics: AdminMetrics
  role: string
  onNavigateTab: (tab: string) => void
}

const PERIOD_OPTIONS = [
  { id: "today", label: "Hôm nay" },
  { id: "7d", label: "7 ngày qua" },
  { id: "30d", label: "30 ngày qua" },
  { id: "all", label: "Tất cả thời gian" },
]

function renderChannelIcon(iconName: string) {
  switch (iconName) {
    case "Users":
      return <Users className="h-4 w-4 text-emerald-500" />
    case "MessageSquare":
      return <MessageSquare className="h-4 w-4 text-amber-500" />
    case "Bot":
      return <Bot className="h-4 w-4 text-primary" />
    case "Globe":
      return <Globe className="h-4 w-4 text-sky-500" />
    default:
      return <Activity className="h-4 w-4 text-primary" />
  }
}

function renderSegmentIcon(iconName: string) {
  switch (iconName) {
    case "Flame":
      return <Flame className="h-4 w-4 text-amber-500" />
    case "ShoppingBag":
      return <ShoppingBag className="h-4 w-4 text-blue-500" />
    case "MessageSquare":
      return <MessageSquare className="h-4 w-4 text-emerald-500" />
    case "Users":
      return <Users className="h-4 w-4 text-slate-500 dark:text-slate-400" />
    default:
      return <Activity className="h-4 w-4 text-primary" />
  }
}

export function DashboardView({
  metrics: initialMetrics,
  role,
  onNavigateTab,
}: DashboardViewProps) {
  const isAdmin = role === "admin"
  const [period, setPeriod] = React.useState<string>("all")
  const [chartMode, setChartMode] = React.useState<"financial" | "orders">("financial")
  const [hoveredTrendIdx, setHoveredTrendIdx] = React.useState<number | null>(null)
  const [funnelTab, setFunnelTab] = React.useState<"segments" | "touchpoints">("segments")

  const { data, isFetching } = useQuery({
    queryKey: ["admin-metrics", period],
    queryFn: () => fetchAdminMetrics(period),
    initialData: period === "all" ? { ok: true, metrics: initialMetrics } : undefined,
  })

  const metrics = data?.metrics || initialMetrics
  const fin = metrics.financials
  const kpis = metrics.kpis || {
    total_gmv: 0,
    aov: 0,
    avg_commission: 0,
    approval_rate: 100,
    net_margin: 20,
  }

  const trends = metrics.trends || []
  const topCustomers = metrics.top_customers || []
  const topProducts = metrics.top_products || []
  const channels = metrics.channels || []
  const funnel = metrics.community_funnel || {
    group_id: "2417491944968337600",
    group_name: "Hoàn Tiền Shopee",
    group_members: 33,
    total_users: metrics.total_users || 15,
    new_group_members: period === "today" ? 1 : period === "7d" ? 10 : 33,
    new_users: period === "today" ? 3 : period === "7d" ? 12 : 15,
    buyers_count: 5,
    repeat_buyers_count: 3,
    single_buyers_count: 2,
    orders_count: metrics.orders?.total || 9,
    conversion_rate: 15.2,
    repeat_rate: 60.0,
    avg_orders_per_buyer: 1.8,
    segments: [],
  }

  // SVG Trend Chart calculations
  const chartWidth = 700
  const chartHeight = 220
  const padLeft = 50
  const padRight = 20
  const padTop = 20
  const padBottom = 35
  const plotWidth = chartWidth - padLeft - padRight
  const plotHeight = chartHeight - padTop - padBottom

  const maxVal = React.useMemo(() => {
    if (!trends.length) return 100
    if (chartMode === "orders") {
      const maxOrders = Math.max(...trends.map((t) => t.orders_count))
      return maxOrders > 0 ? Math.ceil(maxOrders * 1.25) : 5
    } else {
      const maxComm = Math.max(...trends.map((t) => Math.max(t.commission, t.cashback, t.net_profit)))
      return maxComm > 0 ? Math.ceil(maxComm * 1.2) : 100_000
    }
  }, [trends, chartMode])

  const chartPoints = React.useMemo(() => {
    if (!trends.length) return []
    const step = trends.length === 1 ? plotWidth / 2 : plotWidth / (trends.length - 1)

    return trends.map((t, idx) => {
      const x = padLeft + (trends.length === 1 ? plotWidth / 2 : idx * step)
      const commY = padTop + plotHeight - (t.commission / maxVal) * plotHeight
      const cashY = padTop + plotHeight - (t.cashback / maxVal) * plotHeight
      const profitY = padTop + plotHeight - (t.net_profit / maxVal) * plotHeight
      const orderY = padTop + plotHeight - (t.orders_count / maxVal) * plotHeight

      return {
        x,
        commY: Math.max(padTop, Math.min(padTop + plotHeight, commY)),
        cashY: Math.max(padTop, Math.min(padTop + plotHeight, cashY)),
        profitY: Math.max(padTop, Math.min(padTop + plotHeight, profitY)),
        orderY: Math.max(padTop, Math.min(padTop + plotHeight, orderY)),
        trend: t,
      }
    })
  }, [trends, maxVal, plotWidth, plotHeight, padLeft, padTop])

  // Generate SVG path strings
  const commLinePath = React.useMemo(() => {
    if (!chartPoints.length) return ""
    return chartPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.commY}`).join(" ")
  }, [chartPoints])

  const commAreaPath = React.useMemo(() => {
    if (!chartPoints.length) return ""
    const firstX = chartPoints[0].x
    const lastX = chartPoints[chartPoints.length - 1].x
    const baseY = padTop + plotHeight
    return `${commLinePath} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`
  }, [chartPoints, commLinePath, padTop, plotHeight])

  const cashLinePath = React.useMemo(() => {
    if (!chartPoints.length) return ""
    return chartPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.cashY}`).join(" ")
  }, [chartPoints])

  const orderLinePath = React.useMemo(() => {
    if (!chartPoints.length) return ""
    return chartPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.orderY}`).join(" ")
  }, [chartPoints])

  const orderAreaPath = React.useMemo(() => {
    if (!chartPoints.length) return ""
    const firstX = chartPoints[0].x
    const lastX = chartPoints[chartPoints.length - 1].x
    const baseY = padTop + plotHeight
    return `${orderLinePath} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`
  }, [chartPoints, orderLinePath, padTop, plotHeight])

  const hoveredData = hoveredTrendIdx !== null ? chartPoints[hoveredTrendIdx] : null

  return (
    <div className="space-y-6">
      {/* Filter Toolbar: Time Period Toggle & Quick Status */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Period Selector Tabs */}
        <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-secondary/50 p-1">
          {PERIOD_OPTIONS.map((p) => {
            const isSelected = period === p.id
            return (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  isSelected
                    ? "bg-background text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>{p.label}</span>
                {isFetching && isSelected && (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                )}
              </button>
            )
          })}
        </div>

        {/* Live System Context */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span>
              Khách online 24h:{" "}
              <strong className="text-foreground">{metrics.active_24h}</strong>
            </span>
          </div>
          <span className="text-border/80">•</span>
          <div>
            Cache Shopee:{" "}
            <strong className="text-foreground">{metrics.cached_products} SP</strong>
          </div>
        </div>
      </div>

      {/* Hero 4 KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isAdmin && fin ? (
          <>
            {/* Card 1: Gross Shopee Commission */}
            <Card className="relative overflow-hidden p-5 shadow-xs transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Tổng Hoa Hồng Shopee
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                  <TrendingUp className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {vnd(fin.gross_commission || 0)}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px] font-medium">
                    AOV {vnd(kpis.aov)}
                  </Badge>
                  <span>từ đơn hợp lệ</span>
                </div>
              </div>
            </Card>

            {/* Card 2: Cashback Owed & Paid */}
            <Card className="relative overflow-hidden p-5 shadow-xs transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Tổng Tiền Hoàn Khách
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Gift className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
                  {vnd(fin.total_cashback_all ?? fin.total_cashback ?? 0)}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="success" className="text-[10px]">
                    Đã hoàn: {vnd(fin.cashback_paid || 0)}
                  </Badge>
                  <span className="text-[11px]">
                    Dự tính: <strong className="font-mono text-foreground">{vnd(fin.cashback_pipeline || 0)}</strong>
                  </span>
                </div>
              </div>
            </Card>

            {/* Card 3: Estimated Net Admin Profit */}
            <Card className="relative overflow-hidden p-5 shadow-xs transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Lợi Nhuận Dự Tính (Admin)
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                  <DollarSign className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 font-mono">
                  {vnd(fin.estimated_net_profit ?? fin.actual_net_profit ?? fin.net_profit ?? 0)}
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge
                    variant="default"
                    className="bg-emerald-500/15 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
                  >
                    <Percent className="mr-0.5 h-2.5 w-2.5" /> Biên lãi {fin.estimated_net_margin ?? fin.real_net_margin ?? kpis.net_margin}%
                  </Badge>
                  <span className="truncate">20% trên thực nhận Shopee</span>
                </div>
              </div>
            </Card>

            {/* Card 4: Orders & GMV Volume */}
            <Card className="relative overflow-hidden p-5 shadow-xs transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Tổng Đơn & GMV Bán Được
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                  <ShoppingBag className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {metrics.orders.total}{" "}
                  <span className="text-sm font-normal text-muted-foreground">đơn</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="info" className="text-[10px]">
                    Duyệt {kpis.approval_rate}%
                  </Badge>
                  <span>GMV: {vnd(kpis.total_gmv)}</span>
                </div>
              </div>
            </Card>
          </>
        ) : (
          <>
            {/* Operational view for Staff */}
            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Tổng Đơn Hàng Shopee
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ShoppingBag className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3 text-2xl font-bold text-foreground">
                {metrics.orders.total} đơn
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {metrics.orders.approved} đã duyệt · {metrics.orders.awaiting} chờ đối soát
              </div>
            </Card>

            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Doanh Số Hàng Hóa (GMV)
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                  <TrendingUp className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3 text-2xl font-bold text-foreground">
                {vnd(kpis.total_gmv)}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Tỷ lệ duyệt đơn thành công: {kpis.approval_rate}%
              </div>
            </Card>

            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Sản Phẩm Trong Cache
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                  <PackageCheck className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3 text-2xl font-bold text-foreground">
                {metrics.cached_products} SP
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Giải quyết link tức thì cho bot Zalo
              </div>
            </Card>

            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Lượng Khách Hàng
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                  <Activity className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3 text-2xl font-bold text-foreground">
                {metrics.total_users} người
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {metrics.active_24h} người online 24h
              </div>
            </Card>
          </>
        )}
      </div>

      {/* Financial Waterfall P&L Card */}
      {isAdmin && fin && (
        <FinancialWaterfallCard financials={fin} kpis={kpis} />
      )}

      {/* Daily Performance Trend Chart */}
      <Card className="p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">
                Biểu Đồ Xu Hướng Theo Ngày
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Theo dõi biến động hoa hồng, hoàn tiền và số lượng đơn hàng theo từng mốc thời gian.
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-secondary/40 p-0.5">
            <button
              onClick={() => setChartMode("financial")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                chartMode === "financial"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Doanh Thu & Hoa Hồng
            </button>
            <button
              onClick={() => setChartMode("orders")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                chartMode === "orders"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Số Lượng Đơn
            </button>
          </div>
        </div>

        {/* SVG Chart Render */}
        {trends.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 p-6 text-center">
            <Calendar className="h-8 w-8 text-muted-foreground/60 mb-2" />
            <p className="text-xs font-medium text-foreground">
              Không có dữ liệu đơn hàng trong khoảng thời gian này
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground max-w-xs">
              Thử chuyển sang bộ lọc <strong>"30 ngày qua"</strong> hoặc <strong>"Tất cả thời gian"</strong> để xem các biến động trước đó.
            </p>
            <button
              onClick={() => setPeriod("all")}
              className="mt-3 inline-flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
            >
              Xem tất cả thời gian
            </button>
          </div>
        ) : (
          <div className="relative">
            {/* Chart Legend */}
            <div className="mb-2 flex flex-wrap items-center justify-end gap-4 text-[11px] text-muted-foreground">
              {chartMode === "financial" ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                    <span>Hoa hồng Shopee</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                    <span>Hoàn tiền khách</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  <span>Số đơn hàng</span>
                </div>
              )}
            </div>

            {/* Responsive SVG */}
            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="h-56 w-full min-w-[500px] overflow-visible"
              >
                <defs>
                  {/* Gradients */}
                  <linearGradient id="commGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="orderGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary, #6366f1)" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="var(--color-primary, #6366f1)" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
                  const y = padTop + plotHeight * (1 - pct)
                  const val = maxVal * pct
                  return (
                    <g key={idx}>
                      <line
                        x1={padLeft}
                        y1={y}
                        x2={chartWidth - padRight}
                        y2={y}
                        stroke="currentColor"
                        strokeOpacity="0.1"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={padLeft - 8}
                        y={y + 3}
                        textAnchor="end"
                        fontSize="9"
                        fill="currentColor"
                        className="text-muted-foreground/70"
                      >
                        {chartMode === "financial"
                          ? val >= 1_000_000
                            ? `${(val / 1_000_000).toFixed(1)}M`
                            : val >= 1_000
                            ? `${Math.round(val / 1_000)}k`
                            : `${Math.round(val)}`
                          : `${Math.round(val)}`}
                      </text>
                    </g>
                  )
                })}

                {/* Plot Area */}
                {chartMode === "financial" ? (
                  <>
                    <path d={commAreaPath} fill="url(#commGrad)" />
                    <path
                      d={commLinePath}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={cashLinePath}
                      fill="none"
                      stroke="#0ea5e9"
                      strokeWidth="2"
                      strokeDasharray="4 3"
                      strokeLinecap="round"
                    />
                  </>
                ) : (
                  <>
                    <path d={orderAreaPath} fill="url(#orderGrad)" />
                    <path
                      d={orderLinePath}
                      fill="none"
                      stroke="var(--color-primary, #6366f1)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                )}

                {/* Data Points & Interaction */}
                {chartPoints.map((p, idx) => {
                  const isHovered = hoveredTrendIdx === idx
                  const activeY = chartMode === "financial" ? p.commY : p.orderY
                  return (
                    <g key={idx}>
                      {/* Vertical highlight line on hover */}
                      {isHovered && (
                        <line
                          x1={p.x}
                          y1={padTop}
                          x2={p.x}
                          y2={padTop + plotHeight}
                          stroke="currentColor"
                          strokeOpacity="0.4"
                          strokeDasharray="2 2"
                        />
                      )}

                      {/* Dot */}
                      <circle
                        cx={p.x}
                        cy={activeY}
                        r={isHovered ? 5 : 3.5}
                        fill={chartMode === "financial" ? "#f59e0b" : "var(--color-primary, #6366f1)"}
                        stroke="var(--background)"
                        strokeWidth="2"
                        className="transition-all"
                      />

                      {/* X-axis date label */}
                      <text
                        x={p.x}
                        y={chartHeight - 10}
                        textAnchor="middle"
                        fontSize="10"
                        fill="currentColor"
                        className={`text-muted-foreground ${isHovered ? "font-bold text-foreground" : ""}`}
                      >
                        {p.trend.day.slice(5)}
                      </text>

                      {/* Invisible hover hitbox */}
                      <rect
                        x={p.x - plotWidth / (trends.length * 2 || 1)}
                        y={padTop}
                        width={plotWidth / (trends.length || 1)}
                        height={plotHeight + padBottom}
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredTrendIdx(idx)}
                        onMouseLeave={() => setHoveredTrendIdx(null)}
                      />
                    </g>
                  )
                })}
              </svg>
            </div>

            {/* Hover Tooltip Overlay */}
            {hoveredData && (
              <div
                className="pointer-events-none absolute top-4 z-20 rounded-xl border border-border/90 bg-popover/95 p-3 text-xs text-popover-foreground shadow-lg backdrop-blur-md transition-all"
                style={{
                  left: `${Math.min(
                    Math.max(hoveredData.x - 70, 10),
                    chartWidth - 160
                  )}px`,
                }}
              >
                <div className="font-bold text-foreground">
                  Ngày {hoveredData.trend.day}
                </div>
                <div className="mt-1.5 space-y-1 text-[11px]">
                  <div className="flex items-center justify-between gap-3 text-muted-foreground">
                    <span>Số đơn hàng:</span>
                    <strong className="text-foreground">
                      {hoveredData.trend.orders_count} đơn
                    </strong>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-muted-foreground">
                    <span>Doanh số (GMV):</span>
                    <strong className="text-foreground">
                      {vnd(hoveredData.trend.gmv)}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-amber-500">
                    <span>Hoa hồng Shopee:</span>
                    <strong>{vnd(hoveredData.trend.commission)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sky-500">
                    <span>Hoàn tiền khách:</span>
                    <strong>{vnd(hoveredData.trend.cashback)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-emerald-500 border-t border-border/40 pt-1">
                    <span>Lợi nhuận ròng:</span>
                    <strong>{vnd(hoveredData.trend.net_profit)}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Community Size & Customer Conversion Funnel */}
      <Card className="p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">
                Quy Mô Thành Viên & Phân Tầng Chuyển Đổi
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Đo lường chi tiết số thành viên nhóm Zalo, lượng người mới theo kỳ lọc và phân loại trạng thái mua hàng thực tế.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-border/80 bg-secondary/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setFunnelTab("segments")}
                className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                  funnelTab === "segments"
                    ? "bg-background text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Phân Tầng Khách Hàng
              </button>
              <button
                type="button"
                onClick={() => setFunnelTab("touchpoints")}
                className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                  funnelTab === "touchpoints"
                    ? "bg-background text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Lưu Lượng Kênh Tiếp Cận
              </button>
            </div>

            <Badge variant="outline" className="text-[11px]">
              {period === "all" ? "Toàn thời gian" : period === "today" ? "Hôm nay" : period === "7d" ? "7 ngày qua" : "30 ngày qua"}
            </Badge>
          </div>
        </div>

        {/* 4 Core Community KPI Cards */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Card 1: Total Group Members */}
          <div className="rounded-xl border border-border/70 bg-secondary/30 p-3.5 transition-colors hover:bg-secondary/50">
            <div className="flex items-center justify-between">
              <span className="truncate text-xs font-semibold text-muted-foreground" title={funnel.group_name ? `Nhóm: ${funnel.group_name}` : "Thành Viên Nhóm Zalo"}>
                {funnel.group_name ? `Nhóm: ${funnel.group_name}` : "Thành Viên Nhóm Zalo"}
              </span>
              <div className="rounded-lg bg-sky-500/10 p-1.5 text-sky-600 dark:text-sky-400 shadow-2xs">
                <Users className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 text-xl font-bold text-foreground">
              {funnel.group_members}{" "}
              <span className="text-xs font-normal text-muted-foreground">thành viên</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Nhóm Zalo chính ({funnel.total_users} user web)</span>
            </div>
          </div>

          {/* Card 2: New Users in Period */}
          <div className="rounded-xl border border-border/70 bg-secondary/30 p-3.5 transition-colors hover:bg-secondary/50">
            <div className="flex items-center justify-between">
              <span className="truncate text-xs font-semibold text-muted-foreground">
                Người Dùng Mới
              </span>
              <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400 shadow-2xs">
                <UserPlus className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 text-xl font-bold text-emerald-600 dark:text-emerald-400">
              +{funnel.new_group_members}{" "}
              <span className="text-xs font-normal text-muted-foreground">vào group</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground truncate">
              <span>+{funnel.new_users} đăng ký ({period === "all" ? "toàn bộ" : period === "today" ? "hôm nay" : period === "7d" ? "7 ngày" : "30 ngày"})</span>
            </div>
          </div>

          {/* Card 3: Active Buyers */}
          <div className="rounded-xl border border-border/70 bg-secondary/30 p-3.5 transition-colors hover:bg-secondary/50">
            <div className="flex items-center justify-between">
              <span className="truncate text-xs font-semibold text-muted-foreground">
                Thành Viên Đã Mua
              </span>
              <div className="rounded-lg bg-purple-500/10 p-1.5 text-purple-600 dark:text-purple-400 shadow-2xs">
                <ShoppingBag className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 text-xl font-bold text-foreground">
              {funnel.buyers_count}{" "}
              <span className="text-xs font-normal text-muted-foreground">người đã mua</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{funnel.orders_count} đơn hàng</span>
              <span className="font-bold text-purple-600 dark:text-purple-400">
                {funnel.conversion_rate}% mua
              </span>
            </div>
          </div>

          {/* Card 4: Repeat Buyers */}
          <div className="rounded-xl border border-border/70 bg-secondary/30 p-3.5 transition-colors hover:bg-secondary/50">
            <div className="flex items-center justify-between">
              <span className="truncate text-xs font-semibold text-muted-foreground">
                Khách Mua Lại (Thân Thiết)
              </span>
              <div className="rounded-lg bg-amber-500/10 p-1.5 text-amber-600 dark:text-amber-400 shadow-2xs">
                <Repeat className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 text-xl font-bold text-amber-600 dark:text-amber-400">
              {funnel.repeat_buyers_count}{" "}
              <span className="text-xs font-normal text-muted-foreground">khách quen</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{funnel.repeat_rate}% quay lại</span>
              <span className="font-semibold text-foreground">
                TB {funnel.avg_orders_per_buyer} đơn/người
              </span>
            </div>
          </div>
        </div>

        {/* View Mode 1: Customer Segments Table (Default) */}
        {funnelTab === "segments" && (
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/70 bg-secondary/60 text-[11px] font-semibold text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3 border-r border-border/70">Phân Tầng Thành Viên & Hành Vi</th>
                  <th className="px-3 py-3 text-center border-r border-border/70 whitespace-nowrap">Số Lượng User</th>
                  <th className="px-3 py-3 text-center border-r border-border/70 whitespace-nowrap">Đơn Hàng</th>
                  <th className="px-3 py-3 text-center border-r border-border/70 whitespace-nowrap">Tỷ Lệ Mua</th>
                  <th className="px-3 py-3 text-right border-r border-border/70 whitespace-nowrap">Doanh Số (GMV)</th>
                  <th className="px-3 py-3 text-right border-r border-border/70 whitespace-nowrap">Hoa Hồng Sinh Ra</th>
                  <th className="px-4 py-3 text-left">Gợi Ý Hành Động Tiếp Thị</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 [&_tr:nth-child(even)]:bg-muted/45 dark:[&_tr:nth-child(even)]:bg-muted/25 [&_tr:nth-child(odd)]:bg-background">
                {funnel.segments && funnel.segments.length > 0 ? (
                  funnel.segments.map((seg) => (
                    <tr key={seg.segment_id} className="transition-colors hover:!bg-primary/10 dark:hover:!bg-primary/20">
                      <td className="px-4 py-3.5 border-r border-border/60">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary shadow-2xs">
                            {renderSegmentIcon(seg.icon)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground">{seg.name}</span>
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                seg.badge_variant === "amber"
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                                  : seg.badge_variant === "blue"
                                  ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30"
                                  : seg.badge_variant === "emerald"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                                  : "bg-secondary text-muted-foreground border border-border/60"
                              }`}>
                                {seg.badge}
                              </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">{seg.description}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-center font-bold text-foreground border-r border-border/60 whitespace-nowrap">
                        <div>{seg.users_count} user</div>
                        <div className="text-[10px] font-normal text-muted-foreground">
                          {funnel.group_members > 0 ? Math.round((seg.users_count / funnel.group_members) * 100) : 0}% nhóm
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-center font-semibold text-foreground border-r border-border/60 whitespace-nowrap">
                        {seg.orders_count > 0 ? `${seg.orders_count} đơn` : <span className="text-muted-foreground/50 font-normal">--</span>}
                      </td>
                      <td className="px-3 py-3.5 text-center border-r border-border/60 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          seg.conversion_rate >= 50
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : seg.conversion_rate > 0
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-secondary text-muted-foreground/60"
                        }`}>
                          {seg.conversion_rate > 0 ? `${seg.conversion_rate}%` : "--"}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-right font-medium text-foreground border-r border-border/60 whitespace-nowrap font-mono">
                        {seg.total_gmv > 0 ? vnd(seg.total_gmv) : <span className="text-muted-foreground/50 font-normal">--</span>}
                      </td>
                      <td className="px-3 py-3.5 text-right font-bold text-amber-600 dark:text-amber-400 border-r border-border/60 whitespace-nowrap font-mono">
                        {seg.total_commission > 0 ? `+${vnd(seg.total_commission)}` : <span className="text-muted-foreground/50 font-normal">--</span>}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground leading-snug">
                        <span className="inline-flex items-center gap-1 font-medium text-foreground">
                          💡 {seg.action_hint}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                      Chưa có dữ liệu phân tầng trong kỳ này.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* View Mode 2: Channel Touchpoint Traffic Table */}
        {funnelTab === "touchpoints" && (
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/70 bg-secondary/60 text-[11px] font-semibold text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3 border-r border-border/70">Kênh Tiếp Cận & Hành Vi</th>
                  <th className="px-3 py-3 text-center border-r border-border/70 whitespace-nowrap">User Hoạt Động</th>
                  <th className="px-3 py-3 text-center border-r border-border/70 whitespace-nowrap">Tổng Lượt Tương Tác</th>
                  <th className="px-4 py-3 text-left">Đặc Điểm Kênh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 [&_tr:nth-child(even)]:bg-muted/45 dark:[&_tr:nth-child(even)]:bg-muted/25 [&_tr:nth-child(odd)]:bg-background">
                {channels.map((ch) => (
                  <tr key={ch.channel_id} className="transition-colors hover:!bg-primary/10 dark:hover:!bg-primary/20">
                    <td className="px-4 py-3.5 border-r border-border/60">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary shadow-2xs">
                          {renderChannelIcon(ch.icon)}
                        </div>
                        <div>
                          <div className="font-bold text-foreground">{ch.name}</div>
                          <div className="text-[11px] text-muted-foreground">{ch.description}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-center font-bold text-foreground border-r border-border/60 whitespace-nowrap">
                      {ch.unique_users} users
                    </td>
                    <td className="px-3 py-3.5 text-center text-muted-foreground border-r border-border/60 whitespace-nowrap">
                      <span className="rounded-md bg-secondary/80 px-2 py-0.5 font-medium text-foreground">
                        {ch.total_events} lượt
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {ch.status_badge}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Orders Status Funnel & System Operations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Orders Breakdown Funnel */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">
              Phân Bổ Trạng Thái Đơn Hàng
            </h3>
            <button
              onClick={() => onNavigateTab("orders")}
              className="flex items-center text-xs font-semibold text-primary hover:underline"
            >
              Xem chi tiết đơn <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Awaiting */}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 text-amber-500" /> Chờ Shopee đối soát
                </span>
                <span className="font-semibold text-foreground">
                  {metrics.orders.awaiting} đơn (
                  {metrics.orders.total > 0
                    ? Math.round((metrics.orders.awaiting / metrics.orders.total) * 100)
                    : 0}
                  %)
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{
                    width: `${
                      metrics.orders.total > 0
                        ? (metrics.orders.awaiting / metrics.orders.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            {/* Approved */}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <PackageCheck className="h-3.5 w-3.5 text-sky-500" /> Đã duyệt (Chờ hoàn tiền)
                </span>
                <span className="font-semibold text-foreground">
                  {metrics.orders.approved} đơn (
                  {metrics.orders.total > 0
                    ? Math.round((metrics.orders.approved / metrics.orders.total) * 100)
                    : 0}
                  %)
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-sky-500 transition-all"
                  style={{
                    width: `${
                      metrics.orders.total > 0
                        ? (metrics.orders.approved / metrics.orders.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            {/* Paid */}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Gift className="h-3.5 w-3.5 text-emerald-500" /> Đã hoàn tiền cho khách
                </span>
                <span className="font-semibold text-foreground">
                  {metrics.orders.paid} đơn (
                  {metrics.orders.total > 0
                    ? Math.round((metrics.orders.paid / metrics.orders.total) * 100)
                    : 0}
                  %)
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{
                    width: `${
                      metrics.orders.total > 0
                        ? (metrics.orders.paid / metrics.orders.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            {/* Rejected */}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <XCircle className="h-3.5 w-3.5 text-destructive" /> Shopee từ chối / Hủy
                </span>
                <span className="font-semibold text-foreground">
                  {metrics.orders.rejected} đơn (
                  {metrics.orders.total > 0
                    ? Math.round((metrics.orders.rejected / metrics.orders.total) * 100)
                    : 0}
                  %)
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-destructive transition-all"
                  style={{
                    width: `${
                      metrics.orders.total > 0
                        ? (metrics.orders.rejected / metrics.orders.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Right: Operational Health Card */}
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-bold text-foreground">
            Thông Số Vận Hành Hệ Thống
          </h3>
          <div className="space-y-3.5 text-xs">
            <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
              <span className="text-muted-foreground">Trạng thái Bot Zalo:</span>
              <Badge variant="success" className="text-[10px]">
                <span className="mr-1 h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> Trực Tuyến 24/7
              </Badge>
            </div>
            <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
              <span className="text-muted-foreground">Tỷ lệ Shopee duyệt đơn:</span>
              <span className="font-bold text-foreground">
                {kpis.approval_rate}%
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
              <span className="text-muted-foreground">Sản phẩm trong cache:</span>
              <span className="font-bold text-foreground">
                {metrics.cached_products} SP
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
              <span className="text-muted-foreground">Đội ngũ quản trị / nhân sự:</span>
              <span className="font-bold text-foreground">
                {metrics.total_employees} người
              </span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-muted-foreground">Nhật ký theo dõi hành vi:</span>
              <button
                onClick={() => onNavigateTab("logs")}
                className="font-bold text-primary hover:underline"
              >
                {metrics.total_logs} sự kiện
              </button>
            </div>
          </div>
        </Card>
      </div>

      {/* Dual Leaderboards: Top VIP Customers & Top Converting Products */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Leaderboard 1: Top 5 VIP Customers */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-bold text-foreground">
                Top 5 Khách Hàng VIP
              </h3>
            </div>
            <button
              onClick={() => onNavigateTab("users")}
              className="flex items-center text-xs font-semibold text-primary hover:underline"
            >
              Xem tất cả <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </div>

          {topCustomers.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Chưa có dữ liệu khách hàng trong khoảng thời gian này
            </div>
          ) : (
            <div className="space-y-3">
              {topCustomers.map((cust, idx) => {
                const rankIcons = ["🥇", "🥈", "🥉", "#4", "#5"]
                const rankColors = [
                  "bg-amber-500/15 text-amber-600 font-bold",
                  "bg-slate-400/15 text-slate-500 font-bold",
                  "bg-amber-700/15 text-amber-800 dark:text-amber-600 font-bold",
                  "bg-secondary text-muted-foreground",
                  "bg-secondary text-muted-foreground",
                ]

                return (
                  <div
                    key={cust.customer_id}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/20 p-3 transition-colors hover:bg-secondary/40"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs ${rankColors[idx]}`}
                      >
                        {rankIcons[idx]}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-foreground">
                          {cust.display_name || cust.customer_id}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>{cust.total_orders} đơn hàng</span>
                          <span>•</span>
                          <span>GMV {vnd(cust.total_gmv)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-amber-600 dark:text-amber-400">
                        +{vnd(cust.total_commission)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Hoàn {vnd(cust.total_cashback)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Leaderboard 2: Top 5 Earning Products */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-rose-500" />
              <h3 className="text-sm font-bold text-foreground">
                Top 5 Mặt Hàng Sinh Lời Cao Nhất
              </h3>
            </div>
            <button
              onClick={() => onNavigateTab("products")}
              className="flex items-center text-xs font-semibold text-primary hover:underline"
            >
              Xem kho cache <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </div>

          {topProducts.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Chưa có dữ liệu sản phẩm trong khoảng thời gian này
            </div>
          ) : (
            <div className="space-y-3">
              {topProducts.map((prod, idx) => {
                const targetUrl = prod.affiliate_url || prod.source_url
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/20 p-3 transition-colors hover:bg-secondary/40"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                        #{idx + 1}
                      </div>
                      <div className="min-w-0">
                        <div
                          className="line-clamp-1 text-xs font-semibold text-foreground"
                          title={prod.name}
                        >
                          {prod.name}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>{prod.orders_count} lượt mua</span>
                          <span>•</span>
                          <span>GMV {vnd(prod.total_gmv)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          +{vnd(prod.total_commission)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Hoàn {vnd(prod.total_cashback)}
                        </div>
                      </div>
                      {targetUrl && (
                        <a
                          href={targetUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Mở link sản phẩm"
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
