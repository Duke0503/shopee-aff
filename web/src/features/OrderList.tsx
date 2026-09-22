import { Card } from "@/components/ui/card"
import { Icon } from "@/lib/icons"
import { OrderProgress } from "@/features/OrderProgress"
import { MyOrdersTable } from "@/features/MyOrders"
import { shortDate, vnd } from "@/lib/format"
import { useT } from "@/lib/labels"
import type { MyOrder } from "@/lib/api"

/**
 * The same orders, drawn for the screen they are being read on.
 *
 * A six-column table on a 390px phone means scrolling sideways to reach
 * the amount, and nobody scrolls sideways -- they close the tab. Most
 * of these readers are on a phone, so the phone gets cards and the
 * desktop keeps the table, rather than one layout compromising for
 * both.
 */
export function OrderList({ orders }: { orders: MyOrder[] }) {
  return (
    <>
      <div className="space-y-3 sm:hidden">
        {orders.map((order) => (
          <OrderCard key={order.order_id} order={order} />
        ))}
      </div>
      <div className="hidden sm:block">
        <MyOrdersTable orders={orders} />
      </div>
    </>
  )
}

function OrderCard({ order }: { order: MyOrder }) {
  const t = useT()
  const link = order.affiliate_url ?? order.source_url
  const when = order.paid_at ?? order.approved_at ?? order.recorded_at
  const isTikTok = order.platform === "tiktok"

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                isTikTok
                  ? "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                  : "bg-orange-500/10 text-orange-600 border border-orange-500/20"
              }`}
            >
              {isTikTok ? "TikTok" : "Shopee"}
            </span>
          </div>
          <div className="line-clamp-2 text-sm leading-snug font-medium">
            {order.product || order.order_id}
          </div>
          <div className="text-muted-foreground mt-1 font-mono text-[11px]">
            {order.order_id}
          </div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground text-[11px]">
            {t("me_order_cashback_label")}
          </div>
          {/* The figure is why they opened the page, so it is the
              largest thing on the card. */}
          <div className="tnum text-xl leading-tight font-bold">
            {vnd(order.cashback)}
          </div>
          {order.is_estimate && (
            <div className="text-muted-foreground text-[11px]">
              {t("estimate_note")}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 border-t pt-3">
        <OrderProgress status={order.status} />
      </div>

      {order.rejection_reason && (
        <p className="bg-destructive-soft text-destructive mt-3 rounded-md p-2 text-xs">
          {order.rejection_reason}
        </p>
      )}

      <div className="text-muted-foreground mt-3 flex items-center justify-between gap-3 text-[11px]">
        <span className="tnum">
          {t("col_value")} {vnd(order.order_value)} &middot; {shortDate(when)}
        </span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 font-medium"
          >
            {t("btn_open_link")}
            <Icon.open className="size-3" />
          </a>
        )}
      </div>
    </Card>
  )
}
