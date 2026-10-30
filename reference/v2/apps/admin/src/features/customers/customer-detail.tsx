import { useState, type ReactElement } from "react";

import type { ApiUserDetail } from "@mmo/contracts";
import { Button, colors, spacing } from "@mmo/ui";

import { shortDate, shortDateTime } from "../../shared/lib/dates";
import { label, useLabels, type Labels } from "../../shared/lib/labels";
import { vnd } from "../../shared/lib/money";
import { roleText } from "../../shared/lib/status";
import { LinksTable, OrdersTable, TransfersTable } from "./customer-history";
import { useCustomerDetail } from "./customers.queries";
import { RecordTransfer } from "./record-transfer";

function Stat({ name, value }: { name: string; value: string }): ReactElement {
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        minWidth: 116,
        padding: spacing.sm,
      }}
    >
      <div style={{ color: colors.muted, fontSize: 11 }}>{name}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}


function Money({ detail, labels }: { detail: ApiUserDetail; labels: Labels }): ReactElement {
  const { stats } = detail;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
      <Stat name={label(labels, "admin_stat_total")} value={vnd(stats.totalCashbackVnd, labels)} />
      <Stat name={label(labels, "admin_stat_ready")} value={vnd(stats.readyVnd, labels)} />
      <Stat name={label(labels, "admin_stat_awaiting")} value={vnd(stats.awaitingVnd, labels)} />
      <Stat name={label(labels, "admin_stat_paid")} value={vnd(stats.paidVnd, labels)} />
      <Stat
        name={label(labels, "admin_stat_transferred")}
        value={vnd(stats.totalTransferredVnd, labels)}
      />
      <Stat name={label(labels, "admin_stat_keep")} value={vnd(stats.totalAdminProfitVnd, labels)} />
      <Stat name={label(labels, "admin_stat_orders")} value={String(stats.totalOrders)} />
      <Stat name={label(labels, "admin_stat_requests")} value={String(stats.totalRequests)} />
    </div>
  );
}

function Profile({ detail, labels }: { detail: ApiUserDetail; labels: Labels }): ReactElement {
  const { user } = detail;
  const bank = user.bankAccount
    ? `${user.bankName ?? ""} ${user.bankAccount}`.trim()
    : label(labels, "profile_bank_not_set");
  return (
    <p style={{ color: colors.muted, margin: `${spacing.xs}px 0 0` }}>
      {label(labels, "admin_col_bank")}: {bank} · {label(labels, "admin_detail_holder")}:{" "}
      {user.accountHolder ?? label(labels, "nothing_known")} ·{" "}
      {label(labels, "admin_detail_joined")}: {shortDate(user.createdAt) || "-"} ·{" "}
      {label(labels, "admin_detail_last_login")}: {shortDate(user.lastLoginAt) || "-"} ·{" "}
      {label(labels, "admin_detail_last_activity")}: {shortDateTime(user.lastBotActivity) || "-"}
    </p>
  );
}

export interface CustomerDetailProps {
  customerId: string;
  canRecordTransfer: boolean;
  onClose: () => void;
}

/** Everything below the header: who they are, what they are owed, their history. */
function Body({
  detail,
  customerId,
  canRecordTransfer,
  onRecorded,
  labels,
}: {
  detail: ApiUserDetail;
  customerId: string;
  canRecordTransfer: boolean;
  onRecorded: () => void;
  labels: Labels;
}): ReactElement {
  const [tab, setTab] = useState<"orders" | "links" | "transfers">("orders");
  const name = detail.user.displayName ?? detail.user.customerCode ?? customerId;
  const payableCount = detail.orders.filter(
    (order) => order.status === "approved" && order.paidAt === null,
  ).length;

  return (
    <>
      <Profile detail={detail} labels={labels} />
      <Money detail={detail} labels={labels} />
      <nav style={{ display: "flex", gap: spacing.sm, marginTop: spacing.lg }}>
        {TABS.map(([key, nameKey]) => (
          <Button key={key} disabled={key === tab} onClick={() => setTab(key)}>
            {label(labels, nameKey)}
          </Button>
        ))}
      </nav>
      <div style={{ marginTop: spacing.sm }}>
        {tab === "orders" ? <OrdersTable labels={labels} orders={detail.orders} /> : null}
        {tab === "links" ? <LinksTable labels={labels} requests={detail.linkRequests} /> : null}
        {tab === "transfers" ? (
          <TransfersTable labels={labels} transfers={detail.transfers} />
        ) : null}
      </div>
      <RecordTransfer
        canRecord={canRecordTransfer}
        customerCode={detail.user.customerCode}
        customerId={customerId}
        name={name}
        onRecorded={onRecorded}
        payableCount={payableCount}
        readyVnd={detail.stats.readyVnd}
      />
    </>
  );
}

/** One customer's page: who they are, what they are owed, and their history. */
export function CustomerDetail({
  customerId,
  canRecordTransfer,
  onClose,
}: CustomerDetailProps): ReactElement {
  const labels = useLabels();
  const [reloadKey, setReloadKey] = useState(0);
  const { detail, error } = useCustomerDetail(customerId, reloadKey);
  const name = detail?.user.displayName ?? detail?.user.customerCode ?? customerId;

  return (
    <section
      style={{
        border: `2px solid ${colors.brandSoft}`,
        borderRadius: 8,
        marginTop: spacing.lg,
        padding: spacing.md,
      }}
    >
      <header style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>
          {label(labels, "admin_detail_title", { name })}{" "}
          {detail ? <span>{roleText(labels, detail.user.role)}</span> : null}
        </h2>
        <Button onClick={onClose}>{label(labels, "btn_close")}</Button>
      </header>
      {error !== "" ? (
        <p style={{ color: colors.brand }}>{label(labels, "load_failed", { reason: error })}</p>
      ) : null}
      {detail === null && error === "" ? (
        <p style={{ color: colors.muted }}>{label(labels, "loading")}</p>
      ) : null}
      {detail === null ? null : (
        <Body
          canRecordTransfer={canRecordTransfer}
          customerId={customerId}
          detail={detail}
          labels={labels}
          onRecorded={() => setReloadKey((value) => value + 1)}
        />
      )}
    </section>
  );
}

const TABS = [
  ["orders", "admin_tab_orders"],
  ["links", "admin_tab_links"],
  ["transfers", "admin_tab_transfers"],
] as const;
