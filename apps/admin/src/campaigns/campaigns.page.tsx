/**
 * Campaign (wireframe Campaign desktop, FR-23, D22, Story 4.20; admin only): each campaign as a
 * card with its state, the window in Vietnam time (its end read "before", being exclusive), the
 * bonus, the minimum order, the shops and the per-customer rule; a bar of its slots (confirmed,
 * held, paid, free) with the counts under it; what it cost and earned, the Overview's own event
 * figures; and its latest awards. The create form sits at the right from 1280 px and under the
 * list below that; the header button takes the admin to it. A campaign cannot be stopped early
 * yet (no command), which the page says once.
 */
import type { CampaignState, DeskCampaign } from "@cashback/contracts";
import { formatVnDateTimeOf, systemClock } from "@cashback/core";
import { Button, cn, CodeChip, formatCount, formatMoney, formatSignedMoney, PlusIcon, Skeleton, StatusBadge, useLayout } from "@cashback/ui";
import { useRef } from "react";

import { adminText, type AdminKey } from "../labels";
import { PageHeader } from "../shell/page-header";
import { CampaignForm } from "./campaign-form";
import { useCampaigns } from "./campaigns.queries";

const STATE_TONE: Record<CampaignState, string> = {
  RUNNING: "bg-status-approved-soft text-status-approved",
  UPCOMING: "bg-status-waiting-soft text-status-waiting",
  FULL: "bg-status-attention-soft text-status-attention",
  ENDED: "bg-status-done-soft text-status-done",
  CLOSED: "bg-status-neutral-soft text-status-neutral",
};

const PLATFORM: Record<string, AdminKey> = { shopee: "campaign_platform_shopee", shopeefood: "campaign_platform_shopeefood", tiktok: "campaign_platform_tiktok", lazada: "campaign_platform_lazada" };

function StatePill({ state }: { readonly state: CampaignState }) {
  return <span data-campaign-state={state} className={cn("inline-flex min-h-6 shrink-0 items-center rounded-xl px-2.5 py-0.5 text-meta font-medium", STATE_TONE[state])}>{adminText(`campaign_state_${state}` as AdminKey)}</span>;
}

function terms(c: DeskCampaign): string {
  const from = formatVnDateTimeOf(c.startsAt, systemClock);
  const to = formatVnDateTimeOf(c.endsAt, systemClock);
  const window = from === null || to === null ? adminText("campaign_no_window") : adminText("campaign_window", { from, to });
  return [
    window,
    adminText("campaign_bonus_line", { amount: formatMoney(c.bonus) ?? "" }),
    ...(c.minOrderValue > 0 ? [adminText("campaign_min_line", { amount: formatMoney(c.minOrderValue) ?? "" })] : []),
    c.platforms.map((p) => (PLATFORM[p] === undefined ? p : adminText(PLATFORM[p]))).join(", "),
    c.perCustomer > 0 ? adminText("campaign_per_customer", { count: c.perCustomer }) : adminText("campaign_per_customer_any"),
  ].join(" \u00b7 ");
}

function SlotBar({ c }: { readonly c: DeskCampaign }) {
  const free = Math.max(c.slots - c.slotsUsed, 0);
  const parts = [
    { key: "confirmed", value: c.awards.confirmed, color: "bg-primary", label: adminText("campaign_legend_confirmed", { count: c.awards.confirmed }) },
    { key: "held", value: c.awards.held, color: "bg-warning", label: adminText("campaign_legend_held", { count: c.awards.held }) },
    { key: "paid", value: c.awards.paid, color: "bg-status-done", label: adminText("campaign_legend_paid", { count: c.awards.paid }) },
    { key: "free", value: free, color: "bg-muted", label: adminText("campaign_legend_free", { count: free }) },
  ];
  const whole = Math.max(c.slots, c.slotsUsed);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div role="img" aria-label={adminText("campaign_slots_aria", { used: c.slotsUsed, total: c.slots })} className="flex h-2 w-full min-w-0 overflow-hidden rounded-full bg-muted">
        {parts.filter((p) => p.value > 0 && p.key !== "free").map((p) => (
          <span key={p.key} className={p.color} style={{ width: `${(p.value / whole) * 100}%` }} />
        ))}
      </div>
      <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground">
        {parts.map((p) => (
          <li key={p.key} data-legend={p.key}>{p.label}</li>
        ))}
        {c.awards.void > 0 && <li data-legend="void">{adminText("campaign_legend_void", { count: c.awards.void })}</li>}
      </ul>
    </div>
  );
}

function Results({ c }: { readonly c: DeskCampaign }) {
  if (c.result === null) return null;
  const figures = [
    { key: "campaign_cost" as const, value: formatMoney(c.result.cost) ?? "", tone: "" },
    { key: "campaign_commission" as const, value: formatMoney(c.result.commission) ?? "", tone: "" },
    { key: "campaign_result" as const, value: formatSignedMoney(c.result.result), tone: c.result.result < 0 ? "text-destructive" : "text-money" },
  ];
  return (
    <dl data-campaign-result className="grid min-w-0 grid-cols-1 gap-2 rounded-lg bg-muted/60 p-3 sm:grid-cols-3">
      {figures.map((f) => (
        <div key={f.key} className="flex min-w-0 items-baseline justify-between gap-2 sm:flex-col sm:items-start sm:gap-0.5">
          <dt className="text-meta text-muted-foreground">{adminText(f.key)}</dt>
          <dd className={cn("text-[15px] font-semibold tabular-nums", f.tone)}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const TH = "h-10 px-4 text-left text-meta font-semibold text-muted-foreground";

function AwardTable({ c }: { readonly c: DeskCampaign }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{adminText("campaign_awards")}</caption>
        <thead className="bg-muted/60">
          <tr>
            <th scope="col" className={`${TH} w-[21%]`}>{adminText("col_award_order")}</th>
            <th scope="col" className={`${TH} w-[20%]`}>{adminText("col_award_customer_code")}</th>
            <th scope="col" className={TH}>{adminText("col_award_customer")}</th>
            <th scope="col" className={`${TH} w-[16%]`}>{adminText("col_award_at")}</th>
            <th scope="col" className={`${TH} w-[22%]`}>{adminText("col_award_status")}</th>
          </tr>
        </thead>
        <tbody>
          {c.latest.map((a) => (
            <tr key={a.awardId} data-award={a.status} className="h-[52px] border-t border-border">
              <td className="px-4 py-2"><CodeChip code={a.orderId} /></td>
              <td className="px-4 py-2">{a.customerCode === null ? null : <CodeChip code={a.customerCode} />}</td>
              <td className="truncate px-4 py-2">{a.customerName ?? ""}</td>
              <td className="px-4 py-2 whitespace-nowrap tabular-nums">{formatVnDateTimeOf(a.createdAt, systemClock) ?? ""}</td>
              <td className="px-4 py-2"><StatusBadge entity="campaignAward" value={a.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AwardCards({ c }: { readonly c: DeskCampaign }) {
  return (
    <ul aria-label={adminText("campaign_awards")} className="flex min-w-0 flex-col divide-y divide-border rounded-xl border border-border">
      {c.latest.map((a) => (
        <li key={a.awardId} data-award={a.status} className="flex min-w-0 flex-col gap-1.5 p-3">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <span className="min-w-0 text-[15px] font-semibold break-words">{a.customerName ?? a.customerCode ?? ""}</span>
            <StatusBadge entity="campaignAward" value={a.status} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-meta text-muted-foreground">
            <CodeChip code={a.orderId} />
            {a.customerCode !== null && <CodeChip code={a.customerCode} />}
            <span className="tabular-nums">{formatVnDateTimeOf(a.createdAt, systemClock) ?? ""}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CampaignCard({ c }: { readonly c: DeskCampaign }) {
  const phone = useLayout() === "phone";
  return (
    <article data-campaign={c.campaignId} aria-labelledby={`campaign-${c.campaignId}`} className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4 md:p-5">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <h2 id={`campaign-${c.campaignId}`} className="min-w-0 text-lg leading-snug font-bold break-words">{c.name}</h2>
        <StatePill state={c.state} />
      </header>
      <p className="-mt-2 text-sm break-words text-muted-foreground">{terms(c)}</p>
      <SlotBar c={c} />
      <Results c={c} />
      {c.latest.length === 0 ? <p className="text-sm text-muted-foreground">{adminText("campaign_no_awards")}</p> : phone ? <AwardCards c={c} /> : <AwardTable c={c} />}
    </article>
  );
}

function List() {
  const query = useCampaigns();
  if (query.data === undefined) {
    if (query.isError) {
      return (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-5 text-sm text-status-rejected">
          {adminText("campaigns_failed")}
          <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => void query.refetch()}>{adminText("campaigns_retry")}</Button>
        </div>
      );
    }
    return (
      <div role="status" aria-label={adminText("campaigns_loading")} className="flex flex-col gap-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.data.campaigns.length === 0) return <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-[15px] text-muted-foreground">{adminText("campaigns_empty")}</p>;
  return (
    <div data-campaigns={formatCount(query.data.campaigns.length)} className="flex min-w-0 flex-col gap-4">
      {query.data.campaigns.map((c) => <CampaignCard key={c.campaignId} c={c} />)}
      <p className="text-meta text-muted-foreground">{adminText("campaign_stop_missing")}</p>
    </div>
  );
}

export function CampaignsPage() {
  const first = useRef<HTMLInputElement>(null);
  const toForm = (): void => {
    first.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    first.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <PageHeader
        title={adminText("nav_campaigns")}
        lead={adminText("campaigns_lead")}
        action={
          <Button type="button" size="lg" className="h-11 rounded-lg px-4 text-[15px] font-semibold md:h-10" onClick={toForm}>
            <PlusIcon aria-hidden />
            {adminText("campaigns_new")}
          </Button>
        }
      />
      <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <List />
        <CampaignForm ref={first} className="xl:sticky xl:top-6" />
      </div>
    </>
  );
}
