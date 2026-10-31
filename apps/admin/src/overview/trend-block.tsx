/**
 * Block 4, one chart (dashboard-spec Block 4): weekly bars for the last 12 Vietnam weeks, profit by
 * default, with tabs for commission and cashback on the same chart and one axis (never two). Each
 * tab's summary line compares its 12 weeks with the 12 before, from the server's totals.
 */
import type { Figure, Overview } from "@cashback/contracts";
import { addVnDays, parseVnDate } from "@cashback/core";
import { BarChart, cn, formatCompactMoney, formatMoney, formatSignedMoney, type BarPoint } from "@cashback/ui";
import { useState } from "react";

import { adminText, type AdminKey } from "../labels";
import { Block, Card, dayText } from "./overview-parts";

type Measure = "profit" | "commission" | "cashback";

const TABS: readonly { readonly measure: Measure; readonly label: AdminKey }[] = [
  { measure: "profit", label: "ov_trend_profit" },
  { measure: "commission", label: "ov_trend_commission" },
  { measure: "cashback", label: "ov_trend_cashback" },
];

const valueText = (v: number): string => (v < 0 ? (formatSignedMoney(v) ?? "") : (formatMoney(v) ?? ""));
const figureText = (f: Figure["value"]): string => (f === null ? "\u2013" : valueText(f));

export function TrendBlock({ trend }: { readonly trend: Overview["trend"] }) {
  const [measure, setMeasure] = useState<Measure>("profit");
  const tab = TABS.find((t) => t.measure === measure) ?? TABS[0];
  const points: BarPoint[] = trend.weeks.map((w) => ({
    key: w.weekStart,
    label: dayText(w.weekStart).slice(0, 5),
    name: adminText("ov_week", { from: dayText(w.weekStart), to: dayText(addVnDays(parseVnDate(w.weekStart), 6)) }),
    value: w[measure],
  }));
  const totals = trend.totals[measure];
  const empty = trend.totals.commission.value === null && trend.totals.commission.previous === null;
  return (
    <Block title={adminText("ov_trend_title")} basis={adminText("ov_trend_basis")}>
      <Card>
        <div role="tablist" aria-label={adminText("ov_trend_title")} className="flex min-w-0 flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.measure}
              type="button"
              role="tab"
              aria-selected={t.measure === measure}
              onClick={() => setMeasure(t.measure)}
              className={cn("min-h-9 rounded-md px-3 text-sm font-medium coarse:min-h-11", t.measure === measure ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent")}
            >
              {adminText(t.label)}
            </button>
          ))}
        </div>
        <p data-trend-summary className="text-sm tabular-nums">{adminText("ov_trend_summary", { now: figureText(totals.value), before: figureText(totals.previous) })}</p>
        {empty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{adminText("ov_trend_empty")}</p>
        ) : (
          <BarChart
            points={points}
            formatValue={valueText}
            formatTick={formatCompactMoney}
            title={`${adminText("ov_trend_title")}: ${adminText(tab?.label ?? "ov_trend_profit")}`}
            columnHeader={adminText("ov_week_col")}
            valueHeader={adminText(tab?.label ?? "ov_trend_profit")}
          />
        )}
      </Card>
    </Block>
  );
}
