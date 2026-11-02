/**
 * How cashback is split, with the server's example (FR-13, D2, D12, money rule 11; Story 7.7
 * AC1). First the one sentence of the pen.dev guide (the share, an example commission and what it
 * gives, with and without the withheld tax); under it, folded, the full working: a product and its Shopee rate give the approved commission; then the fee, the tax when the
 * period is withheld, what is left and the customer's share of it, each rate beside its amount in
 * dong. Two worked columns, not withheld and withheld; side by side from tablet, stacked on phone.
 * The cap is shown on its own example, a dearer product whose Shopee part is capped. Every rate
 * and amount is the server's (packages/money there), formatted here and never computed.
 */
import type { GuideFigures } from "@cashback/contracts";
import { Button, formatBps, formatMoney, RefreshCwIcon, Skeleton } from "@cashback/ui";

import { webText } from "../labels";
import { useGuideFigures } from "./guide.queries";

const money = (amount: number): string => formatMoney(amount) ?? "";
const minus = (amount: number): string => `\u2212${money(amount)}`;
const rate = (bps: number): string => formatBps(bps) ?? "";

function Row({ label, value, strong = false }: { readonly label: string; readonly value: string; readonly strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "font-semibold" : ""}`}>
      <dt className="min-w-0 text-[15px]">{label}</dt>
      <dd className={`shrink-0 text-[15px] tabular-nums ${strong ? "text-money" : ""}`}>{value}</dd>
    </div>
  );
}

function Column({ figures, withheld }: { readonly figures: GuideFigures; readonly withheld: boolean }) {
  const { example } = figures;
  const split = withheld ? example.withheld : example.notWithheld;
  return (
    <div data-split={withheld ? "withheld" : "not-withheld"} className="flex flex-col rounded-lg border border-border bg-card p-3">
      <h3 className="pb-1 text-[15px] font-semibold">{webText(withheld ? "guide_split_withheld" : "guide_split_not_withheld")}</h3>
      <dl className="divide-y divide-border">
        <Row label={webText("guide_split_commission")} value={money(example.commission)} />
        <Row label={webText("guide_split_fee", { rate: rate(figures.feeBps) })} value={minus(split.fee)} />
        {withheld && <Row label={webText("guide_split_tax", { rate: rate(figures.taxBps) })} value={minus(split.tax)} />}
        <Row label={webText("guide_split_net")} value={money(split.net)} />
        <Row label={webText("guide_split_cashback", { rate: rate(figures.shareBps) })} value={money(split.cashback)} strong />
      </dl>
    </div>
  );
}

function CapExample({ figures }: { readonly figures: GuideFigures }) {
  const cap = figures.capExample;
  return (
    <div data-cap-example className="flex flex-col gap-1 rounded-lg bg-card px-3 py-2.5 text-[15px]">
      <p>{webText("guide_split_cap", { cap: money(figures.shopeeCap) })}</p>
      <p className="text-muted-foreground">
        {webText("guide_cap_example", { price: money(cap.price), shopeeRate: rate(cap.shopeeRateBps), shopeePart: money(cap.shopeePart), xtraRate: rate(cap.xtraRateBps), xtraPart: money(cap.xtraPart), commission: money(cap.commission) })}
      </p>
    </div>
  );
}

export function MoneyExample() {
  const figures = useGuideFigures();
  if (figures.isPending) return <Skeleton aria-label={webText("loading")} className="h-64 w-full rounded-lg" />;
  if (figures.data === undefined) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-[15px]">{webText("guide_split_error")}</p>
        <Button type="button" variant="outline" className="h-11 px-4 text-[15px]" disabled={figures.isFetching} onClick={() => void figures.refetch()}>
          <RefreshCwIcon aria-hidden />
          {webText("retry")}
        </Button>
      </div>
    );
  }
  const f = figures.data;
  const summary = webText("guide_share_body", { share: rate(f.shareBps), commission: money(f.example.commission), cashback: money(f.example.notWithheld.cashback), tax: rate(f.taxBps), cashbackWithheld: money(f.example.withheld.cashback) });
  return (
    <div className="flex flex-col gap-3" data-money-example>
      <p className="text-[15px]">{summary}</p>
      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-[15px] font-semibold text-primary">{webText("guide_split_show")}</summary>
        <div className="flex flex-col gap-3 pt-2">
          <p className="text-[15px]">{webText("guide_split_lead", { price: money(f.example.price), rate: rate(f.example.shopeeRateBps), commission: money(f.example.commission) })}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Column figures={f} withheld={false} />
            <Column figures={f} withheld />
          </div>
          <p className="text-[15px] text-muted-foreground">{webText("guide_split_operator")}</p>
          <CapExample figures={f} />
        </div>
      </details>
    </div>
  );
}
