import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Footer, Header } from "@/components/Chrome"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { IconChip } from "@/components/ui/icon-chip"
import { Mascot } from "@/components/Mascot"
import { Reveal } from "@/components/Reveal"
import { BankModal } from "@/components/BankModal"
import { OrderList } from "@/features/OrderList"
import { fetchMe } from "@/lib/api"
import { Icon } from "@/lib/icons"
import { vnd } from "@/lib/format"
import { useT } from "@/lib/labels"
import { navigate } from "@/routes"

/**
 * What one customer sees of their own ledger.
 *
 * They opened this to answer ONE question -- how much am I getting --
 * so one figure carries it and the other two sit underneath as context.
 * Three numbers at the same size answered nothing: the eye had nowhere
 * to land, and the page read as a report rather than an answer.
 *
 * Deliberately narrow beyond that: their orders, their three balances,
 * the last four digits of the account the money goes to. Nothing in
 * full, nothing about anyone else. The server enforces that too -- this
 * view has no endpoint that could return another person's row -- but
 * the shape of the page should make the intent obvious to whoever
 * changes it next.
 */
/** The bot greets by the clock, the way a person would. */
function greetingKey(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "me_greeting_morning"
  if (hour < 18) return "me_greeting_afternoon"
  return "me_greeting_evening"
}

export function CustomerView() {
  const t = useT()
  const [bankModalOpen, setBankModalOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  })

  if (isLoading) {
    return (
      <>
        <Header current="orders" />
        <p className="text-muted-foreground p-8 text-center text-sm">
          {t("loading")}
        </p>
      </>
    )
  }

  if (!data) {
    return (
      <>
        <Header current="orders" />
        <main className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
          <Mascot className="mx-auto size-24" mood="waiting" />
          <h1 className="mt-4 text-xl font-bold">
            {t("orders_signed_out_title")}
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {t("orders_signed_out_body")}
          </p>
          <Button size="lg" className="mt-6" onClick={() => navigate("login")}>
            <Icon.signIn /> {t("nav_login")}
          </Button>
        </main>
        <Footer />
      </>
    )
  }

  const { balance } = data

  return (
    <>
      <Header current="orders" />

      <main className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="truncate text-lg font-bold sm:text-xl">
            {t(greetingKey(), {
              name: data.display_name || data.customer_id,
            })}
          </h1>
          <p className="text-muted-foreground font-mono text-xs">
            {data.customer_id}
          </p>
        </div>

        {/* -- bank alert if not set -------------------------------- */}
        {!data.has_bank && (
          <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <div className="flex items-center gap-3">
              <Icon.warning className="text-warning size-5 shrink-0" />
              <p className="text-xs sm:text-sm text-foreground font-medium">
                {t("bank_banner_warning")}
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0 font-semibold"
              onClick={() => setBankModalOpen(true)}
            >
              <Icon.bank className="mr-1.5 size-3.5" />
              {t("bank_action_add")}
            </Button>
          </div>
        )}

        {/* -- the answer ------------------------------------------- */}
        <Reveal>
        <Card className="hero-wash overflow-hidden p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-muted-foreground text-sm">
                {t("me_headline_label")}
              </div>
              <div className="tnum mt-1 text-4xl leading-none font-bold sm:text-5xl">
                {vnd(balance.approved)}
              </div>
              {balance.approved > 0 ? (
                <p className="text-muted-foreground mt-2 text-sm">
                  {t("me_headline_orders", {
                    count: balance.approved_orders,
                  })}
                </p>
              ) : (
                <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
                  {t("me_headline_empty")}
                </p>
              )}
            </div>
            <Mascot
              className="hidden size-20 shrink-0 sm:block"
              mood={balance.approved > 0 ? "celebrating" : "happy"}
            />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4">
            <Secondary
              icon={Icon.pending}
              tone="warning"
              label={t("me_secondary_awaiting")}
              value={vnd(balance.awaiting)}
              note={t("summary_orders", { count: balance.awaiting_orders })}
            />
            <Secondary
              icon={Icon.paid}
              tone="success"
              label={t("me_secondary_paid")}
              value={vnd(balance.paid)}
            />
          </div>
        </Card>
        </Reveal>

        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
          {t("me_estimate_note")}
        </p>

        {/* -- orders ------------------------------------------------ */}
        <h2 className="mt-8 mb-3 text-sm font-semibold">
          {t("me_orders_title")}
        </h2>
        {data.orders.length ? (
          <Reveal delay={90}>
            <OrderList orders={data.orders} />
          </Reveal>
        ) : (
          <Card className="p-8 text-center">
            <Mascot className="mx-auto size-24" mood="waiting" />
            <p className="text-muted-foreground mx-auto mt-4 max-w-sm text-sm leading-relaxed">
              {t("me_no_orders")}
            </p>
          </Card>
        )}

        {/* -- bank summary card ------------------------------------ */}
        <div className="mt-10 rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <IconChip icon={Icon.bank} tone={data.has_bank ? "success" : "warning"} size="sm" />
              <div className="min-w-0">
                <div className="text-muted-foreground text-xs font-medium">
                  {t("profile_bank_section")}
                </div>
                {data.has_bank ? (
                  <div className="mt-0.5 truncate text-sm font-semibold">
                    {data.bank_name} &middot; <span className="font-mono font-normal">···{data.bank_account_tail}</span>{" "}
                    {data.account_holder && <span className="text-muted-foreground font-normal text-xs uppercase">({data.account_holder})</span>}
                  </div>
                ) : (
                  <p className="text-warning mt-0.5 text-xs font-medium">
                    {t("profile_bank_not_set")}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant={data.has_bank ? "outline" : "default"}
              size="sm"
              className="shrink-0 text-xs font-medium"
              onClick={() => setBankModalOpen(true)}
            >
              <Icon.edit className="mr-1.5 size-3.5" />
              {data.has_bank ? t("bank_action_edit") : t("bank_action_add")}
            </Button>
          </div>
        </div>

        <BankModal
          open={bankModalOpen}
          onOpenChange={setBankModalOpen}
          initialBankName={data.bank_name}
          initialHolder={data.account_holder}
        />
      </main>

      <Footer />
    </>
  )
}

function Secondary({
  icon,
  tone,
  label,
  value,
  note,
}: {
  icon: React.ComponentProps<typeof IconChip>["icon"]
  tone: React.ComponentProps<typeof IconChip>["tone"]
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <IconChip icon={icon} tone={tone} size="sm" />
      <div className="min-w-0">
        <div className="text-muted-foreground text-[11px] leading-tight">
          {label}
        </div>
        <div className="tnum text-base font-semibold">{value}</div>
        {note && (
          <div className="text-muted-foreground text-[11px]">{note}</div>
        )}
      </div>
    </div>
  )
}
