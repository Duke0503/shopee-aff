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

import { uiText, type UiKey } from "../labels";

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

const SELECT = "h-11 w-full min-w-0 truncate rounded-lg border border-input bg-card px-2.5 text-[15px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:text-sm";

export interface ListSelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
}

/** One labelled native select; the first option is the "all" choice. */
export function ListSelect({ label, value, options, onChange }: ListSelectProps) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 md:w-auto md:flex-none">
      <span className="text-caption text-muted-foreground">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={SELECT}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
      <ListSelect label={uiText("list_date_kind")} value={field} options={fields} onChange={setKind} />
      <ListSelect label={uiText("list_date_days")} value={range} options={days} onChange={setDays} />
    </>
  );
}
