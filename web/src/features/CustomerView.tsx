import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Icon } from "@/lib/icons"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ChangePassword } from "@/features/ChangePassword"
import { MyOrdersTable } from "@/features/MyOrders"
import { fetchMe, logout } from "@/lib/api"
import { vnd } from "@/lib/format"
import { useT } from "@/lib/labels"
import { navigate } from "@/routes"
import { Footer, Header } from "@/components/Chrome"

/**
 * What one customer sees of their own ledger.
 *
 * Deliberately narrow: their orders, their three balances, the last four
 * digits of the account money goes to. No bank account in full, nothing
 * about anyone else. The server enforces that too -- this view has no
 * endpoint that could return another person's row -- but the shape of
 * the page should make the intent obvious to whoever changes it next.
 */
export function CustomerView() {
  const t = useT()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  })

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.setQueryData(["me"], null),
  })

  if (isLoading) {
    return (
      <p className="text-muted-foreground p-8 text-center text-sm">
        {t("loading")}
      </p>
    )
  }

  if (!data) {
    return (
      <>
        <Header current="orders" />
        <main className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
          <span className="bg-secondary text-muted-foreground mx-auto grid size-12 place-items-center rounded-xl">
            <Icon.signIn className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-bold">{t("orders_signed_out_title")}</h1>
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
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold sm:text-xl">
            {t("me_hello", { name: data.display_name || data.customer_id })}
          </h1>
          <p className="text-muted-foreground font-mono text-xs">
            {data.customer_id}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          <Icon.signOut /> {t("logout")}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Money
          icon={<Icon.owed className="size-3.5" />}
          label={t("me_balance_approved")}
          value={vnd(balance.approved)}
          note={t("summary_orders", { count: balance.approved_orders })}
        />
        <Money
          icon={<Icon.pending className="size-3.5" />}
          label={t("me_balance_awaiting")}
          value={vnd(balance.awaiting)}
          note={t("summary_orders", { count: balance.awaiting_orders })}
        />
        <Money
          icon={<Icon.paid className="size-3.5" />}
          label={t("me_balance_paid")}
          value={vnd(balance.paid)}
        />
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {t("me_estimate_note")}
      </p>

      <Card className="mt-4 p-3.5">
        <div className="text-muted-foreground text-xs">{t("me_bank")}</div>
        {data.bank_account_tail ? (
          <div className="mt-0.5 text-sm font-medium">
            {data.bank_name} · <span className="tnum">{data.bank_account_tail}</span>
          </div>
        ) : (
          <p className="text-warning mt-0.5 text-xs">
            {t("me_bank_none")}
          </p>
        )}
      </Card>

      <h2 className="mt-8 mb-3 text-sm font-semibold">{t("me_orders_title")}</h2>
      {data.orders.length ? (
        <MyOrdersTable orders={data.orders} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("me_no_orders")}</p>
      )}

      <div className="mt-8 max-w-md">
        <ChangePassword />
      </div>
      </div>
      <Footer />
    </>
  )
}

function Money({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode
  label: string
  value: string
  note?: string
}) {
  return (
    <Card className="p-3.5">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </div>
      <div className="tnum mt-1 text-2xl font-bold">{value}</div>
      {note && <div className="text-muted-foreground text-[11px]">{note}</div>}
    </Card>
  )
}
