/**
 * Block 2, the business result of the period by approval day (dashboard-spec Block 2): the
 * operator's profit is the largest figure on the screen; beside it, where the money went (one
 * segmented bar: fee and tax, cashback, event bonus, profit) and every line of the formula with
 * its one-line definition. Every amount is the server's; the bar's widths follow its amounts and
 * its shares are the server's basis points.
 */
import type { Overview } from "@cashback/contracts";
import { cn, formatBps, formatCount, formatMoney, formatSignedMoney, MissingValue, MoneyFigure, SegmentedBar, type Segment } from "@cashback/ui";

import { adminText } from "../labels";
import { Block, Card, MoneyChange } from "./overview-parts";

type Business = Overview["business"];

const SWATCH = { profit: "bg-chart-1", cashback: "bg-chart-2", bonus: "bg-chart-3", feeTax: "bg-chart-4" } as const;

/** Owner decision (2026-10-31): the two bases of the total, each labelled; the cash part says what it is made of. */
function ProfitParts({ b, cash }: { readonly b: Business; readonly cash: NonNullable<Business["cashBasis"]> }) {
  const signed = (v: number): string => (v < 0 ? (formatSignedMoney(v) ?? "") : (formatMoney(v) ?? ""));
  return (
    <ul data-profit-parts className="flex flex-col gap-1 text-sm">
      {b.profit.value !== null && <li data-profit-part="approval">{adminText("ov_profit_approval", { amount: signed(b.profit.value) })}</li>}
      <li data-profit-part="cash">
        {adminText("ov_profit_cash", { amount: signed(cash.profit) })}
        <span className="block text-meta text-muted-foreground">{adminText("ov_profit_cash_def", { received: formatMoney(cash.received) ?? "", paid: formatMoney(cash.paidOut) ?? "" })}</span>
      </li>
    </ul>
  );
}

function ProfitCard({ b, segments }: { readonly b: Business; readonly segments: readonly Segment[] }) {
  const margin = formatBps(b.margin.bps);
  return (
    <Card>
      <p className="text-sm font-medium text-muted-foreground">{adminText("ov_profit")}</p>
      {b.totalProfit.value === null ? (
        <MissingValue className="text-[48px] leading-none" />
      ) : (
        <span data-profit className={cn("text-[44px] leading-none font-bold tracking-tight break-all md:text-[52px]", b.totalProfit.value < 0 ? "text-status-rejected" : "text-money")}>
          {b.totalProfit.value < 0 ? "\u2212" : ""}
          {formatMoney(Math.abs(b.totalProfit.value))}
        </span>
      )}
      {b.cashBasis !== null && <ProfitParts b={b} cash={b.cashBasis} />}
      {margin !== null && <p className="text-[15px] font-medium">{adminText("ov_margin", { value: margin })}</p>}
      <p className="text-meta text-muted-foreground">{adminText("ov_profit_def")}</p>
      <MoneyChange figure={b.totalProfit} />
      {(segments.length > 0 || (b.profit.value !== null && b.profit.value < 0)) && (
      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-sm font-medium text-muted-foreground">{adminText("ov_split_title")}</p>
        {segments.length > 0 ? (
          <>
            <SegmentedBar segments={segments} label={adminText("ov_split_title")} />
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted-foreground">
              {segments.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span aria-hidden className={cn("size-2.5 rounded-sm", s.colorClass)} />
                  {s.name}
                </li>
              ))}
            </ul>
          </>
        ) : (
          b.profit.value !== null && b.profit.value < 0 && <p className="text-sm text-status-rejected">{adminText("ov_split_loss")}</p>
        )}
      </div>
      )}
    </Card>
  );
}

function Line({ label, amount, definition, swatch, minus = false, name }: { readonly label: string; readonly amount: number | null; readonly definition: string; readonly swatch?: string; readonly minus?: boolean; readonly name: string }) {
  return (
    <li data-line={name} className="flex min-w-0 items-start justify-between gap-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-sm", swatch ?? "bg-transparent")} />
        <div className="min-w-0">
          <p className="text-sm font-medium break-words">{label}</p>
          <p className="text-meta break-words text-muted-foreground">{definition}</p>
        </div>
      </div>
      <span className="shrink-0 text-right">
        {amount === null ? <MissingValue /> : minus && amount > 0 ? <span className="text-sm font-semibold tabular-nums">{"\u2212"}{formatMoney(amount)}</span> : <MoneyFigure amount={amount} />}
      </span>
    </li>
  );
}

function segmentsOf(b: Business): Segment[] {
  const split = b.split;
  if (split === null) return [];
  const part = (key: string, name: string, value: number | null, bps: number, colorClass: string): Segment => {
    const share = formatBps(bps) ?? "";
    return { key, name, value: value ?? 0, colorClass, inside: share, readout: adminText("ov_seg_readout", { name, amount: formatMoney(value ?? 0) ?? "", share }) };
  };
  return [
    part("profit", adminText("ov_seg_profit"), b.profit.value, split.profitBps, SWATCH.profit),
    part("cashback", adminText("ov_seg_cashback"), b.cashback.value, split.cashbackBps, SWATCH.cashback),
    part("bonus", adminText("ov_seg_bonus"), b.eventBonus.value, split.eventBonusBps, SWATCH.bonus),
    part("feeTax", adminText("ov_seg_fee_tax"), split.feeAndTax, split.feeAndTaxBps, SWATCH.feeTax),
  ];
}

function Notes({ b }: { readonly b: Business }) {
  const notes = [
    ...b.byNetwork.map((n) => adminText("ov_by_network", { network: adminText(n.network === "shopee" ? "network_shopee" : "network_accesstrade"), amount: formatMoney(n.commission) ?? "", count: formatCount(n.orders) })),
    ...b.byCampaign.map((c) => adminText("ov_by_campaign", { name: c.name, amount: formatMoney(c.bonus) ?? "" })),
    ...(b.withoutSplit > 0 ? [adminText("ov_without_split", { count: formatCount(b.withoutSplit) })] : []),
    ...(b.importedWithoutApproval > 0 ? [adminText("ov_imported_note", { count: formatCount(b.importedWithoutApproval) })] : []),
    adminText("ov_income_tax_note"),
  ];
  return (
    <ul className="flex flex-col gap-1 text-meta text-muted-foreground">
      {notes.map((n) => (
        <li key={n} className="break-words">{n}</li>
      ))}
    </ul>
  );
}

export function BusinessBlock({ b }: { readonly b: Business }) {
  const segments = segmentsOf(b);
  const taxDef = b.withheldPeriods.length === 0 ? adminText("ov_line_tax_none") : adminText("ov_line_tax_def", { periods: b.withheldPeriods.map((p) => `${p.slice(5, 7)}/${p.slice(0, 4)}`).join(", ") });
  return (
    <Block title={adminText("ov_business_title")} basis={adminText("ov_business_basis")}>
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ProfitCard b={b} segments={segments} />
        <Card>
          <ul className="flex min-w-0 flex-col divide-y divide-border">
            <Line name="commission" label={adminText("ov_line_commission")} amount={b.commission.value} definition={adminText("ov_line_commission_def", { count: b.approvedOrders.value === null ? "\u2013" : formatCount(b.approvedOrders.value) })} />
            <Line name="fee" label={adminText("ov_line_fee")} amount={b.fee.value} definition={adminText("ov_line_fee_def")} swatch={SWATCH.feeTax} minus />
            <Line name="tax" label={adminText("ov_line_tax")} amount={b.tax.value} definition={taxDef} swatch={SWATCH.feeTax} minus />
            <Line name="cashback" label={adminText("ov_line_cashback")} amount={b.cashback.value} definition={adminText("ov_line_cashback_def", { paid: formatMoney(b.cashbackPaid) ?? "", owed: formatMoney(b.cashbackOwed) ?? "" })} swatch={SWATCH.cashback} minus />
            <Line name="bonus" label={adminText("ov_line_bonus")} amount={b.eventBonus.value} definition={adminText("ov_line_bonus_def")} swatch={SWATCH.bonus} minus />
            <Line name="clawback" label={adminText("ov_line_clawback")} amount={b.clawbackNetted.value} definition={adminText("ov_line_clawback_def")} />
          </ul>
          <Notes b={b} />
        </Card>
      </div>
    </Block>
  );
}
