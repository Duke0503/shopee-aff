/**
 * Customers (W5, FR-26, FR-37, Story 4.14): every customer through DataList with its state in the
 * URL. One value per column: the customer code (a code chip) and the name apart, the bank apart from
 * the last four digits, the order count, what waits to be sent and what was sent (both the server's
 * `getBalances` figures, the same as the customer page and Payouts), and the flags of the shared
 * payout rules. The quick chips `customers_chip_owed` and `customers_chip_flagged` count the filtered
 * set; the "all" chip carries the overall total named as such. The bank select uses the same rules. The name
 * opens the customer's page; on phone the whole card does. Tablet drops the code, bank and paid
 * columns behind the columns menu (`list_columns`).
 */
import type { AdminCustomerRow, ListSearchState } from "@cashback/contracts";
import {
  cn,
  CodeChip,
  DataList,
  FacetChips,
  formatCount,
  MoneyFigure,
  OptionFilter,
  type ListColumn,
} from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { adminText } from "../labels";
import { FlagBadges, flagsOf, MaskedAccount } from "../payouts/payout-badges";
import { PageHeader } from "../shell/page-header";
import { CUSTOMERS_SEARCH, useCustomersList } from "./customers.queries";

export const customerKeyOf = (row: {
  readonly customerCode: string | null;
  readonly customerId: string;
}): string => row.customerCode ?? row.customerId;
const nameOf = (row: AdminCustomerRow): string => row.customerName ?? adminText("customer_unnamed");

function NameLink({
  row,
  wrap = false,
}: {
  readonly row: AdminCustomerRow;
  readonly wrap?: boolean;
}) {
  return (
    <Link
      to="/customers/$customerKey"
      params={{ customerKey: customerKeyOf(row) }}
      aria-label={adminText("customer_open_aria", { name: nameOf(row) })}
      className={cn(
        "block min-w-0 font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        wrap ? "break-words" : "truncate",
      )}
      title={nameOf(row)}
    >
      {nameOf(row)}
    </Link>
  );
}

export const CUSTOMER_COLUMNS: readonly ListColumn<AdminCustomerRow>[] = [
  {
    key: "customerCode",
    header: adminText("col_customer_code"),
    kind: "code",
    sortable: true,
    desktopOnly: true,
  },
  {
    key: "customerName",
    header: adminText("col_customer_name"),
    kind: "name",
    sortable: true,
    render: (row) => <NameLink row={row} />,
  },
  {
    key: "bankName",
    header: adminText("col_bank"),
    kind: "text",
    sortable: true,
    desktopOnly: true,
    width: 128,
  },
  {
    key: "accountLastFour",
    header: adminText("col_account"),
    kind: "text",
    width: 92,
    render: (row) => <MaskedAccount lastFour={row.accountLastFour} />,
  },
  {
    key: "orderCount",
    header: adminText("col_order_count"),
    kind: "integer",
    sortable: true,
    width: 84,
  },
  { key: "payable", header: adminText("col_customer_payable"), kind: "money", sortable: true },
  {
    key: "paid",
    header: adminText("col_customer_paid"),
    kind: "money",
    sortable: true,
    desktopOnly: true,
  },
  {
    key: "flags",
    header: adminText("col_flags"),
    kind: "text",
    width: 136,
    render: (row) => <FlagBadges flags={flagsOf(row.flags)} changedAt={row.bankChangedAt} />,
  },
];

/** The phone card: name and what waits first, then the code chip and orders, then the account and flags. */
function CustomerCard({ row }: { readonly row: AdminCustomerRow }) {
  const flags = flagsOf(row.flags);
  return (
    <article
      data-card="customer"
      className="relative flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0 text-[15px] leading-snug font-semibold break-words">
          <NameLink row={row} wrap />
        </span>
        <span className="shrink-0 text-right">
          <span className="sr-only">{adminText("col_customer_payable")} </span>
          <MoneyFigure amount={row.payable} size="md" />
          <span className="block text-caption text-muted-foreground">
            {adminText("customers_summary_payable")}
          </span>
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        {row.customerCode !== null && <CodeChip code={row.customerCode} className="shrink-0" />}
        <span className="tabular-nums">
          {adminText("payout_order_count", { count: formatCount(row.orderCount) })}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-meta text-muted-foreground">
        {row.bankName !== null && <span className="min-w-0 truncate">{row.bankName}</span>}
        {row.accountLastFour !== null && <MaskedAccount lastFour={row.accountLastFour} />}
        {flags.length > 0 && <FlagBadges flags={flags} changedAt={row.bankChangedAt} />}
      </div>
    </article>
  );
}

const BANK_OPTIONS = [
  { value: "SAVED", label: adminText("bank_state_saved") },
  { value: "HELD", label: adminText("bank_state_held") },
  { value: "NONE", label: adminText("bank_state_none") },
];

const CHIPS = [
  { field: "owed", value: "YES", label: adminText("customers_chip_owed") },
  { field: "flagged", value: "YES", label: adminText("customers_chip_flagged") },
];

export interface CustomersPageProps {
  readonly state: ListSearchState;
  readonly onStateChange: (next: ListSearchState, options?: { readonly replace?: boolean }) => void;
}

export function CustomersPage({ state, onStateChange }: CustomersPageProps) {
  const query = useCustomersList(state);
  return (
    <>
      <PageHeader title={adminText("nav_customers")} lead={adminText("customers_lead")} />
      <DataList
        search={CUSTOMERS_SEARCH}
        state={state}
        onStateChange={onStateChange}
        query={query}
        columns={CUSTOMER_COLUMNS}
        rowKey={(row) => row.customerId}
        searchPlaceholder={adminText("customers_search")}
        countLabel={(count) => adminText("customers_count", { count: formatCount(count) })}
        emptyText={adminText("customers_empty")}
        summary={[
          { key: "payable", label: adminText("customers_summary_payable") },
          { key: "paid", label: adminText("customers_summary_paid") },
        ]}
        card={(row) => <CustomerCard row={row} />}
        filters={(api) => (
          <>
            <OptionFilter
              api={api}
              field="bank"
              label={adminText("customers_bank")}
              allLabel={adminText("customers_bank_all")}
              options={BANK_OPTIONS}
            />
            <FacetChips api={api} choices={CHIPS} label={adminText("customers_chips")} />
          </>
        )}
      />
    </>
  );
}
