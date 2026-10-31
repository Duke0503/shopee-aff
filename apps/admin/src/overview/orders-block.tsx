/**
 * Block 5, orders per network by recorded day (dashboard-spec Block 5), and Block 6, the events of
 * the period with their own profit or loss (Block 6). Each is one table: one value per cell, the
 * metric's definition under its name, ratios muted with the "not enough data" tag below 100 approved
 * orders (FR-27). The tables scroll sideways inside their own box on a narrow screen.
 */
import type { Overview, OverviewNetworkOrders, Ratio } from "@cashback/contracts";
import { parseInstant, systemClock, formatVnDateTime } from "@cashback/core";
import { cn, formatCount, formatMoney, MissingValue, MoneyFigure } from "@cashback/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { adminText, type AdminKey } from "../labels";
import { Block, Card, CountValue, NotEnoughTag, RatioValue, SignedMoney } from "./overview-parts";

const NETWORK_LABEL: Record<OverviewNetworkOrders["network"], AdminKey> = { shopee: "network_shopee", accesstrade: "network_accesstrade", all: "ov_all" };

interface Metric {
  readonly label: AdminKey;
  readonly def: AdminKey;
  readonly cell: (n: OverviewNetworkOrders) => ReactNode;
  /** The ratio a row shows, for the one "not enough data" mark beside its name. */
  readonly ratio?: (n: OverviewNetworkOrders) => Ratio;
}

const METRICS: readonly Metric[] = [
  { label: "ov_links", def: "ov_links_def", cell: (n) => <CountValue value={n.linksDelivered} /> },
  { label: "ov_recorded", def: "ov_recorded_def", cell: (n) => <CountValue value={n.recorded} /> },
  { label: "ov_orders_per_link", def: "ov_orders_per_link_def", cell: (n) => <RatioValue ratio={n.ordersPerLink} tag={false} />, ratio: (n) => n.ordersPerLink },
  { label: "ov_approved", def: "ov_status_def", cell: (n) => <CountValue value={n.approved} /> },
  { label: "ov_cancelled", def: "ov_status_def", cell: (n) => <CountValue value={n.cancelled} /> },
  { label: "ov_awaiting_count", def: "ov_status_def", cell: (n) => <CountValue value={n.awaiting} /> },
  { label: "ov_cancel_rate", def: "ov_cancel_rate_def", cell: (n) => <RatioValue ratio={n.cancelRate} previous tag={false} />, ratio: (n) => n.cancelRate },
  { label: "ov_avg_commission", def: "ov_avg_commission_def", cell: (n) => <MoneyFigure amount={n.averageCommission} /> },
  { label: "ov_effective_rate", def: "ov_effective_rate_def", cell: (n) => <RatioValue ratio={n.effectiveRate} tag={false} />, ratio: (n) => n.effectiveRate },
];

export function OrdersBlock({ orders }: { readonly orders: Overview["orders"] }) {
  const thin = orders.networks.some((n) => !n.cancelRate.enoughData);
  return (
    <Block title={adminText("ov_orders_title")} basis={adminText("ov_orders_basis")}>
      <Card>
        <div className="overflow-x-auto">
          <table data-orders className="w-full text-[13px] md:text-sm">
            <thead>
              <tr className="border-b border-border text-left text-meta text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">{adminText("ov_metric")}</th>
                {orders.networks.map((n) => (
                  <th key={n.network} scope="col" className="py-2 pl-2 text-right font-medium md:pl-3">{adminText(NETWORK_LABEL[n.network])}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.label} className="border-b border-border align-top last:border-0">
                  <th scope="row" className="w-[34%] py-2 pr-2 text-left font-normal md:w-auto md:pr-3">
                    <span className="block font-medium">{adminText(m.label)}</span>
                    <span className="block text-caption text-muted-foreground">{adminText(m.def)}</span>
                    {m.ratio !== undefined && orders.networks.some((n) => m.ratio?.(n).enoughData === false) && <NotEnoughTag />}
                  </th>
                  {orders.networks.map((n) => (
                    <td key={n.network} className={cn("py-2 pl-2 text-right tabular-nums md:pl-3", n.network === "all" && "font-semibold")}>{m.cell(n)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 pt-1">
          {thin ? <p className="text-meta text-muted-foreground">{adminText("ov_not_enough_hint")}</p> : <span />}
          {orders.aged > 0 ? (
            <Link to="/orders" search={{ "filter[status]": "AWAITING_APPROVAL", sort: "recordedAt:asc" }} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
              {adminText("ov_aged", { count: formatCount(orders.aged) })}
            </Link>
          ) : (
            <p className="text-meta text-muted-foreground">{adminText("ov_aged_none")}</p>
          )}
        </div>
      </Card>
    </Block>
  );
}

const when = (at: string): string => formatVnDateTime(parseInstant(at), systemClock);

/** On a phone each event is a short card of label and value pairs instead of a wide table. */
function EventCards({ events }: { readonly events: Overview["events"] }) {
  const pair = (label: AdminKey, value: ReactNode) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-meta text-muted-foreground">{adminText(label)}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
  return (
    <ul data-event-cards className="flex flex-col divide-y divide-border md:hidden">
      {events.map((e) => (
        <li key={e.campaignId} className="flex flex-col gap-1.5 py-2">
          <p className="font-medium break-words">{e.name}</p>
          <p className="text-caption text-muted-foreground">{adminText("ov_ev_window", { from: when(e.startsAt), to: when(e.endsAt) })}</p>
          <dl className="flex flex-col gap-1 text-sm">
            {pair("ov_ev_slots", adminText("ov_ev_slots_value", { used: formatCount(e.slotsUsed), total: formatCount(e.slots) }))}
            {pair("ov_ev_bonus", formatMoney(e.bonus))}
            {pair("ov_ev_commission", <MoneyFigure amount={e.commission} />)}
            {pair("ov_ev_share", <SignedMoney amount={e.operatorShare} size="sm" />)}
            {pair("ov_ev_result", <SignedMoney amount={e.result} size="sm" />)}
          </dl>
        </li>
      ))}
    </ul>
  );
}

export function EventsBlock({ events }: { readonly events: Overview["events"] }) {
  return (
    <Block title={adminText("ov_events_title")} basis={adminText("ov_events_basis")}>
      <Card>
        {events.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{adminText("ov_events_empty")}</p>
        ) : (
          <>
          <EventCards events={events} />
          <div className="hidden overflow-x-auto md:block">
            <table data-events className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-meta text-muted-foreground">
                  {(["ov_ev_name", "ov_ev_slots", "ov_ev_bonus", "ov_ev_commission", "ov_ev_share", "ov_ev_result"] as const).map((k, i) => (
                    <th key={k} scope="col" className={cn("py-2 font-medium", i === 0 ? "pr-3" : "pl-3 text-right")}>{adminText(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.campaignId} className="border-b border-border align-top last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="block font-medium break-words">{e.name}</span>
                      <span className="block text-caption text-muted-foreground">{adminText("ov_ev_window", { from: when(e.startsAt), to: when(e.endsAt) })}</span>
                    </th>
                    <td className="py-2 pl-3 text-right tabular-nums">{adminText("ov_ev_slots_value", { used: formatCount(e.slotsUsed), total: formatCount(e.slots) })}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">{formatMoney(e.bonus) ?? <MissingValue />}</td>
                    <td className="py-2 pl-3 text-right"><MoneyFigure amount={e.commission} /></td>
                    <td className="py-2 pl-3 text-right"><SignedMoney amount={e.operatorShare} size="sm" /></td>
                    <td className="py-2 pl-3 text-right"><SignedMoney amount={e.result} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        <p className="text-meta text-muted-foreground">{adminText("ov_events_note")}</p>
      </Card>
    </Block>
  );
}
