import { useState, type ReactElement } from "react";

import type { ApiPagination, ApiUserRow } from "@mmo/contracts";
import { Button, colors, spacing } from "@mmo/ui";

import { CustomerDetail } from "./features/customers/customer-detail";
import { useCustomers, type CustomersFilter } from "./features/customers/customers.queries";
import { shortDateTime } from "./shared/lib/dates";
import { label, useLabels, type Labels } from "./shared/lib/labels";
import { vnd } from "./shared/lib/money";

const BANK_FILTERS: ReadonlyArray<
  [CustomersFilter["bank"], "admin_filter_all" | "admin_filter_bank_has" | "admin_filter_bank_none"]
> = [
  ["all", "admin_filter_all"],
  ["has_bank", "admin_filter_bank_has"],
  ["no_bank", "admin_filter_bank_none"],
];

const cell = { borderBottom: `1px solid ${colors.border}`, fontSize: 12, padding: "4px 8px" } as const;

function bankOf(user: ApiUserRow, labels: Labels): string {
  if (!user.bankAccount) return label(labels, "admin_filter_bank_none");
  return [user.bankName, user.bankAccount].filter(Boolean).join(" ");
}

function Row({
  user,
  onOpen,
  labels,
}: {
  user: ApiUserRow;
  onOpen: () => void;
  labels: Labels;
}): ReactElement {
  return (
    <tr>
      <td style={cell}>{user.customerCode ?? label(labels, "nothing_known")}</td>
      <td style={cell}>
        <Button onClick={onOpen}>{user.displayName ?? user.customerId}</Button>
      </td>
      <td style={cell}>{bankOf(user, labels)}</td>
      <td style={cell}>{user.orderCount}</td>
      <td style={cell}>{vnd(user.readyAmount, labels)}</td>
      <td style={cell}>{vnd(user.awaitingAmount, labels)}</td>
      <td style={cell}>{vnd(user.paidAmount, labels)}</td>
      <td style={cell}>{vnd(user.totalCashback, labels)}</td>
      <td style={cell}>{shortDateTime(user.lastBotActivity) || label(labels, "nothing_known")}</td>
    </tr>
  );
}

function Table({
  users,
  onOpen,
  labels,
}: {
  users: ApiUserRow[];
  onOpen: (customerId: string) => void;
  labels: Labels;
}): ReactElement {
  if (users.length === 0) {
    return <p style={{ color: colors.muted }}>{label(labels, "admin_users_empty")}</p>;
  }
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr>
          <th style={cell}>{label(labels, "admin_col_code")}</th>
          <th style={cell}>{label(labels, "col_customer")}</th>
          <th style={cell}>{label(labels, "admin_col_bank")}</th>
          <th style={cell}>{label(labels, "admin_col_orders")}</th>
          <th style={cell}>{label(labels, "admin_col_ready")}</th>
          <th style={cell}>{label(labels, "admin_col_awaiting")}</th>
          <th style={cell}>{label(labels, "admin_col_paid")}</th>
          <th style={cell}>{label(labels, "admin_col_total_cashback")}</th>
          <th style={cell}>{label(labels, "admin_col_last_activity")}</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <Row
            key={user.customerId}
            labels={labels}
            onOpen={() => onOpen(user.customerId)}
            user={user}
          />
        ))}
      </tbody>
    </table>
  );
}

function Pager({
  page,
  pagination,
  onPage,
  labels,
}: {
  page: number;
  pagination: ApiPagination | null;
  onPage: (page: number) => void;
  labels: Labels;
}): ReactElement {
  const totalPages = pagination?.total_pages ?? 1;
  return (
    <nav style={{ alignItems: "center", display: "flex", gap: spacing.sm, marginTop: spacing.md }}>
      <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {label(labels, "admin_page_prev")}
      </Button>
      <span style={{ color: colors.muted }}>
        {label(labels, "admin_page_of", { page, total: totalPages })} ·{" "}
        {label(labels, "admin_users_total", { count: pagination?.total ?? 0 })}
      </span>
      <Button disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        {label(labels, "admin_page_next")}
      </Button>
    </nav>
  );
}

function Filters({
  draft,
  bank,
  onDraft,
  onBank,
  onSearch,
  labels,
}: {
  draft: string;
  bank: CustomersFilter["bank"];
  onDraft: (value: string) => void;
  onBank: (value: CustomersFilter["bank"]) => void;
  onSearch: () => void;
  labels: Labels;
}): ReactElement {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
      style={{ alignItems: "flex-end", display: "flex", flexWrap: "wrap", gap: spacing.sm }}
    >
      <label style={{ display: "block" }}>
        {label(labels, "admin_search_customers")}
        <input value={draft} onChange={(event) => onDraft(event.target.value)} />
      </label>
      <label style={{ display: "block" }}>
        {label(labels, "admin_filter_bank")}
        <select value={bank} onChange={(event) => onBank(event.target.value as typeof bank)}>
          {BANK_FILTERS.map(([value, nameKey]) => (
            <option key={value} value={value}>
              {label(labels, nameKey)}
            </option>
          ))}
        </select>
      </label>
      <Button onClick={onSearch}>{label(labels, "refresh")}</Button>
    </form>
  );
}

/** Admin customer list: search, filter by bank details, and open one customer. */
export function CustomersPage({
  canRecordTransfer,
}: {
  canRecordTransfer: boolean;
}): ReactElement {
  const labels = useLabels();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [bank, setBank] = useState<CustomersFilter["bank"]>("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const { users, pagination, error } = useCustomers({ search, bank, page });

  return (
    <main style={{ color: colors.text, padding: spacing.lg }}>
      <h1>{label(labels, "admin_nav_customers")}</h1>
      <Filters
        bank={bank}
        draft={draft}
        labels={labels}
        onBank={(value) => {
          setBank(value);
          setPage(1);
        }}
        onDraft={setDraft}
        onSearch={() => {
          setSearch(draft);
          setPage(1);
        }}
      />
      {error !== "" ? (
        <p style={{ color: colors.brand }}>{label(labels, "load_failed", { reason: error })}</p>
      ) : (
        <>
          <Table labels={labels} onOpen={setOpen} users={users} />
          <Pager labels={labels} onPage={setPage} page={page} pagination={pagination} />
        </>
      )}
      {open === null ? null : (
        <CustomerDetail
          canRecordTransfer={canRecordTransfer}
          customerId={open}
          key={open}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  );
}
