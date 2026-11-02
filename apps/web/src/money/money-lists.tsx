/**
 * The lower half of My money (Story 7.4, W2): the customer's order lines or payouts, each a
 * DataList in its card form on its own list endpoint, or the clawed-back orders the deduction line
 * opens. Two headings (pen.dev ktmGZ), the current one in the text colour, switch between orders and payouts; the view and each list's state live in
 * the URL. Search, the status chips with their counts, the one sort (newest or oldest first) and
 * the pages all go to the server (LC-1); loading, empty, no matches and error are their own states
 * (LC-9): an error never reads as "no orders".
 */
import { CUSTOMER_PATHS, type ListSearchState, type MyMoney, type MyOrderRow, type MyPayoutRow } from "@cashback/contracts";
import { buttonVariants, cn, CodeChip, DataList, formatCount, formatMoney, ProductThumb, type ChangeOptions, type ListColumn } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { webText } from "../labels";
import { FOCUS_RING } from "../shell/nav-items";
import { moneyLink, MY_ORDERS_SEARCH, MY_PAYOUTS_SEARCH, type MoneyView } from "./money-search";
import { useMyOrders, useMyPayouts } from "./money.queries";
import { OrderCard } from "./order-card";
import { PayableBreakdown } from "./payable-breakdown";
import { PayoutCard } from "./payout-card";

type OnState = (next: ListSearchState, options?: ChangeOptions) => void;

const ORDER_COLUMNS: readonly ListColumn<MyOrderRow>[] = [{ key: "recordedAt", header: webText("sort_recorded"), kind: "instant", sortable: true }];
const PAYOUT_COLUMNS: readonly ListColumn<MyPayoutRow>[] = [{ key: "recordedAt", header: webText("view_payouts"), kind: "instant" }];

/** The card's payable figure opens exactly the approved lines: then the breakdown above them says how they make the figure. */
const isPayableView = (state: ListSearchState): boolean => state.q.trim() === "" && Object.keys(state.filters).length === 1 && state.filters["status"]?.join() === "APPROVED";

function OrdersList({ state, onState, money }: { readonly state: ListSearchState; readonly onState: OnState; readonly money: MyMoney | undefined }) {
  const query = useMyOrders(state);
  return (
    <>
      {money !== undefined && isPayableView(state) && <PayableBreakdown balance={money.balance} />}
      <DataList
      form="cards"
      search={MY_ORDERS_SEARCH}
      state={state}
      onStateChange={onState}
      query={query}
      columns={ORDER_COLUMNS}
      rowKey={(row) => row.lineId}
      searchPlaceholder={webText("orders_search")}
      countLabel={(count) => webText("orders_count", { count: formatCount(count) })}
      emptyText={webText("orders_empty")}
      emptyAction={
        <Link to={CUSTOMER_PATHS.home} className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4 text-[15px]")}>
          {webText("orders_empty_home")}
        </Link>
      }
      statusFilter={{ field: "status", entity: "order" }}
      sortLabel={(_, direction) => webText(direction === "desc" ? "sort_newest" : "sort_oldest")}
      card={(row) => <OrderCard row={row} />}
      />
    </>
  );
}

function PayoutsList({ state, onState }: { readonly state: ListSearchState; readonly onState: OnState }) {
  const query = useMyPayouts(state);
  return (
    <DataList
      form="cards"
      searchable={false}
      search={MY_PAYOUTS_SEARCH}
      state={state}
      onStateChange={onState}
      query={query}
      columns={PAYOUT_COLUMNS}
      rowKey={(row) => String(row.payoutId)}
      searchPlaceholder=""
      countLabel={(count) => webText("payouts_count", { count: formatCount(count) })}
      emptyText={webText("payouts_empty")}
      summary={[{ key: "paidAmount", label: webText("payouts_paid_summary") }]}
      card={(row) => <PayoutCard row={row} />}
    />
  );
}

function Deductions({ money }: { readonly money: MyMoney | undefined }) {
  return (
    <section data-deductions className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 className="text-lg font-semibold">{webText("deducted_title")}</h2>
        <Link to={CUSTOMER_PATHS.myMoney} search={moneyLink("orders")} className={cn("inline-flex h-11 items-center text-[15px] font-medium text-primary", FOCUS_RING)}>
          {webText("deducted_back")}
        </Link>
      </div>
      <p className="text-[15px] text-muted-foreground">{webText("deducted_lead")}</p>
      <ul className="flex flex-col gap-2">
        {(money?.deductions ?? []).map((d) => (
          <li key={d.deductionId} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <ProductThumb src={d.productImageUrl} size={40} />
              <p className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug font-medium break-words">{d.orderId === null ? webText("deduction_no_order") : (d.productName ?? webText("order_product_missing"))}</p>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3">
              {/* A clawback with no order (an imported one) has no order code to copy. */}
              {d.orderId === null ? <span /> : <CodeChip code={d.orderId} className="shrink-0" />}
              <span className="font-semibold whitespace-nowrap text-status-attention tabular-nums">{webText("deducted_amount", { amount: formatMoney(d.amount) ?? "" })}</span>
            </div>
          </li>
        ))}
      </ul>
      {money !== undefined && money.balance.owedAfter > 0 && <p className="text-meta text-muted-foreground">{webText("money_owed_after", { amount: formatMoney(money.balance.owedAfter) ?? "" })}</p>}
    </section>
  );
}

const TAB = cn("inline-flex h-11 items-center rounded-md text-lg font-semibold md:text-xl", FOCUS_RING);

function ViewTabs({ view }: { readonly view: MoneyView }) {
  const tabs: readonly [MoneyView, "view_orders" | "view_payouts"][] = [
    ["orders", "view_orders"],
    ["payouts", "view_payouts"],
  ];
  return (
    <nav aria-label={webText("lists_label")} className="flex items-center gap-5">
      {tabs.map(([target, label]) => (
        <Link key={target} to={CUSTOMER_PATHS.myMoney} search={moneyLink(target)} aria-current={view === target ? "page" : undefined} className={cn(TAB, view === target ? "text-foreground" : "font-medium text-muted-foreground hover:text-foreground")}>
          {webText(label)}
        </Link>
      ))}
    </nav>
  );
}

export interface MoneyListsProps {
  readonly view: MoneyView;
  readonly search: Record<string, string>;
  readonly money: MyMoney | undefined;
  readonly onSearch: (next: Record<string, string>, options?: ChangeOptions) => void;
}

export function MoneyLists({ view, search, money, onSearch }: MoneyListsProps) {
  if (view === "deducted") return <Deductions money={money} />;
  return (
    <section aria-label={webText("lists_label")} className="flex min-w-0 flex-col gap-3">
      <ViewTabs view={view} />
      {view === "payouts" ? (
        <PayoutsList state={MY_PAYOUTS_SEARCH.parse(search)} onState={(next, options) => onSearch(moneyLink("payouts", next), options)} />
      ) : (
        <OrdersList money={money} state={MY_ORDERS_SEARCH.parse(search)} onState={(next, options) => onSearch(moneyLink("orders", next), options)} />
      )}
    </section>
  );
}
