import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { vnd } from "@/lib/format"
import type { AdminMetrics } from "@/lib/api"
import {
  TrendingUp,
  ShieldCheck,
  Building2,
  Gift,
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
  const cashback = fin.total_cashback || 0
  const realProfit = fin.actual_net_profit ?? fin.net_profit ?? (netShopee - cashback)
  const realMargin = fin.real_net_margin ?? (gross > 0 ? Math.round((realProfit / gross) * 1000) / 10 : 9.0)
  const paperProfit = fin.paper_profit ?? (gross - cashback)
  const paperMargin = fin.paper_margin ?? (gross > 0 ? Math.round((paperProfit / gross) * 1000) / 10 : 20.0)

  return (
    <Card className="overflow-hidden border border-border/80 shadow-xs p-4 sm:p-5">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Báo Cáo Dòng Tiền & Lợi Nhuận Thực Tế
            </span>
            <Badge variant="default" className="bg-emerald-500/15 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              Thực Thu 100% Minh Bạch
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Hạch toán chi tiết từng khoản khấu trừ từ Shopee, chi trả hoàn tiền khách và lợi nhuận ròng thực nhận về tài khoản.
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1 sm:pt-0">
          <div className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-right border border-emerald-500/20">
            <div className="text-[10px] text-emerald-700 dark:text-emerald-300 uppercase font-medium">
              Biên Lợi Nhuận Thực Tế
            </div>
            <div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
              {realMargin}%
            </div>
          </div>
        </div>
      </div>

      {/* 5-Step Waterfall Grid */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-4">
        {/* Step 1: Gross */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                1. Hoa Hồng Gộp
              </span>
              <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Trước mọi thuế & phí</div>
            <div className="mt-2 text-lg font-bold font-mono text-foreground">
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
            <div className="text-xs text-muted-foreground mt-0.5">Thuế & phí Shopee</div>
            <div className="mt-2 text-lg font-bold font-mono text-destructive">
              -{vnd(fee + tax)}
            </div>
          </div>
          <div className="mt-2 text-[10px] space-y-0.5 text-muted-foreground border-t border-destructive/20 pt-1.5">
            <div className="flex justify-between">
              <span>Thuế TNCN (10%):</span>
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
            <div className="text-xs text-muted-foreground mt-0.5">Shopee chi trả về ví</div>
            <div className="mt-2 text-lg font-bold font-mono text-blue-700 dark:text-blue-300">
              {vnd(netShopee)}
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground border-t border-blue-500/20 pt-1.5">
            Chiếm ~89.02% hoa hồng gộp
          </div>
        </div>

        {/* Step 4: Customer Cashback */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-primary">
                4. Hoàn Tiền Khách
              </span>
              <Gift className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Chia cho người mua</div>
            <div className="mt-2 text-lg font-bold font-mono text-foreground">
              -{vnd(cashback)}
            </div>
          </div>
          <div className="mt-2 text-[10px] space-y-0.5 text-muted-foreground border-t border-primary/20 pt-1.5">
            <div className="flex justify-between">
              <span>Đã chuyển:</span>
              <span className="font-mono font-semibold text-foreground">{vnd(fin.cashback_paid || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span>Chờ chi trả:</span>
              <span className="font-mono">{vnd(fin.cashback_ready || 0)}</span>
            </div>
          </div>
        </div>

        {/* Step 5: Real Admin Net Profit */}
        <div className="rounded-xl border-2 border-emerald-500/50 bg-emerald-500/10 p-3 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold text-emerald-800 dark:text-emerald-200">
                5. LỢI NHUẬN THỰC
              </span>
              <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-0.5 font-medium">
              Đút túi sau thuế phí
            </div>
            <div className="mt-2 text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              {vnd(realProfit)}
            </div>
          </div>
          <div className="mt-2 text-[10px] text-emerald-800/80 dark:text-emerald-200/80 border-t border-emerald-500/30 pt-1.5 flex items-center justify-between font-medium">
            <span>Thực lãi giữ lại:</span>
            <span className="font-mono font-bold">{realMargin}%</span>
          </div>
        </div>
      </div>

      {/* Comparison Note: Paper vs Real Profit */}
      <div className="mt-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 rounded-xl bg-secondary/30 p-3 text-xs border border-border/50">
        <div className="flex items-start gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
          <div className="leading-snug">
            <strong className="text-foreground">Lưu ý quan trọng về thuế & phí: </strong>
            Shopee tự động khấu trừ <strong>10% thuế TNCN</strong> tại nguồn (đối với hoa hồng kỳ thanh toán từ 2 triệu) và <strong>0.98% phí dịch vụ sàn</strong>.
            Lợi nhuận lý thuyết trên giấy trước thuế là <span className="font-mono font-semibold text-foreground">{vnd(paperProfit)} ({paperMargin}%)</span>, nhưng số tiền thực nhận về tài khoản của bạn là <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{vnd(realProfit)} ({realMargin}%)</span>.
          </div>
        </div>
      </div>
    </Card>
  )
}
