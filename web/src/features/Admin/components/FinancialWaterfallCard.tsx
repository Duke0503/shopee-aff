import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { vnd } from "@/lib/format"
import type { AdminMetrics } from "@/lib/api"
import {
  TrendingUp,
  ShieldCheck,
  Building2,
  CheckCircle2,
  Clock,
  DollarSign,
  AlertCircle,
} from "lucide-react"

interface FinancialWaterfallCardProps {
  financials: NonNullable<AdminMetrics["financials"]>
  kpis?: AdminMetrics["kpis"]
}

export function FinancialWaterfallCard({ financials: fin }: FinancialWaterfallCardProps) {
  const gross = fin.gross_commission || 0
  const fee = fin.shopee_fee ?? Math.round(gross * 0.0098)
  const tax = fin.tax_withheld ?? Math.round(gross * 0.10)
  const netShopee = fin.net_from_shopee ?? (gross - fee - tax)

  const cashbackPaid = fin.cashback_paid || 0
  const cashbackReady = fin.cashback_ready || 0
  const cashbackPipeline = fin.cashback_pipeline || 0
  const totalCashback = fin.total_cashback_all ?? fin.total_cashback ?? (cashbackPaid + cashbackReady + cashbackPipeline)

  // Lợi nhuận dự tính = Thực nhận Shopee - Toàn bộ tiền hoàn (Đã hoàn + Chờ hoàn + Dự tính sẽ hoàn)
  const estimatedProfit = fin.estimated_net_profit ?? (netShopee - totalCashback)
  const estimatedMargin = fin.estimated_net_margin ?? (gross > 0 ? Math.round((estimatedProfit / gross) * 1000) / 10 : 9.0)

  // Lợi nhuận thực thu = Đã duyệt/nhận trừ đi các khoản đã hoàn hoặc chờ hoàn
  const realizedProfit = fin.realized_net_profit || 0
  const realizedMargin = fin.realized_net_margin || 0

  const paperProfit = fin.paper_profit ?? (gross - totalCashback)
  const paperMargin = fin.paper_margin ?? (gross > 0 ? Math.round((paperProfit / gross) * 1000) / 10 : 20.0)

  return (
    <Card className="overflow-hidden border border-border/80 shadow-xs p-4 sm:p-5">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Báo Cáo Dòng Tiền & Lợi Nhuận Dự Tính
            </span>
            <Badge variant="default" className="bg-emerald-500/15 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              Minh Bạch Dòng Tiền 100%
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Hạch toán chi tiết khấu trừ từ Shopee, số tiền đã hoàn, dự tính sẽ hoàn khách và lợi nhuận dự tính thực nhận.
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1 sm:pt-0">
          <div className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-right border border-emerald-500/20">
            <div className="text-[10px] text-emerald-700 dark:text-emerald-300 uppercase font-medium">
              Biên Lợi Nhuận (Dự Tính)
            </div>
            <div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
              {estimatedMargin}%
            </div>
          </div>
        </div>
      </div>

      {/* 6-Step Waterfall Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
        {/* Step 1: Gross */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                1. Hoa Hồng Gộp
              </span>
              <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Trước mọi thuế & phí</div>
            <div className="mt-2 text-base font-bold font-mono text-foreground">
              {vnd(gross)}
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground border-t border-amber-500/20 pt-1.5">
            100% doanh thu tiếp thị
          </div>
        </div>

        {/* Step 2: Deductions */}
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-destructive">
                2. Sàn Khấu Trừ
              </span>
              <Building2 className="h-3.5 w-3.5 text-destructive" />
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Thuế & phí Shopee</div>
            <div className="mt-2 text-base font-bold font-mono text-destructive">
              -{vnd(fee + tax)}
            </div>
          </div>
          <div className="mt-2 text-[10px] space-y-0.5 text-muted-foreground border-t border-destructive/20 pt-1.5">
            <div className="flex justify-between">
              <span>Thuế (10%):</span>
              <span className="font-mono text-destructive">-{vnd(tax)}</span>
            </div>
            <div className="flex justify-between">
              <span>Phí sàn (0.98%):</span>
              <span className="font-mono text-destructive">-{vnd(fee)}</span>
            </div>
          </div>
        </div>

        {/* Step 3: Net Shopee */}
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                3. Thực Nhận Shopee
              </span>
              <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Sau khấu trừ thuế & phí</div>
            <div className="mt-2 text-base font-bold font-mono text-blue-700 dark:text-blue-300">
              {vnd(netShopee)}
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground border-t border-blue-500/20 pt-1.5">
            Chiếm ~89.02% hoa hồng
          </div>
        </div>

        {/* Step 4: Already Paid Cashback */}
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                4. Số Tiền Đã Hoàn
              </span>
              <CheckCircle2 className="h-3.5 w-3.5 text-violet-500" />
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Thực tế đã chuyển khoản</div>
            <div className="mt-2 text-base font-bold font-mono text-foreground">
              {cashbackPaid > 0 ? `-${vnd(cashbackPaid)}` : vnd(0)}
            </div>
          </div>
          <div className="mt-2 text-[10px] space-y-0.5 text-muted-foreground border-t border-violet-500/20 pt-1.5">
            <div className="flex justify-between">
              <span>Chờ chi trả:</span>
              <span className="font-mono font-medium text-foreground">{vnd(cashbackReady)}</span>
            </div>
          </div>
        </div>

        {/* Step 5: Estimated Pipeline Cashback */}
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                5. Dự Tính Sẽ Hoàn
              </span>
              <Clock className="h-3.5 w-3.5 text-sky-500" />
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Đơn đang chờ duyệt</div>
            <div className="mt-2 text-base font-bold font-mono text-sky-700 dark:text-sky-300">
              {cashbackPipeline > 0 ? `-${vnd(cashbackPipeline)}` : vnd(0)}
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground border-t border-sky-500/20 pt-1.5">
            ~80% tiền chia cho khách
          </div>
        </div>

        {/* Step 6: Estimated Net Profit */}
        <div className="rounded-xl border-2 border-emerald-500/50 bg-emerald-500/10 p-3 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold text-emerald-800 dark:text-emerald-200">
                6. LỢI NHUẬN (DỰ TÍNH)
              </span>
              <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-[10px] text-emerald-700/80 dark:text-emerald-300/80 mt-0.5 font-medium">
              Sau thuế phí & trừ hoàn
            </div>
            <div className="mt-2 text-base sm:text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">
              {vnd(estimatedProfit)}
            </div>
          </div>
          <div className="mt-2 text-[10px] text-emerald-800/80 dark:text-emerald-200/80 border-t border-emerald-500/30 pt-1.5 flex items-center justify-between font-medium">
            <span>Biên lãi:</span>
            <span className="font-mono font-bold">{estimatedMargin}%</span>
          </div>
        </div>
      </div>

      {/* Comparison Note: Paper vs Real Profit */}
      <div className="mt-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 rounded-xl bg-secondary/30 p-3 text-xs border border-border/50">
        <div className="flex items-start gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
          <div className="leading-snug text-[11px]">
            <strong className="text-foreground">Công thức tính minh bạch: </strong>
            Thực Nhận Shopee (<span className="font-mono font-medium text-foreground">{vnd(netShopee)}</span>) − Số Tiền Đã Hoàn (<span className="font-mono font-medium text-foreground">{vnd(cashbackPaid)}</span>) − Dự Tính Sẽ Hoàn (<span className="font-mono font-medium text-foreground">{vnd(cashbackPipeline)}</span>) = 
            <strong className="text-emerald-600 dark:text-emerald-400"> Lợi Nhuận Dự Tính ({vnd(estimatedProfit)} ~ {estimatedMargin}%)</strong>.
            {" "}Lợi nhuận trên giấy trước thuế sàn là <span className="font-mono font-semibold text-foreground">{vnd(paperProfit)} ({paperMargin}%)</span>. Shopee tự động khấu trừ 10% thuế TNCN và 0.98% phí sàn. Khi Shopee duyệt đơn, lợi nhuận chuyển sang Thực Thu (đã chốt: <span className="font-mono font-medium text-foreground">{vnd(realizedProfit)} ({realizedMargin}%)</span>).
          </div>
        </div>
      </div>
    </Card>
  )
}
