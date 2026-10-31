/**
 * The Overview's building blocks (DESIGN.md cards, dataviz stat tile): a block with its title and
 * the time base it is read on, a figure card (label, value, one-line definition, change against
 * the previous period), and the formatting of the server's figures. Cards in one grid row stretch
 * to the row's height (grid `align-items: stretch` and `h-full`), so a row is always even.
 */
import type { Figure, Ratio } from "@cashback/contracts";
import { formatVnDate, parseVnDate, systemClock, vnDayStart } from "@cashback/core";
import { cn, formatBps, formatBpsChange, formatCount, formatSignedMoney, MissingValue, MoneyFigure } from "@cashback/ui";
import type { ReactNode } from "react";

import { adminText } from "../labels";

/** "01/10" (or "01/10/2025" in another year) for a Vietnam day the server named. */
export const dayText = (day: string): string => formatVnDate(vnDayStart(parseVnDate(day)), systemClock);

export function Block({ title, basis, children, className, id }: { readonly title: string; readonly basis?: string; readonly children: ReactNode; readonly className?: string; readonly id?: string }) {
  return (
    <section id={id} aria-label={title} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {basis !== undefined && <p className="text-meta text-muted-foreground">{basis}</p>}
      </header>
      {children}
    </section>
  );
}

export function Card({ children, className, tone = "plain" }: { readonly children: ReactNode; readonly className?: string; readonly tone?: "plain" | "attention" }) {
  return <div className={cn("flex h-full min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-4", tone === "attention" ? "border-status-attention/40" : "border-border", className)}>{children}</div>;
}

/** The change line of a money figure (+7,067 dong against the previous period), or that there is no previous figure. */
export function MoneyChange({ figure }: { readonly figure: Figure }) {
  if (figure.change === null) return <p className="text-meta text-muted-foreground">{adminText("ov_change_none")}</p>;
  return <p className="text-meta text-muted-foreground tabular-nums">{adminText("ov_change", { change: formatSignedMoney(figure.change) ?? "" })}</p>;
}

export function CountChange({ figure }: { readonly figure: Figure }) {
  if (figure.change === null) return <p className="text-meta text-muted-foreground">{adminText("ov_change_none")}</p>;
  const sign = figure.change > 0 ? "+" : figure.change < 0 ? "\u2212" : "";
  return <p className="text-meta text-muted-foreground tabular-nums">{adminText("ov_change", { change: `${sign}${formatCount(Math.abs(figure.change))}` })}</p>;
}

/** A whole-dong amount that may be negative (a loss, more paid out than received): the minus in the rejected tone. */
export function SignedMoney({ amount, size = "md" }: { readonly amount: number | null; readonly size?: "sm" | "md" | "lg" }) {
  if (amount === null || amount >= 0) return <MoneyFigure amount={amount} size={size} />;
  const sizes = { sm: "text-sm", md: "text-lg", lg: "text-[32px] leading-tight font-bold" } as const;
  return <span className={cn("font-semibold whitespace-nowrap text-status-rejected tabular-nums", sizes[size])}>{formatSignedMoney(amount)}</span>;
}

/** A money figure card; a figure with no data is the grey dash, never 0. */
export function MoneyCard({ label, figure, definition, size = "md", children }: { readonly label: string; readonly figure: Figure; readonly definition: ReactNode; readonly size?: "md" | "lg"; readonly children?: ReactNode }) {
  return (
    <Card>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <SignedMoney amount={figure.value} size={size} />
      <p className="text-meta text-muted-foreground">{definition}</p>
      <div className="mt-auto pt-1">
        <MoneyChange figure={figure} />
      </div>
      {children}
    </Card>
  );
}

/** A ratio: its percentage, muted with the "not enough data" tag below 100 approved orders (FR-27); never a placeholder number. */
export function RatioValue({ ratio, previous = false, tag = true }: { readonly ratio: Ratio; readonly previous?: boolean; readonly tag?: boolean }) {
  const text = formatBps(ratio.bps);
  if (text === null) return <MissingValue />;
  return (
    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5">
      <span data-ratio={ratio.enoughData ? "ok" : "thin"} className={cn("tabular-nums", ratio.enoughData ? "font-semibold" : "text-muted-foreground")}>
        {text}
      </span>
      {!ratio.enoughData && tag && <NotEnoughTag />}
      {previous && ratio.previousBps !== null && (
        <span className="text-caption text-muted-foreground">
          {adminText("ov_previous", { value: formatBps(ratio.previousBps) ?? "" })}
          {ratio.changeBps !== null && ` (${formatBpsChange(ratio.changeBps) ?? ""})`}
        </span>
      )}
    </span>
  );
}

/** FR-27: the mark of a ratio measured on fewer than 100 approved orders. */
export function NotEnoughTag() {
  return <span className="rounded-sm bg-muted px-1 text-caption whitespace-nowrap text-muted-foreground">{adminText("ov_not_enough")}</span>;
}

export function CountValue({ value }: { readonly value: number | null }) {
  return value === null ? <MissingValue /> : <span className="tabular-nums">{formatCount(value)}</span>;
}
