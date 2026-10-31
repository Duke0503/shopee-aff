/**
 * The Overview, the desk's landing screen (W6, FR-25, FR-27, Story 4.17,
 * docs/operations/dashboard-spec.md). It answers, in this order: what needs me now, how much did
 * we make (by approval day), where is the money, how is it trending, how are orders doing (by
 * recorded day), was the event worth it, who are the customers, is the system healthy. Every
 * figure is the server's; this page formats and lays out. While another period loads, the figures
 * on screen keep their own period in the header and are dimmed (Story 4.17 AC4).
 */
import type { Overview } from "@cashback/contracts";
import { formatVnTime, parseInstant, vnDateOf } from "@cashback/core";
import { cn, Skeleton } from "@cashback/ui";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { PageHeader } from "../shell/page-header";
import { BusinessBlock } from "./business-block";
import { CustomersBlock, HealthLine } from "./customers-block";
import { MoneyBlock } from "./money-block";
import { EventsBlock, OrdersBlock } from "./orders-block";
import { dayText } from "./overview-parts";
import { useOverview, type OverviewSearch } from "./overview.queries";
import { PeriodPicker } from "./period-picker";
import { TodoBlock } from "./todo-block";
import { TrendBlock } from "./trend-block";

const rangeText = (from: string, to: string): string => (from === to ? dayText(from) : adminText("ov_range", { from: dayText(from), to: dayText(to) }));

function Lead({ data }: { readonly data: Overview }) {
  const p = data.period;
  return (
    <span data-period={`${p.from}..${p.to}`}>
      {adminText("ov_lead", { period: rangeText(p.from, p.to), previous: rangeText(p.previousFrom, p.previousTo), time: formatVnTime(parseInstant(data.asOf)) })}
    </span>
  );
}

function Loading() {
  return (
    <div role="status" aria-label={adminText("ov_loading")} className="grid gap-3 md:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-28 w-full rounded-xl" />
      ))}
      <Skeleton className="h-64 w-full rounded-xl md:col-span-4" />
    </div>
  );
}

function Figures({ data }: { readonly data: Overview }) {
  return (
    <>
      <TodoBlock todo={data.todo} today={vnDateOf(parseInstant(data.asOf))} />
      <BusinessBlock b={data.business} />
      <MoneyBlock money={data.money} />
      <TrendBlock trend={data.trend} />
      <OrdersBlock orders={data.orders} />
      <EventsBlock events={data.events} />
      <CustomersBlock customers={data.customers} />
      <HealthLine health={data.health} />
    </>
  );
}

export function OverviewPage({ search, onChange }: { readonly search: OverviewSearch; readonly onChange: (next: OverviewSearch) => void }) {
  const query = useOverview(search);
  const data = query.data;
  const stale = query.isPlaceholderData;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <PageHeader title={adminText("nav_overview")} lead={data === undefined ? undefined : <Lead data={data} />} />
        <PeriodPicker search={search} onChange={onChange} />
      </div>
      {query.isError && (
        <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
          {query.error instanceof ApiError ? errorText(query.error.messageKey, query.error.code) : adminText("ov_failed")}
        </p>
      )}
      {data === undefined ? (
        !query.isError && <Loading />
      ) : (
        <div data-overview aria-busy={stale} className={cn("flex min-w-0 flex-col gap-8 transition-opacity", stale && "opacity-50")}>
          <Figures data={data} />
        </div>
      )}
    </div>
  );
}
