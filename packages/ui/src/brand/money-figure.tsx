/**
 * Money figure (DESIGN.md, EXPERIENCE.md M-1, M-2, LC-15): a server amount in money green,
 * tabular figures, read out in words. The estimate variant keeps the green at weight 400 with
 * the "about" prefix and the estimate tag (label keys money_about, money_estimate_tag). A missing amount is the grey dash, never a zero amount.
 */
import { formatMoney, moneyAriaLabel } from "../format/format-money";
import { uiText } from "../labels";
import { cn } from "../lib/utils";

const SIZES = {
  sm: "text-sm font-semibold",
  md: "text-lg font-semibold",
  lg: "text-[32px] leading-tight font-bold tracking-tight",
} as const;

export interface MoneyFigureProps {
  readonly amount: number | null | undefined;
  readonly estimate?: boolean;
  readonly size?: keyof typeof SIZES;
  readonly className?: string;
}

export function MissingValue({ className }: { readonly className?: string }) {
  return (
    <span className={cn("text-muted-foreground", className)} aria-label={uiText("value_missing_aria")}>
      –
    </span>
  );
}

export function MoneyFigure({ amount, estimate = false, size = "sm", className }: MoneyFigureProps) {
  const text = amount === null || amount === undefined ? null : formatMoney(amount);
  if (text === null || amount === null || amount === undefined) return <MissingValue className={className} />;
  const aria = moneyAriaLabel(amount) ?? text;
  if (!estimate) {
    return (
      <span data-money="" className={cn("whitespace-nowrap text-money tabular-nums", SIZES[size], className)} aria-label={aria}>
        {text}
      </span>
    );
  }
  return (
    <span data-money="estimate" className={cn("inline-flex flex-wrap items-baseline gap-1 text-money tabular-nums", className)}>
      <span className={cn(SIZES[size], "font-normal")} aria-label={`${uiText("money_about")} ${aria}`}>
        {uiText("money_about")} {text}
      </span>
      <span className="rounded-sm bg-muted px-1 text-caption text-muted-foreground">{uiText("money_estimate_tag")}</span>
    </span>
  );
}
