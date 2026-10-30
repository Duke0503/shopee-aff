/**
 * One network payout's orders (W4 network payouts detail, Story 4.21 AC4): a right sheet on
 * desktop and tablet, full height on phone. It shows the server's figures only: the batch's gross,
 * fee, tax and what was received, whether it withheld the tax, the gross of the customers' orders
 * and the unattributed rest (guest or unknown orders), what the match did and why, the open review
 * cases, and each order with its product thumbnail, customer, outcome, gross and what the network
 * pays for it. Nothing here settles or changes an order.
 */
import type { NetworkSettlementDetail, NetworkSettlementOrder, NetworkSettlementRow } from "@cashback/contracts";
import { formatVnDateOf, systemClock } from "@cashback/core";
import { CodeChip, formatMoney, MoneyFigure, ProductThumb, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, StatusBadge, useLayout } from "@cashback/ui";
import type { ReactNode } from "react";

import { adminText, type AdminKey } from "../labels";
import { MatchBadge, OutcomeBadge, Unattributed, WithheldBadge } from "./network-badges";
import { useNetworkSettlement } from "./network-settlements.queries";

const NETWORK: Record<string, AdminKey> = { shopee: "network_shopee", accesstrade: "network_accesstrade" };

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/60 p-2.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function why(detail: NetworkSettlementDetail): string {
  if (detail.match === "PENDING") return adminText("network_detail_pending");
  if (detail.match === "HISTORIC") return adminText("network_detail_historic");
  if (detail.withheld === null) return adminText("network_detail_unknown_withholding");
  if (detail.match === "MISMATCH") return adminText("network_detail_mismatch", { over: formatMoney(-(detail.unattributed ?? 0)) ?? "" });
  return adminText(detail.listed ? "network_detail_listed" : "network_detail_by_window");
}

function OrderLine({ order }: { readonly order: NetworkSettlementOrder }) {
  return (
    <li data-settlement-order={order.outcome} className="flex min-w-0 items-start gap-2.5 py-2.5">
      <ProductThumb src={order.productImageUrl} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-sm leading-snug break-words">{order.productName ?? adminText("panel_product_missing", { order: order.orderId })}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <CodeChip code={order.orderId} />
          {order.customerCode !== null && <CodeChip code={order.customerCode} />}
        </span>
        {order.customerName !== null && <span className="min-w-0 truncate text-meta text-muted-foreground">{order.customerName}</span>}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <OutcomeBadge outcome={order.outcome} />
          {order.status !== null && <StatusBadge entity="order" value={order.status} />}
          {order.outcome === "CONFLICT" && order.settledBy !== null && <span className="text-caption text-muted-foreground">{adminText("panel_settled_by", { payout: order.settledBy })}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end text-right">
        <span className="sr-only">{adminText("network_detail_paid_for")} </span>
        <MoneyFigure amount={order.net} />
        {order.gross !== null && <span className="text-caption text-muted-foreground tabular-nums">{adminText("network_detail_gross", { amount: formatMoney(order.gross) ?? "" })}</span>}
      </span>
    </li>
  );
}

function Figures({ detail }: { readonly detail: NetworkSettlementDetail }) {
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-2 min-[400px]:grid-cols-3">
      <Fact label={adminText("network_detail_eligible")}>
        <MoneyFigure amount={detail.eligibleAmount} size="md" />
      </Fact>
      <Fact label={adminText("network_detail_fee")}>
        <MoneyFigure amount={detail.fee} size="md" />
      </Fact>
      <Fact label={adminText("network_detail_tax")}>
        <MoneyFigure amount={detail.tax} size="md" />
      </Fact>
      <Fact label={adminText("network_detail_received")}>
        <MoneyFigure amount={detail.amount} size="md" />
      </Fact>
      <Fact label={adminText("network_detail_matched_gross")}>
        <MoneyFigure amount={detail.matchedGross} size="md" />
      </Fact>
      <Fact label={adminText("network_detail_unattributed")}>
        <Unattributed amount={detail.unattributed} className="text-lg" />
      </Fact>
    </dl>
  );
}

function Body({ detail }: { readonly detail: NetworkSettlementDetail }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge entity="networkSettlement" value={detail.status} />
        <MatchBadge match={detail.match} />
        <WithheldBadge withheld={detail.withheld} />
      </div>
      <Figures detail={detail} />
      <p className="text-meta break-words text-muted-foreground">{adminText("network_detail_unattributed_hint")}</p>
      <p className="text-sm break-words">{why(detail)}</p>
      {detail.openCaseIds.length > 0 && <p className="rounded-md bg-status-attention-soft p-3 text-sm break-words text-status-attention">{adminText("network_detail_cases", { count: detail.openCaseIds.length })}</p>}
      <section className="min-w-0">
        <h3 className="text-sm font-semibold">{adminText("network_detail_orders", { count: detail.orders.length })}</h3>
        {detail.orders.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{adminText("network_detail_empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {detail.orders.map((o) => (
              <OrderLine key={o.orderId} order={o} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function NetworkSettlementSheet({ row, onClose }: { readonly row: NetworkSettlementRow | null; readonly onClose: () => void }) {
  const phone = useLayout() === "phone";
  const detail = useNetworkSettlement(row?.settlementId ?? null);
  const created = row === null ? null : formatVnDateOf(row.createdAt, systemClock);
  const lead = row === null ? "" : adminText("network_detail_lead", { network: adminText(NETWORK[row.network] ?? "network_unknown"), date: created ?? "–" });
  return (
    <Sheet open={row !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side={phone ? "bottom" : "right"}
        className={phone ? "h-dvh max-h-dvh gap-0 overflow-y-auto rounded-none data-[side=bottom]:h-dvh" : "gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:max-w-[520px] data-[side=right]:sm:max-w-[520px]"}
      >
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-lg font-semibold break-words">{adminText("network_detail_title", { id: row?.networkPayoutId ?? "" })}</SheetTitle>
          <SheetDescription>{lead}</SheetDescription>
        </SheetHeader>
        <div data-panel={phone ? "drawer" : "sheet"} className="min-w-0 p-4">
          {detail.data !== undefined ? (
            <Body detail={detail.data} />
          ) : detail.isError ? (
            <p role="alert" className="text-sm text-status-rejected">
              {adminText("network_detail_failed")}
            </p>
          ) : (
            <div aria-label={adminText("network_detail_loading")} className="flex flex-col gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
