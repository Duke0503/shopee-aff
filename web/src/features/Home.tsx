import * as React from "react"
import { Footer, Header } from "@/components/Chrome"
import { Card } from "@/components/ui/card"
import { Icon } from "@/lib/icons"
import { Reveal } from "@/components/Reveal"
import { vnd } from "@/lib/format"
import { useT } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { LinkGenerator } from "@/features/LinkGenerator"
import { ZaloCommunityBanner } from "@/features/ZaloCommunityBanner"

export function Home() {
  const t = useT()

  return (
    <>
      <Header current="home" />

      <main className="min-w-0 overflow-x-hidden">
        {/* HERO: Unboxed Command Capsule */}
        <section className="hero-wash border-b border-border/40 py-10 sm:py-16">
          <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
            <div className="text-center max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3.5 py-1 text-xs font-medium text-foreground/85 shadow-2xs backdrop-blur-xs mb-5 select-none">
                <span className="size-1.5 rounded-full bg-success animate-pulse" />
                <span>{t("home_hero_badge")}</span>
              </div>

              <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-foreground leading-[1.15]">
                {t("home_hero_title")}
              </h1>

              <p className="text-muted-foreground mt-3.5 text-sm sm:text-base leading-relaxed max-w-xl mx-auto">
                {t("home_hero_lead")}
              </p>
            </div>

            <div className="mt-8 mb-5">
              <Reveal delay={30}>
                <LinkGenerator />
              </Reveal>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs text-muted-foreground">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 py-1 shadow-2xs backdrop-blur-xs">
                <Icon.flash className="size-3 text-warning shrink-0" />
                <span>{t("home_trust_badge_1")}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 py-1 shadow-2xs backdrop-blur-xs">
                <Icon.confirm className="size-3 text-success shrink-0" />
                <span>{t("home_trust_badge_2")}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 py-1 shadow-2xs backdrop-blur-xs">
                <Icon.order className="size-3 text-primary shrink-0" />
                <span>{t("home_trust_badge_3")}</span>
              </div>
            </div>
          </div>
        </section>

        {/* BENTO GRID */}
        <section className="py-10 sm:py-14">
          <div className="mx-auto max-w-[1100px] px-4 sm:px-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
              <div className="flex">
                <Reveal delay={50} className="w-full">
                  <ZaloCommunityBanner />
                </Reveal>
              </div>

              <div className="flex">
                <Reveal delay={70} className="w-full">
                  <CashbackCalculator />
                </Reveal>
              </div>
            </div>

            <Reveal delay={90}>
              <Card className="luxury-panel p-6 sm:p-8 border border-border/80 shadow-md">
                <div className="flex items-center justify-between border-b border-border/50 pb-4 mb-6">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {t("bento_how_badge")}
                    </span>
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground mt-0.5">
                      {t("home_how_title")}
                    </h2>
                  </div>
                  <span className="size-2 rounded-full bg-primary" />
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  {[1, 2, 3].map((step) => (
                    <div key={step} className="relative space-y-2 rounded-xl bg-muted/20 border border-border/40 p-4 sm:p-5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-primary tracking-widest bg-primary/10 px-2 py-0.5 rounded">
                          0{step}
                        </span>
                        <span className="size-1 rounded-full bg-muted-foreground/30" />
                      </div>
                      <h3 className="font-semibold text-base text-foreground pt-1">
                        {t(`home_how_${step}_title`)}
                      </h3>
                      <p className="text-muted-foreground text-xs sm:text-sm leading-relaxed">
                        {t(`home_how_${step}_body`)}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </Reveal>

            <Reveal delay={110}>
              <Card className="luxury-panel p-6 sm:p-8 border border-border/80 shadow-xs">
                <div className="border-b border-border/50 pb-4 mb-5">
                  <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                    {t("home_terms_title")}
                  </h2>
                  <p className="text-muted-foreground mt-1 text-xs sm:text-sm leading-relaxed">
                    {t("home_terms_lead")}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {[1, 2, 3, 4].map((n) => (
                    <div key={n} className="flex items-start gap-3 rounded-xl bg-muted/15 border border-border/30 p-3 text-xs sm:text-sm text-foreground/85">
                      <Icon.rejected className="text-destructive mt-0.5 size-4 shrink-0" />
                      <span className="leading-snug">{t(`home_terms_${n}`)}</span>
                    </div>
                  ))}
                </div>

                <div className="text-muted-foreground mt-5 space-y-1.5 border-t border-border/50 pt-4 text-xs">
                  <p>{t("home_terms_when")}</p>
                  <p>{t("home_terms_tax")}</p>
                </div>
              </Card>
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </>
  )
}

function CashbackCalculator() {
  const t = useT()
  const [orderValue, setOrderValue] = React.useState(500000)

  const presets = [
    { label: "100k", value: 100000 },
    { label: "500k", value: 500000 },
    { label: "1M", value: 1000000 },
    { label: "2M", value: 2000000 },
  ]

  const grossCommission = Math.round(orderValue * 0.08)
  const netCommission = Math.round(grossCommission * (1 - 0.10 - 0.0098))
  const cashback = Math.round(netCommission * 0.8)

  return (
    <Card className="luxury-panel h-full p-5 sm:p-7 flex flex-col justify-between border border-border/80 shadow-md">
      <div>
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-soft px-2.5 py-0.5 text-[11px] font-semibold text-success">
            <span>80% CASHBACK</span>
          </div>
          <Icon.payable className="size-4 text-muted-foreground" />
        </div>

        <h3 className="mt-3.5 text-lg sm:text-xl font-bold tracking-tight text-foreground">
          {t("bento_calc_title")}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {t("bento_calc_lead")}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setOrderValue(p.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold font-mono transition-all cursor-pointer",
                orderValue === p.value
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/40 text-muted-foreground hover:text-foreground border border-border/60"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-border/60 bg-muted/15 p-4 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("bento_calc_order_val")}:</span>
            <span className="font-semibold text-foreground font-mono">{vnd(orderValue)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border/40 pt-2">
            <span className="text-muted-foreground">{t("bento_calc_commission_label")}</span>
            <span className="font-semibold text-foreground font-mono">{vnd(grossCommission)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border/40 pt-2">
            <span className="text-muted-foreground">Thực nhận Shopee (-10.98%):</span>
            <span className="font-semibold text-foreground font-mono">{vnd(netCommission)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
            <span className="font-bold text-foreground text-xs sm:text-sm">{t("bento_calc_cashback_val")}</span>
            <span className="text-success text-xl sm:text-2xl font-bold font-mono tracking-tight">{vnd(cashback)}</span>
          </div>
        </div>

        <p className="text-muted-foreground mt-4 text-[11px] leading-relaxed">
          {t("bento_calc_note")}
        </p>
      </div>
    </Card>
  )
}
