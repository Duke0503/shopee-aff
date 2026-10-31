/**
 * The one period picker above everything it scopes (dashboard-spec "Period", dataviz filters):
 * presets first (today, 7 days, this month, last month), then "custom" with two native date
 * inputs. The choice lives in the URL, so a shared link opens the same period.
 */
import { FilterChip, Input, Button } from "@cashback/ui";
import { useState } from "react";

import { adminText, type AdminKey } from "../labels";
import type { OverviewPreset, OverviewSearch } from "./overview.queries";

const PRESETS: readonly { readonly preset: OverviewPreset; readonly label: AdminKey }[] = [
  { preset: "today", label: "ov_period_today" },
  { preset: "last7", label: "ov_period_last7" },
  { preset: "thisMonth", label: "ov_period_thisMonth" },
  { preset: "lastMonth", label: "ov_period_lastMonth" },
  { preset: "custom", label: "ov_period_custom" },
];

export function PeriodPicker({ search, onChange }: { readonly search: OverviewSearch; readonly onChange: (next: OverviewSearch) => void }) {
  const current = search.period ?? "thisMonth";
  const [custom, setCustom] = useState(current === "custom");
  const [from, setFrom] = useState(search.from ?? "");
  const [to, setTo] = useState(search.to ?? "");
  const ready = from !== "" && to !== "" && from <= to;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div role="group" aria-label={adminText("ov_period_label")} className="flex min-w-0 flex-wrap gap-2">
        {PRESETS.map((p) => (
          <FilterChip
            key={p.preset}
            label={adminText(p.label)}
            pressed={p.preset === "custom" ? custom : !custom && current === p.preset}
            onToggle={() => {
              if (p.preset === "custom") return setCustom(true);
              setCustom(false);
              onChange(p.preset === "thisMonth" ? {} : { period: p.preset });
            }}
          />
        ))}
      </div>
      {custom && (
        <form
          className="flex min-w-0 flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onChange({ period: "custom", from, to });
          }}
        >
          <label className="flex flex-col gap-1 text-meta text-muted-foreground">
            {adminText("ov_period_from")}
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </label>
          <label className="flex flex-col gap-1 text-meta text-muted-foreground">
            {adminText("ov_period_to")}
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </label>
          <Button type="submit" disabled={!ready}>
            {adminText("ov_period_apply")}
          </Button>
        </form>
      )}
    </div>
  );
}
