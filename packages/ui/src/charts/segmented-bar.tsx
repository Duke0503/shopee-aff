/**
 * One whole split into parts (dataviz "tall segmented bar"): 28 px high, each part its own block
 * with 4 px corners and a 2 px surface gap, widths in proportion to the server's amounts, a part
 * of 0 drawn as nothing. A part prints its share inside only when the text fits; every part's
 * name and amount are on hover, on keyboard focus and in the legend list the caller renders
 * beside it (the table view of this figure). Colours follow the part, never its rank.
 */
import { useId, useState } from "react";

import { cn } from "../lib/utils";
import { useElementWidth } from "./use-element-width";

export interface Segment {
  readonly key: string;
  readonly name: string;
  readonly value: number;
  /** A Tailwind background class (a chart token). */
  readonly colorClass: string;
  /** What the part prints inside when it fits ("62%"), already formatted by the caller. */
  readonly inside: string;
  /** The full readout for the tooltip ("cashback 71,216 dong"). */
  readonly readout: string;
}

const GAP = 2;
const CHAR = 7;

export function SegmentedBar({ segments, label }: { readonly segments: readonly Segment[]; readonly label: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(480);
  const [active, setActive] = useState<string | null>(null);
  const tipId = useId();
  const parts = segments.filter((s) => s.value > 0);
  // Geometry only: how many pixels each part gets, to know whether its label fits.
  const whole = parts.reduce((sum, s) => sum + s.value, 0);
  const usable = Math.max(width - GAP * Math.max(parts.length - 1, 0), 0);
  const shown = parts.find((s) => s.key === active);
  return (
    <div ref={ref} className="relative min-w-0" onPointerLeave={() => setActive(null)}>
      <div role="img" aria-label={label} className="flex h-7 w-full min-w-0 gap-0.5">
        {parts.map((s) => {
          const px = whole === 0 ? 0 : (s.value / whole) * usable;
          const fits = px >= s.inside.length * CHAR + 12;
          return (
            <div
              key={s.key}
              tabIndex={0}
              role="button"
              aria-label={s.readout}
              aria-describedby={active === s.key ? tipId : undefined}
              onPointerEnter={() => setActive(s.key)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              style={{ flexGrow: s.value, flexBasis: 0 }}
              className={cn("flex min-w-0 items-center rounded-sm px-1.5 text-[12px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring", s.colorClass, active !== null && active !== s.key && "opacity-70")}
            >
              {fits && <span className="truncate tabular-nums">{s.inside}</span>}
            </div>
          );
        })}
      </div>
      {shown !== undefined && (
        <div id={tipId} role="tooltip" className="pointer-events-none absolute top-9 left-0 z-10 rounded-md border border-border bg-popover px-2.5 py-1.5 text-sm shadow-md">
          {shown.readout}
        </div>
      )}
    </div>
  );
}
