import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Icon } from "@/lib/icons"
import { useT } from "@/lib/labels"

const ZALO_GROUP_URL = "https://zalo.me/g/645qel4gnwism4gagqxh"

export function ZaloCommunityBanner() {
  const t = useT()

  return (
    <Card className="luxury-panel relative overflow-hidden border border-border/80 p-6 sm:p-7 md:p-8 shadow-md w-full h-full flex flex-col justify-between">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
      <div className="space-y-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-300 shadow-2xs backdrop-blur-xs">
          <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span>🥮 Sự Kiện Trung Thu — Nhóm Zalo Chính Thức</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 items-start sm:items-center">
          <div className="relative shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden shadow-md border border-amber-400/30 group">
            <img
              src="/autumn-square.jpg"
              alt="Đón Trung Thu Hoàn Tiền 80%"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <span className="absolute bottom-1 right-1 bg-black/75 backdrop-blur-xs text-[10px] font-bold text-amber-300 px-1.5 py-0.5 rounded">
              80%
            </span>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground break-words leading-tight">
              {t("zalo_community_title")}
            </h2>
            <p className="text-muted-foreground text-xs sm:text-sm leading-relaxed">
              {t("zalo_community_lead")}
            </p>
          </div>
        </div>

        <ul className="space-y-2.5 text-xs sm:text-sm text-foreground/90 font-medium pt-1">
          <li className="flex items-start gap-2.5">
            <span className="grid size-5 place-items-center rounded-full bg-success-soft text-success shrink-0 mt-0.5 border border-success/30">
              <Icon.confirm className="size-3" />
            </span>
            <span className="break-words leading-snug">{t("zalo_community_step_1")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="grid size-5 place-items-center rounded-full bg-success-soft text-success shrink-0 mt-0.5 border border-success/30">
              <Icon.confirm className="size-3" />
            </span>
            <span className="break-words leading-snug">{t("zalo_community_step_2")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="grid size-5 place-items-center rounded-full bg-success-soft text-success shrink-0 mt-0.5 border border-success/30">
              <Icon.confirm className="size-3" />
            </span>
            <span className="break-words leading-snug">{t("zalo_community_step_3")}</span>
          </li>
        </ul>
      </div>

      <div className="pt-6">
        <Button
          size="lg"
          className="h-12 w-full sm:w-auto gap-2.5 text-sm sm:text-base font-semibold px-7 shadow-xs rounded-xl cursor-pointer active:scale-[0.98] transition-transform"
          onClick={() => window.open(ZALO_GROUP_URL, "_blank")}
        >
          <Icon.chat className="size-4.5 shrink-0" />
          <span>{t("zalo_community_open_btn")}</span>
        </Button>
      </div>
    </Card>
  )
}
