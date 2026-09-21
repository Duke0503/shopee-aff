import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Icon } from "@/lib/icons"
import { useT } from "@/lib/labels"

const ZALO_GROUP_URL = "https://zalo.me/g/645qel4gnwism4gagqxh"

export function ZaloCommunityBanner() {
  const t = useT()

  return (
    <Card className="luxury-panel relative overflow-hidden border border-border/80 p-6 sm:p-7 md:p-8 shadow-md w-full h-full flex flex-col justify-between">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <div className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-xs font-semibold text-foreground/85 shadow-2xs backdrop-blur-xs">
          <Icon.chat className="size-3.5 text-primary" />
          <span>{t("zalo_community_badge")}</span>
        </div>

        <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground break-words leading-tight">
          {t("zalo_community_title")}
        </h2>

        <p className="text-muted-foreground text-xs sm:text-sm md:text-base leading-relaxed">
          {t("zalo_community_lead")}
        </p>

        <ul className="space-y-3 text-xs sm:text-sm text-foreground/90 font-medium pt-1">
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
