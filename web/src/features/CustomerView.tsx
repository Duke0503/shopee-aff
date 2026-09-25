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
import { LinkGenerator } from "@/features/LinkGenerator"
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
        <main className="mx-auto max-w-md px-4 pt-28 pb-16 text-center sm:px-6">
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

      <main className="mx-auto max-w-7xl px-4 pt-28 pb-14 sm:px-6 lg:px-12">
        {/* Top Greeting & Live Account Status Bar */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-on-surface">
                {t(greetingKey(), {
                  name: data.display_name || data.customer_code || data.customer_id,
                })}
              </h1>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high text-primary font-label-md text-label-md shadow-xs">
                <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  workspace_premium
                </span>
                <span>Hoàn 80% trọn đời</span>
              </span>
            </div>
            <p className="text-on-surface-variant text-xs mt-1.5 flex items-center gap-2 font-medium">
              <span className="size-2 rounded-full bg-primary animate-pulse" />
              <span>ID: <strong className="text-on-surface font-semibold">{data.customer_code || data.customer_id}</strong> &middot; Tài khoản bảo chứng Napas 24/7</span>
            </p>
          </div>
        </div>

        {/* -- bank alert if not set -------------------------------- */}
        {!data.has_bank && (
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <div className="flex items-center gap-3">
              <Icon.warning className="text-warning size-5 shrink-0" />
              <p className="text-xs sm:text-sm text-foreground font-medium">
                {t("bank_banner_warning")}
              </p>
            </div>
            <Button
              size="sm"
              className="w-full shrink-0 font-semibold sm:w-auto rounded-xl"
              onClick={() => setBankModalOpen(true)}
            >
              <Icon.bank className="mr-1.5 size-3.5" />
              {t("bank_action_add")}
            </Button>
          </div>
        )}

        {/* 3 Metric Tiles (Stitch Apple/Revolut FinTech Style) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Card 1: Approved */}
          <div className="rounded-2xl bg-surface-container-lowest p-5 sm:p-6 shadow-sm border border-border/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-wider">
                  <span className="material-symbols-outlined text-lg">account_balance_wallet</span>
                  <span>Sẵn sàng chuyển</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-primary-fixed/60 text-on-primary-fixed font-label-sm text-label-sm font-bold">
                  Khả dụng
                </span>
              </div>
              <div className="mt-3 text-2xl sm:text-3xl font-extrabold text-primary tnum tracking-tight">
                {vnd(balance.approved)}
              </div>
              <p className="text-on-surface-variant text-xs mt-1.5">
                {balance.approved > 0 ? `${balance.approved_orders} đơn đã chốt đối soát` : "Chưa có khoản cần chuyển"}
              </p>
            </div>
          </div>

          {/* Card 2: Awaiting */}
          <div className="rounded-2xl bg-surface-container-lowest p-5 sm:p-6 shadow-sm border border-border/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-warning font-bold text-xs uppercase tracking-wider">
                  <span className="material-symbols-outlined text-lg">hourglass_top</span>
                  <span>Đang chờ duyệt</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm font-bold">
                  {balance.awaiting_orders} đơn
                </span>
              </div>
              <div className="mt-3 text-2xl sm:text-3xl font-extrabold text-on-surface tnum tracking-tight">
                {vnd(balance.awaiting)}
              </div>
              <p className="text-on-surface-variant text-xs mt-1.5">
                Đang giao hàng & chờ hết hạn đổi trả
              </p>
            </div>
          </div>

          {/* Card 3: Paid */}
          <div className="rounded-2xl bg-surface-container-lowest p-5 sm:p-6 shadow-sm border border-border/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-wider">
                  <span className="material-symbols-outlined text-lg">savings</span>
                  <span>Đã thanh toán</span>
                </div>
              </div>
              <div className="mt-3 text-2xl sm:text-3xl font-extrabold text-on-surface tnum tracking-tight">
                {vnd(balance.paid)}
              </div>
              <p className="text-on-surface-variant text-xs mt-1.5">
                Chuyển khoản tự động qua STK ngân hàng
              </p>
            </div>
          </div>
        </div>

        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
          {t("me_estimate_note")}
        </p>

        {/* -- quick link generator for logged-in user ---------------- */}
        <div className="mt-8 mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Icon.link className="size-4 text-primary" />
              <span>Lấy link mua sắm hoàn tiền mới</span>
            </h2>
          </div>
          <LinkGenerator />
        </div>

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

        {/* -- bank summary card (only when bank is configured) --------- */}
        {data.has_bank && (
          <div className="mt-10 rounded-xl border bg-card p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <IconChip icon={Icon.bank} tone="success" size="sm" />
                <div className="min-w-0">
                  <div className="text-muted-foreground text-xs font-medium">
                    {t("profile_bank_section")}
                  </div>
                  <div className="mt-0.5 truncate text-sm font-semibold">
                    {data.bank_name} &middot; <span className="tnum font-normal tracking-wider">···{data.bank_account_tail}</span>{" "}
                    {data.account_holder && <span className="text-muted-foreground font-normal text-xs uppercase">({data.account_holder})</span>}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-xs font-medium"
                onClick={() => setBankModalOpen(true)}
              >
                <Icon.edit className="mr-1.5 size-3.5" />
                {t("bank_action_edit")}
              </Button>
            </div>
          </div>
        )}

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
