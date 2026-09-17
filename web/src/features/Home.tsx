import { Footer, Header } from "@/components/Chrome"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { IconChip, type Tone } from "@/components/ui/icon-chip"
import { Icon } from "@/lib/icons"
import { Mascot } from "@/components/Mascot"
import { Reveal } from "@/components/Reveal"
import { useT } from "@/lib/labels"
import { navigate } from "@/routes"
import { LinkGenerator } from "@/features/LinkGenerator"
import { ZaloCommunityBanner } from "@/features/ZaloCommunityBanner"

export function Home() {
  const t = useT()

  return (
    <>
      <Header current="home" />

      <main>
        {/* Hero Wash with Instant Tool on Top */}
        <div className="hero-wash">
          <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
            <section className="py-8 sm:py-12">
              <div className="text-center max-w-2xl mx-auto mb-6 sm:mb-8">
                <Mascot className="mx-auto mb-3 size-16" />
                <h1 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl text-foreground">
                  {t("home_hero_title")}
                </h1>
                <p className="text-muted-foreground mt-3 text-sm sm:text-base leading-relaxed">
                  {t("home_hero_lead")}
                </p>
              </div>

              {/* Instant Link Generator right in Hero Above-The-Fold */}
              <Reveal delay={40}>
                <LinkGenerator />
              </Reveal>

            </section>
          </div>
        </div>

        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 space-y-6">
          {/* Section 2: Zalo Community */}
          <section className="pt-6 pb-2">
            <Reveal delay={60}>
              <ZaloCommunityBanner />
            </Reveal>
          </section>

          {/* Section 3: Worked Example & Trust */}
          <section className="py-8">
            <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
              <div>
                <h2 className="text-xl font-bold sm:text-2xl">{t("home_trust_title")}</h2>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {t("home_trust_lead")}
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Button size="lg" className="w-full sm:w-auto" onClick={() => navigate("orders")}>
                    <Icon.order /> {t("home_cta_check")}
                  </Button>
                  <Button size="lg" variant="outline" className="w-full sm:w-auto" onClick={() => navigate("login")}>
                    <Icon.signIn /> {t("nav_login")}
                  </Button>
                </div>
              </div>

              <Reveal delay={80}>
                <Card className="relative p-6">
                  <Mascot className="absolute -top-7 -right-3 hidden size-20 lg:block" mood="celebrating" />
                  <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                    {t("home_hero_example_label")}
                  </div>
                  <div className="mt-4 space-y-3">
                    <Line label={t("home_hero_example_order")} />
                    <Line label={t("home_hero_example_commission")} />
                    <div className="border-t pt-3">
                      <div className="text-muted-foreground text-xs">
                        {t("home_hero_example_cashback")}
                      </div>
                      <div className="tnum text-success text-3xl font-bold">
                        {t("home_hero_example_amount")}
                      </div>
                    </div>
                  </div>
                </Card>
              </Reveal>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <Feature
                icon={Icon.order}
                tone="info"
                title={t("home_trust_1_title")}
                body={t("home_trust_1_body")}
              />
              <Feature
                icon={Icon.pending}
                tone="warning"
                title={t("home_trust_2_title")}
                body={t("home_trust_2_body")}
              />
              <Feature
                icon={Icon.warning}
                tone="primary"
                title={t("home_trust_3_title")}
                body={t("home_trust_3_body")}
              />
            </div>
          </section>

          {/* Section 4: How it works */}
          <section className="py-8">
            <h2 className="text-xl font-bold sm:text-2xl">{t("home_how_title")}</h2>
            <ol className="mt-6 grid gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((step) => (
                <li key={step}>
                  <Card className="h-full p-5">
                    <div className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-full text-xs font-bold">
                      {step}
                    </div>
                    <h3 className="mt-3 font-semibold">{t(`home_how_${step}_title`)}</h3>
                    <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                      {t(`home_how_${step}_body`)}
                    </p>
                  </Card>
                </li>
              ))}
            </ol>
          </section>

          {/* Section 5: Terms & conditions */}
          <section className="py-8">
            <Card className="p-6">
              <h2 className="text-xl font-bold">{t("home_terms_title")}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("home_terms_lead")}
              </p>
              <ul className="mt-5 space-y-2.5">
                {[1, 2, 3, 4].map((n) => (
                  <li key={n} className="flex gap-2.5 text-sm">
                    <Icon.rejected className="text-destructive mt-0.5 size-4 shrink-0" />
                    <span>{t(`home_terms_${n}`)}</span>
                  </li>
                ))}
              </ul>
              <div className="text-muted-foreground mt-5 space-y-1.5 border-t pt-4 text-xs">
                <p>{t("home_terms_when")}</p>
                <p>{t("home_terms_tax")}</p>
              </div>
            </Card>
          </section>
        </div>
      </main>

      <Footer />
    </>
  )
}

function Line({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      <span className="bg-muted-foreground/40 size-1.5 rounded-full" />
      {label}
    </div>
  )
}

function Feature({
  icon,
  tone,
  title,
  body,
}: {
  icon: React.ComponentProps<typeof IconChip>["icon"]
  tone: Tone
  title: string
  body: string
}) {
  return (
    <Card className="h-full p-5">
      <IconChip icon={icon} tone={tone} />
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{body}</p>
    </Card>
  )
}
