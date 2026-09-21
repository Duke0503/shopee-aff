import { Header, Footer } from "@/components/Chrome"
import { Card } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Mascot } from "@/components/Mascot"
import { Reveal } from "@/components/Reveal"
import { Icon, type LucideIcon } from "@/lib/icons"
import { useT } from "@/lib/labels"
import { navigate } from "@/routes"

export function Guide() {
  const t = useT()

  return (
    <>
      <Header current="guide" />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {t("guide_title")}
              </h1>
              <p className="text-muted-foreground mt-2 text-sm max-w-xl leading-relaxed">
                {t("guide_subtitle")}
              </p>
            </div>
            <Mascot className="mx-auto size-16 shrink-0 sm:mx-0" mood="happy" />
          </div>
        </div>

        <Tabs defaultValue="steps" className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-auto p-1">
            <TabsTrigger value="steps" className="text-xs py-2 px-1 text-center whitespace-normal sm:text-sm">{t("guide_tab_steps")}</TabsTrigger>
            <TabsTrigger value="policy" className="text-xs py-2 px-1 text-center whitespace-normal sm:text-sm">{t("guide_tab_policy")}</TabsTrigger>
            <TabsTrigger value="terms" className="text-xs py-2 px-1 text-center whitespace-normal sm:text-sm">{t("guide_tab_terms")}</TabsTrigger>
          </TabsList>

          {/* TAB 1: STEPS */}
          <TabsContent value="steps" className="mt-6 space-y-4">
            <Reveal>
              <div className="grid gap-4 sm:grid-cols-2">
                <StepCard
                  step="1"
                  title={t("guide_step1_title")}
                  desc={t("guide_step1_desc")}
                  icon={Icon.signIn}
                />
                <StepCard
                  step="2"
                  title={t("guide_step2_title")}
                  desc={t("guide_step2_desc")}
                  icon={Icon.send}
                />
                <StepCard
                  step="3"
                  title={t("guide_step3_title")}
                  desc={t("guide_step3_desc")}
                  icon={Icon.order}
                />
                <StepCard
                  step="4"
                  title={t("guide_step4_title")}
                  desc={t("guide_step4_desc")}
                  icon={Icon.bank}
                  highlight
                />
              </div>
            </Reveal>

            {/* Box hướng dẫn lấy ID & Mật khẩu */}
            <Reveal delay={20}>
              <Card className="p-5 sm:p-6 border-primary/30 bg-primary/5">
                <div className="flex items-start gap-3.5">
                  <div className="bg-primary/15 text-primary grid size-10 place-items-center rounded-xl shrink-0">
                    <Icon.password className="size-5" />
                  </div>
                  <div className="space-y-2 flex-1">
                    <h3 className="font-bold text-base sm:text-lg text-foreground">
                      🔑 Hướng dẫn lấy Mã Khách Hàng (ID) & Mật khẩu qua Bot Zalo
                    </h3>
                    <p className="text-muted-foreground text-xs sm:text-sm leading-relaxed">
                      Để bảo mật thông tin cá nhân và tránh lộ mật khẩu trong nhóm chung, các lệnh tra cứu tài khoản được thực hiện qua <strong>tin nhắn riêng (inbox 1-1) với Bot</strong>:
                    </p>
                    <div className="grid gap-2.5 sm:grid-cols-3 pt-2 text-xs">
                      <div className="rounded-lg border bg-card p-3 space-y-1">
                        <span className="font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">/id</span>
                        <div className="font-medium text-foreground">Lấy Mã Khách Hàng</div>
                        <div className="text-muted-foreground text-[11px]">Dùng để nhập trên website khi tạo link hoàn tiền hoặc đăng nhập.</div>
                      </div>
                      <div className="rounded-lg border bg-card p-3 space-y-1">
                        <span className="font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">/matkhau</span>
                        <div className="font-medium text-foreground">Nhận Mật Khẩu Web</div>
                        <div className="text-muted-foreground text-[11px]">Bot sẽ cấp mật khẩu riêng để đăng nhập https://hoantiendp.com.</div>
                      </div>
                      <div className="rounded-lg border bg-card p-3 space-y-1">
                        <span className="font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">/sodu</span>
                        <div className="font-medium text-foreground">Kiểm Tra Tiền Hoàn</div>
                        <div className="text-muted-foreground text-[11px]">Xem nhanh số tiền hoàn đã sẵn sàng rút và đơn chờ đối soát.</div>
                      </div>
                    </div>
                    <p className="text-muted-foreground text-[11px] italic pt-1">
                      💡 Mẹo: Nếu bạn vô tình gõ lệnh trong nhóm Zalo chung, Bot sẽ tự động nhắc bạn bấm vào avatar Bot để nhắn tin riêng, đảm bảo tài khoản của bạn luôn được bảo vệ tối đa!
                    </p>
                  </div>
                </div>
              </Card>
            </Reveal>

            <div className="mt-6 flex flex-wrap justify-center gap-3 pt-4">
              <Button size="lg" className="w-full sm:w-auto" onClick={() => navigate("orders")}>
                <Icon.order className="mr-1.5" /> {t("home_cta_check")}
              </Button>
            </div>
          </TabsContent>

          {/* TAB 2: POLICY */}
          <TabsContent value="policy" className="mt-6 space-y-6">
            <Reveal>
              <Card className="p-6">
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 text-primary grid size-9 place-items-center rounded-lg shrink-0">
                    <Icon.payable className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{t("guide_policy_title")}</h2>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {t("guide_policy_lead")}
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="bg-secondary/40 rounded-lg p-4">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <Icon.confirm className="text-success size-4 shrink-0" />
                      <span>{t("home_reassure_1")}</span>
                    </div>
                    <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                      {t("guide_policy_free")}
                    </p>
                  </div>

                  <div className="bg-secondary/40 rounded-lg p-4">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <Icon.pending className="text-warning size-4 shrink-0" />
                      <span>{t("home_terms_when")}</span>
                    </div>
                    <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                      {t("guide_policy_timing")}
                    </p>
                  </div>
                </div>

                {/* Worked example */}
                <div className="mt-6 border-t pt-5">
                  <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                    {t("home_hero_example_label")}
                  </div>
                  <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border bg-card p-4">
                    <div className="space-y-1">
                      <div className="text-sm">
                        {t("home_hero_example_order")} &middot;{" "}
                        <span className="text-muted-foreground">
                          {t("home_hero_example_commission")}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {t("home_hero_example_cashback")}
                      </div>
                    </div>
                    <div className="tnum text-success text-2xl sm:text-3xl font-bold">
                      {t("home_hero_example_amount")}
                    </div>
                  </div>
                </div>
              </Card>
            </Reveal>
          </TabsContent>

          {/* TAB 3: TERMS */}
          <TabsContent value="terms" className="mt-6 space-y-6">
            <Reveal>
              <Card className="p-6">
                <div className="flex items-start gap-3">
                  <div className="bg-destructive/10 text-destructive grid size-9 place-items-center rounded-lg shrink-0">
                    <Icon.warning className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{t("guide_terms_title")}</h2>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t("home_terms_lead")}
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <div className="flex items-start gap-3 text-sm">
                    <Icon.rejected className="text-destructive mt-0.5 size-4 shrink-0" />
                    <span>{t("guide_terms_1")}</span>
                  </div>
                  <div className="flex items-start gap-3 text-sm">
                    <Icon.rejected className="text-destructive mt-0.5 size-4 shrink-0" />
                    <span>{t("guide_terms_2")}</span>
                  </div>
                  <div className="flex items-start gap-3 text-sm">
                    <Icon.rejected className="text-destructive mt-0.5 size-4 shrink-0" />
                    <span>{t("guide_terms_3")}</span>
                  </div>
                  <div className="flex items-start gap-3 text-sm">
                    <Icon.rejected className="text-destructive mt-0.5 size-4 shrink-0" />
                    <span>{t("guide_terms_4")}</span>
                  </div>
                </div>

                <div className="mt-6 border-t pt-4 space-y-3">
                  <div className="rounded-lg bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
                    <div className="font-semibold text-foreground mb-1">
                      {t("guide_privacy_title")}
                    </div>
                    {t("guide_privacy_desc")}
                  </div>

                  <div className="text-muted-foreground text-xs leading-relaxed">
                    {t("guide_terms_tax")}
                  </div>
                </div>
              </Card>
            </Reveal>
          </TabsContent>
        </Tabs>
      </main>

      <Footer />
    </>
  )
}

function StepCard({
  step,
  title,
  desc,
  icon: IconComponent,
  highlight,
}: {
  step: string
  title: string
  desc: string
  icon: LucideIcon
  highlight?: boolean
}) {
  return (
    <Card className={`h-full p-5 flex flex-col justify-between ${highlight ? "border-primary/50 bg-primary/5" : ""}`}>
      <div>
        <div className="flex items-center justify-between">
          <div className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-full text-xs font-bold">
            {step}
          </div>
          <IconComponent className="text-muted-foreground size-5" />
        </div>
        <h3 className="mt-3 font-semibold text-base">{title}</h3>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          {desc}
        </p>
      </div>
    </Card>
  )
}
