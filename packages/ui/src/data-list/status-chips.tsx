/**
 * The status chip row (LC-6, LC-13, EXPERIENCE.md filter chip): one chip per registry status in
 * lifecycle order with the count the server sent for the filtered set; several may be on
 * together and the "all" chip clears the group. The "all" chip shows a count only while no chip is on, when
 * it is exactly the filtered total; it never shows a figure from another set.
 */
import type { FacetCount } from "@cashback/contracts";
import { statusesOf, type EntityName } from "@cashback/core";

import { FilterChip } from "../brand/filter-chip";
import { statusLabel, uiText } from "../labels";

export interface StatusChipsProps {
  readonly entity: EntityName;
  readonly facets: readonly FacetCount[] | undefined;
  readonly total: number | undefined;
  readonly selected: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}

export function StatusChips({ entity, facets, total, selected, onChange }: StatusChipsProps) {
  const counts = new Map((facets ?? []).map((f) => [f.value, f.count]));
  const toggle = (value: string): void => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  return (
    <div role="group" aria-label={uiText("list_status_group")} className="flex min-w-0 flex-wrap gap-2">
      <FilterChip label={uiText("list_all")} count={selected.length === 0 ? total : undefined} pressed={selected.length === 0} onToggle={() => onChange([])} />
      {statusesOf(entity)
        .filter((s) => s.derivedFrom === null)
        .map((s) => (
          <FilterChip key={s.value} label={statusLabel(s.labelKey)} count={facets === undefined ? undefined : (counts.get(s.value) ?? 0)} pressed={selected.includes(s.value)} onToggle={() => toggle(s.value)} />
        ))}
    </div>
  );
}
