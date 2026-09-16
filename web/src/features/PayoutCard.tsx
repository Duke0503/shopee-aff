import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Icon } from "@/lib/icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { OrdersTable } from "@/features/OrdersTable"
import { askForBank, markPaid, type Payable } from "@/lib/api"
import { vnd } from "@/lib/format"
import { useT } from "@/lib/labels"

/**
 * One customer, one transfer.
 *
 * The QR carries bank, account, amount and reference already filled in,
 * so nobody transcribes an account number at eleven at night. What it
 * cannot do is move money -- no Vietnamese bank offers an API to a
 * personal account -- so the operator scans it, confirms in their
 * banking app, and comes back to press the button.
 *
 * That button is the only thing that tells the ledger the money went.
 * Pressing it is what makes the bot tell the customer, so it asks first:
 * a press made before the transfer actually happened is a message to a
 * real person saying money is on its way when it is not.
 */
export function PayoutCard({ entry }: { entry: Payable }) {
  const t = useT()
  const queryClient = useQueryClient()
  const [showOrders, setShowOrders] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["payouts"] })

  const pay = useMutation({
    mutationFn: () => markPaid(entry.customer_id, entry.order_ids),
    onSuccess: invalidate,
  })

  const ask = useMutation({
    mutationFn: () => askForBank(entry.customer_id),
  })

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(entry.reference)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard is blocked in some contexts; the text is on screen
      // anyway, so there is nothing to recover from.
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">
              {entry.display_name || entry.customer_id}
            </div>
            <div className="text-muted-foreground font-mono text-xs">
              {entry.customer_id}
            </div>
          </div>
          <Badge variant="secondary">
            {t("label_orders", { count: entry.order_ids.length })}
          </Badge>
        </div>
        <div className="tnum text-3xl font-bold">{vnd(entry.amount)}</div>
      </CardHeader>

      <CardContent className="space-y-3">
        {entry.has_bank && (
          <div className="text-muted-foreground space-y-0.5 text-xs">
            <div className="text-foreground font-medium">
              {entry.bank_name} · <span className="tnum">{entry.bank_account}</span>
            </div>
            <div>{entry.account_holder}</div>
          </div>
        )}

        {entry.qr_url && (
          <img
            src={entry.qr_url}
            alt=""
            width={220}
            height={280}
            className="mx-auto w-full max-w-[220px] rounded-md border"
          />
        )}

        {entry.has_bank && !entry.qr_url && (
          <p className="bg-warning-soft text-warning flex gap-2 rounded-md p-2.5 text-xs">
            <Icon.warning className="mt-0.5 size-3.5 shrink-0" />
            <span>{t("no_qr_warning", { bank: entry.bank_name })}</span>
          </p>
        )}

        {entry.has_bank && (
          <div className="bg-secondary flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="text-muted-foreground text-[11px]">
                {t("label_reference")}
              </div>
              <code className="block truncate text-xs">{entry.reference}</code>
            </div>
            <Button size="sm" variant="ghost" onClick={copyReference}>
              {copied ? <Icon.confirm className="size-3.5" /> : <Icon.copy className="size-3.5" />}
              {copied ? t("btn_copied") : t("btn_copy")}
            </Button>
          </div>
        )}

        {/* The confirm step exists because the button's real effect is a
            message to a customer, not a row in a table. */}
        {entry.has_bank ? (
          confirming ? (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">
                {t("confirm_paid_title", {
                  amount: vnd(entry.amount),
                  name: entry.display_name || entry.customer_id,
                })}
              </div>
              <p className="text-muted-foreground text-xs">
                {t("confirm_paid_body")}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="success"
                  disabled={pay.isPending}
                  onClick={() => pay.mutate()}
                >
                  {pay.isPending ? t("btn_paying") : t("confirm_paid_yes")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                >
                  {t("confirm_paid_no")}
                </Button>
              </div>
            </div>
          ) : (
            <Button className="w-full" onClick={() => setConfirming(true)}>
              <Icon.confirm /> {t("btn_paid")}
            </Button>
          )
        ) : (
          <Button
            className="w-full"
            variant="outline"
            disabled={ask.isPending || ask.data?.ok}
            onClick={() => ask.mutate()}
          >
            <Icon.send />
            {ask.data?.ok
              ? t("btn_asked")
              : ask.isPending
                ? t("btn_asking")
                : t("btn_ask_bank")}
          </Button>
        )}

        {(pay.data && !pay.data.ok) || (ask.data && !ask.data.ok) ? (
          <p className="text-destructive text-xs">
            {pay.data?.ok === false ? pay.data.message : ask.data?.message}
          </p>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setShowOrders((open) => !open)}
        >
          <Icon.expand
            className={showOrders ? "rotate-180 transition-transform" : "transition-transform"}
          />
          {showOrders
            ? t("btn_orders_hide")
            : t("btn_orders_show", { count: entry.orders.length })}
        </Button>
        {showOrders && <OrdersTable orders={entry.orders} />}
      </CardContent>
    </Card>
  )
}
