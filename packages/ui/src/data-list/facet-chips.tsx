/**
 * Quick filter chips over facet fields that are not a registry status (LC-6, EXPERIENCE.md filter
 * chip): the reasons of the review queue, "owed" and "flagged" on Customers. Each chip is one value
 * of one filterable field and shows the count the server sent for the filtered set; chips of the
 * same field add up (any of them), chips of different fields narrow (all of them). The "all" chip
 * clears every field the row covers; it shows the overall total, named as such, when the list
 * sends one, and otherwise a count only while no chip is on, when it is exactly the filtered total.
 * No count here is ever computed in the browser.
 */
import { FilterChip } from "../brand/filter-chip";
import { formatCount } from "../format/format-money";
import { uiText } from "../labels";
import type { FilterApi } from "./list-filters";

export interface FacetChoice {
  /** A filterable, faceted field of the list. */
  readonly field: string;
  readonly value: string;
  readonly label: string;
}

export interface FacetChipsProps {
  readonly api: FilterApi;
  readonly choices: readonly FacetChoice[];
  /** The group's accessible name. */
  readonly label?: string;
  /** Leave out a choice whose filtered count is 0 (a long list of reasons), unless it is on. */
  readonly hideEmpty?: boolean;
}

function countOf(api: FilterApi, choice: FacetChoice): number | undefined {
  const facets = api.facets?.[choice.field];
  if (facets === undefined) return undefined;
  return facets.find((f) => f.value === choice.value)?.count ?? 0;
}

export function FacetChips({
  api,
  choices,
  label = uiText("list_chip_group"),
  hideEmpty = false,
}: FacetChipsProps) {
  const fields = [...new Set(choices.map((c) => c.field))];
  const selected = (c: FacetChoice): boolean =>
    (api.state.filters[c.field] ?? []).includes(c.value);
  const anyOn = choices.some(selected);
  const toggle = (c: FacetChoice): void => {
    const current = api.state.filters[c.field] ?? [];
    api.setFilters({
      [c.field]: current.includes(c.value)
        ? current.filter((v) => v !== c.value)
        : [...current, c.value],
    });
  };
  const clear = (): void => api.setFilters(Object.fromEntries(fields.map((f) => [f, []])));
  const shown = choices.filter((c) => !hideEmpty || selected(c) || (countOf(api, c) ?? 0) > 0);
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-wrap gap-2">
      {api.overall === undefined ? (
        <FilterChip
          label={uiText("list_all")}
          count={anyOn ? undefined : api.total}
          pressed={!anyOn}
          onToggle={clear}
        />
      ) : (
        <FilterChip
          label={uiText("list_all")}
          count={api.overall}
          ariaLabel={uiText("list_all_overall", { total: formatCount(api.overall) })}
          pressed={!anyOn}
          onToggle={clear}
        />
      )}
      {shown.map((c) => (
        <FilterChip
          key={`${c.field}:${c.value}`}
          label={c.label}
          count={countOf(api, c)}
          pressed={selected(c)}
          onToggle={() => toggle(c)}
        />
      ))}
    </div>
  );
}
