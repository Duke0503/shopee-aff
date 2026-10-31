/**
 * A column chart of one series over time (dataviz: one axis, thin marks, selective labels): bars at
 * most 24 px wide, a 4 px rounded data end and a square base on the zero line, hairline solid
 * gridlines, the last value labelled at its cap, every value on hover and on keyboard focus (the
 * whole band is the hit target), and a table view with every value. A negative value (a loss)
 * grows down from the same zero line, so the one axis stays honest. The chart draws at its real
 * width; values and labels are formatted by the caller, never computed here.
 */
import { useId, useState } from "react";

import { uiText } from "../labels";
import { cn } from "../lib/utils";
import { niceTicks } from "./chart-scale";
import { useElementWidth } from "./use-element-width";

export interface BarPoint {
  readonly key: string;
  /** The short tick text under the bar ("12/10"). */
  readonly label: string;
  /** The full name of the bar for the tooltip and the table ("week of 12/10 to 18/10"). */
  readonly name: string;
  readonly value: number;
}

export interface BarChartProps {
  readonly points: readonly BarPoint[];
  /** The value in full, for the tooltip, the end label and the table. */
  readonly formatValue: (value: number) => string;
  /** The value on the axis, compact. */
  readonly formatTick: (value: number) => string;
  /** What the chart shows, for screen readers and the table caption. */
  readonly title: string;
  readonly columnHeader: string;
  readonly valueHeader: string;
  /** A Tailwind fill class for the series (a chart token). */
  readonly barClass?: string;
}

const HEIGHT = 220;
const TOP = 22;
const BOTTOM = 26;
const BAR_MAX = 24;
const RADIUS = 4;

function barPath(x: number, width: number, zeroY: number, valueY: number): string {
  const h = Math.abs(zeroY - valueY);
  if (h < 0.5) return "";
  const r = Math.min(RADIUS, h, width / 2);
  if (valueY < zeroY) return `M${x},${zeroY}V${valueY + r}Q${x},${valueY} ${x + r},${valueY}H${x + width - r}Q${x + width},${valueY} ${x + width},${valueY + r}V${zeroY}Z`;
  return `M${x},${zeroY}V${valueY - r}Q${x},${valueY} ${x + r},${valueY}H${x + width - r}Q${x + width},${valueY} ${x + width},${valueY - r}V${zeroY}Z`;
}

function ChartTable({ points, title, columnHeader, valueHeader, formatValue }: BarChartProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-0 text-sm">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="border-b border-border text-left text-meta text-muted-foreground">
            <th scope="col" className="py-1.5 pr-3 font-medium">{columnHeader}</th>
            <th scope="col" className="py-1.5 text-right font-medium">{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.key} className="border-b border-border last:border-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal">{p.name}</th>
              <td className="py-1.5 text-right tabular-nums">{formatValue(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Geometry {
  readonly left: number;
  readonly band: number;
  readonly barW: number;
  readonly y: (v: number) => number;
  readonly ticks: readonly number[];
  readonly tickTexts: readonly string[];
  readonly every: number;
}

function geometryOf(points: readonly BarPoint[], formatTick: (v: number) => string, width: number): Geometry {
  const ticks = niceTicks(points.map((p) => p.value));
  const tickTexts = ticks.map(formatTick);
  const left = Math.max(...tickTexts.map((t) => t.length)) * 7 + 10;
  const band = Math.max(width - left - 4, 40) / Math.max(points.length, 1);
  const lo = ticks[0] ?? 0;
  const hi = ticks.at(-1) ?? 1;
  return { left, band, barW: Math.min(BAR_MAX, Math.max(4, band * 0.6)), ticks, tickTexts, every: Math.max(1, Math.ceil(44 / band)), y: (v) => TOP + ((hi - v) / (hi - lo || 1)) * (HEIGHT - TOP - BOTTOM) };
}

interface BarProps {
  readonly point: BarPoint;
  readonly index: number;
  readonly count: number;
  readonly g: Geometry;
  readonly active: number | null;
  readonly tipId: string;
  readonly barClass: string;
  readonly formatValue: (v: number) => string;
  readonly onActive: (index: number | null) => void;
}

function Bar({ point: p, index: i, count, g, active, tipId, barClass, formatValue, onActive }: BarProps) {
  const x = g.left + i * g.band + (g.band - g.barW) / 2;
  const zeroY = g.y(0);
  return (
    <g>
      <path d={barPath(x, g.barW, zeroY, g.y(p.value))} className={cn(barClass, active !== null && active !== i && "opacity-60")} />
      {i === count - 1 && p.value !== 0 && (
        <text x={x + g.barW / 2} y={p.value >= 0 ? g.y(p.value) - 6 : g.y(p.value) + 14} textAnchor="middle" className="fill-foreground text-[12px] font-semibold tabular-nums">{formatValue(p.value)}</text>
      )}
      {i % g.every === (count - 1) % g.every && (
        <text x={g.left + i * g.band + g.band / 2} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[12px] tabular-nums">{p.label}</text>
      )}
      <rect
        x={g.left + i * g.band}
        y={TOP}
        width={g.band}
        height={HEIGHT - TOP - BOTTOM}
        fill="transparent"
        tabIndex={0}
        role="button"
        aria-label={`${p.name}: ${formatValue(p.value)}`}
        aria-describedby={active === i ? tipId : undefined}
        className="cursor-default outline-none focus-visible:stroke-ring focus-visible:stroke-2"
        onPointerEnter={() => onActive(i)}
        onFocus={() => onActive(i)}
        onBlur={() => onActive(null)}
      />
    </g>
  );
}

function Plot({ points, formatValue, formatTick, title, barClass = "fill-chart-1" }: BarChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const [ref, width] = useElementWidth<HTMLDivElement>(640);
  const tipId = useId();
  const g = geometryOf(points, formatTick, width);
  const plotRight = width - 4;
  const shown = active === null ? undefined : points[active];
  return (
    <div ref={ref} className="relative min-w-0" onPointerLeave={() => setActive(null)}>
      <svg role="img" aria-label={title} width={width} height={HEIGHT} className="block max-w-full overflow-visible">
        {g.ticks.map((t, i) => (
          <g key={t}>
            <line x1={g.left} x2={plotRight} y1={g.y(t)} y2={g.y(t)} className={t === 0 ? "stroke-input" : "stroke-border"} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={g.left - 6} y={g.y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[12px] tabular-nums">{g.tickTexts[i]}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <Bar key={p.key} point={p} index={i} count={points.length} g={g} active={active} tipId={tipId} barClass={barClass} formatValue={formatValue} onActive={setActive} />
        ))}
      </svg>
      {shown !== undefined && active !== null && (
        <div id={tipId} role="tooltip" className="pointer-events-none absolute top-0 z-10 flex min-w-32 -translate-x-1/2 flex-col rounded-md border border-border bg-popover px-2.5 py-1.5 text-sm shadow-md" style={{ left: Math.min(Math.max(g.left + active * g.band + g.band / 2, 70), width - 70) }}>
          <span className="font-semibold tabular-nums">{formatValue(shown.value)}</span>
          <span className="text-meta text-muted-foreground">{shown.name}</span>
        </div>
      )}
    </div>
  );
}

export function BarChart(props: BarChartProps) {
  const [table, setTable] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex justify-end">
        <button type="button" className="min-h-8 rounded-md px-2 text-sm font-medium text-primary hover:bg-accent coarse:min-h-11" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {uiText(table ? "chart_show_chart" : "chart_show_table")}
        </button>
      </div>
      {table ? <ChartTable {...props} /> : <Plot {...props} />}
    </div>
  );
}
