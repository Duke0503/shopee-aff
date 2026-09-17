import { Footer, Header } from "@/components/Chrome"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { IconChip, type Tone } from "@/components/ui/icon-chip"
import { Icon } from "@/lib/icons"
import { Mascot } from "@/components/Mascot"
import { Reveal } from "@/components/Reveal"
import { useT } from "@/lib/labels"
import { navigate } from "@/routes"

/**
 * The page a link from a Zalo group actually opens.
 *
 * Two things have to happen above the fold, in this order. First, a
 * figure the reader can turn into money without doing arithmetic: "80%
 * of commission" is the language of affiliate marketing, and a shopper
 * reads it as 80% of the order. Second, the question every one of them
 * is holding and none of them will type -- whether this actually pays.
 *
 * That second one is not answered with the word "trusted". It is
 * answered by the thing this bot has and the groups it competes with do
 * not: the customer can open their own orders and see the state Shopee
 * put them in. So that is the section directly under the fold, not a
 * feature bullet three screens down.
 */
export function Home() {
  const t = useT()

  return (
    <>
      <Header current="home" />

      <main>
        {/* The one washed band on the site. Used twice, it stops
            meaning anything. */}
        <div className="hero-wash">
          <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
        {/* -- the offer, as money ------------------------------------ */}
        <section className="py-12 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <Mascot className="mb-4 size-16 lg:hidden" />
              <h1 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
                {t("home_hero_title")}
              </h1>
              <p className="text-muted-foreground mt-4 text-base leading-relaxed sm:text-lg">
                {t("home_hero_lead")}
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" className="w-full sm:w-auto" onClick={() => navigate("orders")}>
                  <Icon.order /> {t("home_cta_check")}
                </Button>
                <Button size="lg" variant="outline" className="w-full sm:w-auto" onClick={() => navigate("login")}>
                  <Icon.signIn /> {t("nav_login")}
                </Button>
              </div>
              {/* The second objection, after "will they actually
                  pay": whether buying through a link costs more. It is
                  never typed and never asked, so it is answered here. */}
              <ul className="mt-6 space-y-1.5">
                {[1, 2, 3].map((n) => (
                  <li key={n} className="flex items-center gap-2 text-sm">
                    <Icon.confirm className="text-success size-4 shrink-0" />
                    <span>{t(`home_reassure_${n}`)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* The worked example, given the weight of a headline
                because it is the only number anyone can act on. */}
            <Reveal delay={80}>
            <Card className="relative p-6">
              <Mascot className="absolute -top-7 -right-3 hidden size-20 lg:block" mood="celebrating" />
              <div className="text-muted-foreground text-xs">
                {t("home_hero_example_label")}
              </div>
              <div className="mt-4 space-y-3">
                <Line label={t("home_hero_example_order")} />
                <Line label={t("home_hero_example_commission")} />
                <div className="border-t pt-3">
                  <div className="text-muted-foreground text-xs">
                    {t("home_hero_example_cashback")}
                  </div>
                  {/* Computed from the same two constants the bot's
                      greeting uses. Two worked examples that disagree
                      would be worse than none. */}
                  <div className="tnum text-success text-3xl font-bold">
                    {t("home_hero_example_amount")}
                  </div>
                </div>
              </div>
            </Card>
            </Reveal>
          </div>
        </section>

          </div>
        </div>

        <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
        {/* -- the objection nobody types ------------------------------ */}
        <section className="py-10">
          <h2 className="text-xl font-bold sm:text-2xl">{t("home_trust_title")}</h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
            {t("home_trust_lead")}
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
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

        {/* -- how ------------------------------------------------------ */}
        <section className="py-10">
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

        {/* -- the part most of these sites bury ------------------------ */}
        <section className="py-10">
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
