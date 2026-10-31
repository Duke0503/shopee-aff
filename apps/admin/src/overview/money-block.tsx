/**
 * Block 3, where the money is (dashboard-spec Block 3): four point-in-time figures (what the
 * networks still owe, what is owed to customers, what customers owe back, what waits for approval
 * as an estimate) in one even row, then the cash that really moved in the period, and the warning
 * when payouts run ahead of what the networks paid over the last 60 days.
 */
import type { Overview } from "@cashback/contracts";
import { formatCount, formatMoney, MoneyFigure } from "@cashback/ui";

import { adminText } from "../labels";
import { Block, Card, MoneyCard } from "./overview-parts";

type Money = Overview["money"];

function NowFigure({ label, amount, definition, estimate = false, name, extra }: { readonly label: string; readonly amount: number; readonly definition: string; readonly estimate?: boolean; readonly name: string; readonly extra?: string }) {
  return (
    <Card>
      <p data-now={name} className="text-sm font-medium text-muted-foreground">{label}</p>
      <MoneyFigure amount={amount} size="md" estimate={estimate} />
      {extra !== undefined && <p data-processing className="text-sm break-words">{extra}</p>}
      <p className="mt-auto text-meta text-muted-foreground">{definition}</p>
    </Card>
  );
}

function Cash({ cash }: { readonly cash: Money["cash"] }) {
  const received = cash.networkBatches === 0 ? adminText("ov_cash_received_none") : adminText("ov_cash_received_def", { count: formatCount(cash.networkBatches), gross: formatMoney(cash.networkGross.value ?? 0) ?? "", fee: formatMoney(cash.networkFee) ?? "", tax: formatMoney(cash.networkTax) ?? "" });
  return (
    <Block title={adminText("ov_cash_title")} basis={adminText("ov_cash_basis")}>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        <MoneyCard label={adminText("ov_cash_received")} figure={cash.received} definition={received} />
        <MoneyCard label={adminText("ov_cash_paid")} figure={cash.paidOut} definition={adminText("ov_cash_paid_def", { count: formatCount(cash.payouts) })} />
        <MoneyCard label={adminText("ov_cash_difference")} figure={cash.difference} definition={adminText("ov_cash_difference_def")} />
      </div>
    </Block>
  );
}

export function MoneyBlock({ money }: { readonly money: Money }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Block title={adminText("ov_money_title")} basis={adminText("ov_now_basis")}>
        {money.advanceWarning && (
          <p role="alert" className="rounded-md bg-status-attention-soft p-3 text-sm break-words text-status-attention">
            {adminText("ov_advance_warning", { received: formatMoney(money.last60Days.received) ?? "", paid: formatMoney(money.last60Days.paidOut) ?? "" })}
          </p>
        )}
        <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
          <NowFigure
            name="networks-owe"
            label={adminText("ov_networks_owe")}
            amount={money.networksOwe}
            definition={adminText("ov_networks_owe_def")}
            {...(money.processing.batches === 0 ? {} : { extra: adminText("ov_processing", { received: formatMoney(money.processing.received) ?? "", gross: formatMoney(money.processing.gross) ?? "", count: formatCount(money.processing.batches) }) })}
          />
          <NowFigure name="we-owe" label={adminText("ov_we_owe")} amount={money.weOweCustomers} definition={adminText("ov_we_owe_def")} />
          <NowFigure name="customers-owe" label={adminText("ov_customers_owe")} amount={money.customersOweUs} definition={adminText("ov_customers_owe_def")} />
          <NowFigure name="awaiting" label={adminText("ov_awaiting")} amount={money.awaiting.commission} estimate definition={adminText("ov_awaiting_def", { count: formatCount(money.awaiting.orders), cashback: formatMoney(money.awaiting.cashback) ?? "" })} />
        </div>
      </Block>
      <Cash cash={money.cash} />
    </div>
  );
}
