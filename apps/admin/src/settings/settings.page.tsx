/**
 * Settings (W6, FR-13, D54, D59, UX-DR7, Story 4.18): the withheld setting of each settlement
 * period, with where it comes from: the network's latest payout batch (read from what it paid),
 * the owner's override, or the default.
 * A Shopee period is a switch (`settings_withheld_switch`), on by default; an AccessTrade period
 * reads `settings_always_withheld` and has no switch. Changing a switch asks once, in one dialog that shows
 * the server's count of orders the change reaches and states that approved orders keep their
 * amount. While it saves the switch shows the new setting; a refused save puts it back to the
 * stored one and says why in the label file's words. Any staff role may change it; the server
 * records who did.
 */
import type { SettlementPeriod } from "@cashback/contracts";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, cn, Skeleton } from "@cashback/ui";
import { useState } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText, type AdminKey } from "../labels";
import { PageHeader } from "../shell/page-header";
import { periodText } from "../payouts/network-badges";
import { useMarkPeriod, usePeriodImpact, useSettlementPeriods } from "./settlement-periods.queries";

const NETWORK: Record<string, AdminKey> = { shopee: "network_shopee", accesstrade: "network_accesstrade" };
const keyOf = (p: Pick<SettlementPeriod, "network" | "periodMonth">): string => `${p.network}:${p.periodMonth}`;

function Switch({ checked, label, disabled, onToggle }: { readonly checked: boolean; readonly label: string; readonly disabled: boolean; readonly onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 coarse:h-8 coarse:w-14", checked ? "bg-primary" : "bg-input")}
    >
      <span aria-hidden className={cn("inline-block size-6 rounded-full bg-background shadow transition-transform coarse:size-7", checked ? "translate-x-5 coarse:translate-x-6" : "translate-x-0")} />
    </button>
  );
}

function ConfirmChange({ period, onClose, onConfirm }: { readonly period: SettlementPeriod | null; readonly onClose: () => void; readonly onConfirm: (p: SettlementPeriod) => void }) {
  const impact = usePeriodImpact(period);
  const next = period === null ? true : !period.withheld;
  const name = period === null ? "" : (periodText(period.periodMonth) ?? "");
  return (
    <AlertDialog open={period !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent data-period-dialog="">
        <AlertDialogHeader>
          <AlertDialogTitle>{adminText(next ? "settings_confirm_title_on" : "settings_confirm_title_off", { period: name })}</AlertDialogTitle>
          <AlertDialogDescription>{adminText(next ? "settings_confirm_effect_on" : "settings_confirm_effect_off")}</AlertDialogDescription>
        </AlertDialogHeader>
        {impact.data !== undefined ? (
          <p data-affected={impact.data.affected} className="rounded-md bg-muted p-3 text-sm break-words">
            {adminText("settings_confirm_affected", { count: impact.data.affected })}
          </p>
        ) : impact.isError ? (
          <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
            {impact.error instanceof ApiError ? errorText(impact.error.messageKey, impact.error.code) : errorText("error.internal", "internal")}
          </p>
        ) : (
          <div role="status" aria-label={adminText("settings_confirm_loading")}>
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        <p className="text-sm break-words">{adminText("settings_confirm_keep")}</p>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" className="h-11 md:h-9">
              {adminText("settings_cancel")}
            </Button>
          </AlertDialogCancel>
          <Button type="button" className="h-11 md:h-9" disabled={impact.data === undefined} onClick={() => period !== null && onConfirm(period)}>
            {adminText("settings_confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PeriodRow({ period, current, shown, saving, onToggle }: { readonly period: SettlementPeriod; readonly current: boolean; readonly shown: boolean; readonly saving: boolean; readonly onToggle: () => void }) {
  const name = periodText(period.periodMonth) ?? period.periodMonth;
  const network = adminText(NETWORK[period.network] ?? "network_unknown");
  return (
    <li data-period={keyOf(period)} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold">
          <span className="tabular-nums">{name}</span>
          {current && <span className="rounded-sm bg-secondary px-1.5 text-caption font-medium text-secondary-foreground">{adminText("settings_current")}</span>}
        </span>
        {period.editable && <span className="text-meta text-muted-foreground">{adminText("settings_withheld_switch")}</span>}
        {period.editable && (
          <span data-basis={period.origin} className="text-meta text-muted-foreground">
            {period.origin === "NETWORK" ? adminText("settings_basis_network", { payout: period.basedOn ?? "" }) : adminText(period.origin === "STAFF" ? "settings_basis_staff" : "settings_basis_default")}
          </span>
        )}
      </span>
      {period.editable ? (
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-meta text-muted-foreground" aria-hidden>
            {adminText(shown ? "settings_on" : "settings_off")}
          </span>
          <Switch checked={shown} disabled={saving} label={adminText("settings_withheld_switch_aria", { period: name, network })} onToggle={onToggle} />
        </span>
      ) : (
        <span className="shrink-0 text-sm font-medium">{adminText("settings_always_withheld")}</span>
      )}
    </li>
  );
}

function NetworkPeriods({ network, periods, currentMonth, pending, onToggle }: { readonly network: string; readonly periods: readonly SettlementPeriod[]; readonly currentMonth: string; readonly pending: { key: string; withheld: boolean } | null; readonly onToggle: (p: SettlementPeriod) => void }) {
  return (
    <section className="min-w-0">
      <h3 className="text-sm font-semibold text-muted-foreground">{adminText(NETWORK[network] ?? "network_unknown")}</h3>
      <ul className="divide-y divide-border">
        {periods.map((p) => {
          const mine = pending?.key === keyOf(p) ? pending : null;
          return <PeriodRow key={keyOf(p)} period={p} current={p.periodMonth === currentMonth} shown={mine?.withheld ?? p.withheld} saving={mine !== null} onToggle={() => onToggle(p)} />;
        })}
      </ul>
    </section>
  );
}

export function SettingsPage() {
  const periods = useSettlementPeriods();
  const mark = useMarkPeriod();
  const [asking, setAsking] = useState<SettlementPeriod | null>(null);
  const [pending, setPending] = useState<{ key: string; withheld: boolean } | null>(null);
  const confirm = (p: SettlementPeriod): void => {
    setAsking(null);
    setPending({ key: keyOf(p), withheld: !p.withheld });
    mark.mutate({ network: p.network, periodMonth: p.periodMonth, withheld: !p.withheld }, { onSettled: () => setPending(null) });
  };
  const data = periods.data;
  const failed = mark.error instanceof ApiError ? errorText(mark.error.messageKey, mark.error.code) : mark.isError ? errorText("error.internal", "internal") : null;
  return (
    <>
      <PageHeader title={adminText("nav_settings")} lead={adminText("settings_lead")} />
      <section aria-labelledby="periods-title" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="periods-title" className="text-base font-semibold">
            {adminText("settings_periods_title")}
          </h2>
          <p className="text-sm break-words text-muted-foreground">{adminText("settings_periods_hint")}</p>
        </div>
        {failed !== null && (
          <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
            {adminText("settings_save_failed")} {failed}
          </p>
        )}
        {data !== undefined ? (
          (["shopee", "accesstrade"] as const).map((network) => <NetworkPeriods key={network} network={network} periods={data.periods.filter((p) => p.network === network)} currentMonth={data.currentMonth} pending={pending} onToggle={setAsking} />)
        ) : periods.isError ? (
          <div role="alert" className="flex min-w-0 flex-wrap items-center gap-3 text-sm">
            <span>{adminText("settings_load_failed")}</span>
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => void periods.refetch()}>
              {adminText("settings_retry")}
            </Button>
          </div>
        ) : (
          <div role="status" aria-label={adminText("settings_loading")} className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
      </section>
      <ConfirmChange period={asking} onClose={() => setAsking(null)} onConfirm={confirm} />
    </>
  );
}
