/**
 * Filters beside the status chips (AD-12, LC-4, LC-7, EXPERIENCE.md date rules): a one-of
 * choice (the network) and a date filter that names its date kind (recorded, approved, paid),
 * each a native select, the easiest control on every screen. Values are the list contract's own:
 * a field's value, or a Vietnam day range `YYYY-MM-DD..YYYY-MM-DD` that the server turns into a
 * half-open instant range including the whole last day. The quick choices are computed by
 * packages/core from the Vietnam day; a range in the URL that is no quick choice is shown as its
 * own option, so a shared link never loses its filter.
 */
import type { FacetCount, ListSearchState } from "@cashback/contracts";
import { formatVnDate, systemClock, vnDatePreset, vnDayStart, VN_DATE_PRESETS, type Clock, type VnDate, type VnDatePreset } from "@cashback/core";
import { useState } from "react";

import { useFilterLayout } from "../brand/filter-layout";
import { ChevronDownIcon } from "../icons";
import { uiText, type UiKey } from "../labels";
import { cn } from "../lib/utils";

export interface FilterApi {
  readonly state: ListSearchState;
  /** Sets the values of the fields named (none clears one), in one change, and goes back to page 1. */
  readonly setFilters: (patch: Readonly<Record<string, readonly string[]>>) => void;
  /** The shown response's facets, total and overall total, for chips that count the filtered set (LC-6). */
  readonly facets?: Readonly<Record<string, readonly FacetCount[]>> | undefined;
  readonly total?: number | undefined;
  readonly overall?: number | undefined;
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface ListSelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  /** Show "label:" before the value on the toolbar; off where the values name themselves (the date kind). */
  readonly prefix?: boolean;
}

/**
 * One labelled one-of choice; the first option is the "all" choice. On the toolbar a native select
 * drawn as the wireframe's dropdown button ("label: value"); inside the phone filter sheet the
 * options as full-width rows, the chosen one filled (wireframe phone filter sheet).
 */
export function ListSelect({ label, value, options, onChange, prefix = true }: ListSelectProps) {
  if (useFilterLayout() === "sheet") {
    return (
      <div role="radiogroup" aria-label={label} className="flex min-w-0 flex-col gap-2">
        <p aria-hidden className="text-sm font-medium text-muted-foreground">{label}</p>
        {options.map((o) => {
          const chosen = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex h-11 w-full min-w-0 items-center rounded-lg border px-3.5 text-left text-[15px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                chosen ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              <span className="truncate">{o.label}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <label className="relative inline-flex h-9 max-w-full min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border bg-card pr-8 pl-3 text-sm font-medium focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted coarse:h-11">
      {prefix && (
        <span aria-hidden className="shrink-0 whitespace-nowrap">
          {label}:
        </span>
      )}
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 cursor-pointer appearance-none truncate bg-transparent font-medium outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground" />
    </label>
  );
}

/** The single-value filter of a field as a select: "all" plus each option. */
export function OptionFilter({ api, field, label, allLabel, options }: { readonly api: FilterApi; readonly field: string; readonly label: string; readonly allLabel: string; readonly options: readonly SelectOption[] }) {
  const value = api.state.filters[field]?.[0] ?? "";
  return <ListSelect label={label} value={value} options={[{ value: "", label: allLabel }, ...options]} onChange={(next) => api.setFilters({ [field]: next === "" ? [] : [next] })} />;
}

const PRESET_LABEL: Record<VnDatePreset, UiKey> = { today: "list_date_today", last7: "list_date_last7", thisMonth: "list_date_this_month", lastMonth: "list_date_last_month" };

export const presetRange = (preset: VnDatePreset, clock: Clock): string => {
  const { from, to } = vnDatePreset(preset, clock);
  return from === to ? from : `${from}..${to}`;
};

function rangeLabel(range: string, clock: Clock): string {
  const [from = "", to = from] = range.split("..");
  try {
    return uiText("list_date_range", { from: formatVnDate(vnDayStart(from as VnDate), clock), to: formatVnDate(vnDayStart(to as VnDate), clock) });
  } catch {
    return range;
  }
}

export interface DateFilterProps {
  readonly api: FilterApi;
  /** The date kinds, each a filterable instant field of the list; the first is the default. */
  readonly fields: readonly SelectOption[];
  readonly clock?: Clock;
}

/** The date kind and the days: one filter at a time, on the kind chosen. */
export function DateFilter({ api, fields, clock = systemClock }: DateFilterProps) {
  const active = fields.find((f) => (api.state.filters[f.value]?.length ?? 0) > 0);
  // The kind chosen before any days are: kept here, since a kind alone filters nothing.
  const [chosen, setChosen] = useState(fields[0]?.value ?? "");
  const field = active?.value ?? chosen;
  const range = active === undefined ? "" : (api.state.filters[active.value]?.[0] ?? "");
  const presets = VN_DATE_PRESETS.map((p) => ({ value: presetRange(p, clock), label: uiText(PRESET_LABEL[p]) }));
  const custom = range !== "" && !presets.some((p) => p.value === range) ? [{ value: range, label: rangeLabel(range, clock) }] : [];
  const setDays = (next: string): void => api.setFilters({ [field]: next === "" ? [] : [next] });
  // Another date kind keeps the days chosen: one change, so the list reloads once.
  const setKind = (next: string): void => {
    setChosen(next);
    if (range !== "" && next !== field) api.setFilters({ [field]: [], [next]: [range] });
  };
  const days = [{ value: "", label: uiText("list_date_any") }, ...presets, ...custom];
  // A list with one date kind needs no kind choice: the days select is named after that date.
  if (fields.length === 1) return <ListSelect label={fields[0]?.label ?? uiText("list_date_days")} value={range} options={days} onChange={setDays} />;
  return (
    <>
      <ListSelect label={uiText("list_date_kind")} value={field} options={fields} onChange={setKind} prefix={false} />
      <ListSelect label={uiText("list_date_days")} value={range} options={days} onChange={setDays} />
    </>
  );
}
