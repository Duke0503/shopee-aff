/**
 * Filter chip (DESIGN.md, EXPERIENCE.md Component Patterns, UX-DR13): a toggle button with
 * `aria-pressed` and its count in the accessible name. A chip with 0 stays visible and
 * selectable. The count is what the server sent for the same filtered set (LC-6).
 */
import { formatCount } from "../format/format-money";
import { CheckIcon } from "../icons";
import { cn } from "../lib/utils";

export interface FilterChipProps {
  readonly label: string;
  readonly count?: number | undefined;
  readonly pressed: boolean;
  readonly onToggle: () => void;
  /** The accessible name when the count needs its own words (the overall total); label and count otherwise. */
  readonly ariaLabel?: string | undefined;
}

export function FilterChip({ label, count, pressed, onToggle, ariaLabel }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel ?? (count === undefined ? label : `${label} ${formatCount(count)}`)}
      title={ariaLabel}
      onClick={onToggle}
      className={cn(
        "inline-flex h-8 max-w-full shrink-0 items-center gap-1.5 rounded-full border px-3 text-meta font-medium outline-none coarse:h-11",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        pressed ? "border-secondary-foreground/30 bg-secondary text-secondary-foreground" : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {pressed && <CheckIcon aria-hidden className="size-3.5 shrink-0" />}
      <span className="truncate">{label}</span>
      {count !== undefined && <span className="text-caption text-muted-foreground tabular-nums">{formatCount(count)}</span>}
    </button>
  );
}
