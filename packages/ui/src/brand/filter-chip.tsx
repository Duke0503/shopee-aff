/**
 * Filter chip (DESIGN.md, EXPERIENCE.md Component Patterns, UX-DR13, wireframe chips): a toggle
 * button with `aria-pressed` and its count in the accessible name. On the toolbar it is a pill,
 * filled with the brand green when on; inside the phone filter sheet it is a full-width row with
 * the count at its right edge. A chip with 0 stays visible and selectable. The count is what the
 * server sent for the same filtered set (LC-6).
 */
import { formatCount } from "../format/format-money";
import { cn } from "../lib/utils";
import { useFilterLayout } from "./filter-layout";

export interface FilterChipProps {
  readonly label: string;
  readonly count?: number | undefined;
  readonly pressed: boolean;
  readonly onToggle: () => void;
  /** The accessible name when the count needs its own words (the overall total); label and count otherwise. */
  readonly ariaLabel?: string | undefined;
}

export function FilterChip({ label, count, pressed, onToggle, ariaLabel }: FilterChipProps) {
  const row = useFilterLayout() === "sheet";
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel ?? (count === undefined ? label : `${label} ${formatCount(count)}`)}
      title={ariaLabel}
      onClick={onToggle}
      className={cn(
        "max-w-full items-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        row
          ? "flex h-11 w-full justify-between gap-3 rounded-lg border px-3.5 text-left text-[15px]"
          : "inline-flex h-8 shrink-0 gap-1.5 rounded-full border px-3 text-sm font-medium coarse:h-11",
        row
          ? pressed
            ? "border-primary bg-secondary font-semibold text-foreground"
            : "border-border bg-card text-foreground hover:bg-muted"
          : pressed
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className={cn("tabular-nums", row ? "text-sm font-normal text-muted-foreground" : cn("text-meta", pressed ? "text-primary-foreground/85" : "text-muted-foreground"))}>{formatCount(count)}</span>
      )}
    </button>
  );
}
