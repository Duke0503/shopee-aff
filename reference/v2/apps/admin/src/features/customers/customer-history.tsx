import type { ReactElement } from "react";

import type { ApiUserOrder, ApiUserRequest, ApiUserTransfer } from "@mmo/contracts";
import { colors } from "@mmo/ui";

import { shortDate, shortDateTime } from "../../shared/lib/dates";
import { label, type Labels } from "../../shared/lib/labels";
import { vnd, vndOrDash } from "../../shared/lib/money";
import { statusText } from "../../shared/lib/status";
import { OrderMoney } from "../../shared/ui/order-money";

const table = { borderCollapse: "collapse", width: "100%" } as const;
const cell = { borderBottom: `1px solid ${colors.border}`, fontSize: 12, padding: "4px 8px" } as const;

/** Everything the customer ever asked for a link on, and what it earned. */
export function OrdersTable({
  orders,
  labels,
}: {
  orders: ApiUserOrder[];
  labels: Labels;
}): ReactElement {
  if (orders.length === 0) {
    return <p style={{ color: colors.muted }}>{label(labels, "admin_orders_empty")}</p>;
  }
  return (
    <table style={table}>
      <thead>
        <tr>
          <th style={cell}>{label(labels, "col_order")}</th>
          <th style={cell}>{label(labels, "col_status")}</th>
          <th style={cell}>{label(labels, "col_product")}</th>
          <th style={cell}>{label(labels, "col_value")}</th>
          <th style={cell}>{label(labels, "col_cashback")}</th>
          <th style={cell}>{label(labels, "col_date")}</th>
          <th style={cell}>{label(labels, "admin_money_commission")}</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.orderId}>
            <td style={cell}>{order.orderId}</td>
            <td style={cell}>{statusText(labels, order.status)}</td>
            <td style={cell}>
              {order.sourceUrl ? (
                <a href={order.sourceUrl} rel="noreferrer" target="_blank">
                  {order.productName || order.sourceUrl}
                </a>
              ) : (
                order.productName || label(labels, "nothing_known")
              )}
            </td>
            <td style={cell}>{vndOrDash(order.orderValueVnd, labels)}</td>
            <td style={cell}>{vnd(order.cashbackVnd, labels)}</td>
            <td style={cell}>{shortDate(order.recordedAt)}</td>
            <td style={cell}>
              <OrderMoney breakdown={order.breakdown} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The links the customer asked for, with the estimate they were shown. */
export function LinksTable({
  requests,
  labels,
}: {
  requests: ApiUserRequest[];
  labels: Labels;
}): ReactElement {
  if (requests.length === 0) {
    return <p style={{ color: colors.muted }}>{label(labels, "admin_links_empty")}</p>;
  }
  return (
    <table style={table}>
      <thead>
        <tr>
          <th style={cell}>{label(labels, "col_date")}</th>
          <th style={cell}>{label(labels, "col_product")}</th>
          <th style={cell}>{label(labels, "col_link")}</th>
          <th style={cell}>{label(labels, "col_status")}</th>
          <th style={cell}>{label(labels, "estimate_note")}</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((request) => (
          <tr key={request.requestId}>
            <td style={cell}>{shortDateTime(request.createdAt)}</td>
            <td style={cell}>
              <a href={request.sourceUrl} rel="noreferrer" target="_blank">
                {request.productName || request.sourceUrl}
              </a>
            </td>
            <td style={cell}>
              {request.affiliateUrl ? (
                <a href={request.affiliateUrl} rel="noreferrer" target="_blank">
                  {label(labels, "admin_transfer_view")}
                </a>
              ) : (
                label(labels, "admin_transfer_missing")
              )}
            </td>
            <td style={cell}>{request.status}</td>
            <td style={cell}>{vndOrDash(request.estimatedCommissionVnd, labels)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Every transfer we have recorded for the customer, with its bill and proof. */
export function TransfersTable({
  transfers,
  labels,
}: {
  transfers: ApiUserTransfer[];
  labels: Labels;
}): ReactElement {
  if (transfers.length === 0) {
    return <p style={{ color: colors.muted }}>{label(labels, "admin_transfers_empty")}</p>;
  }
  return (
    <table style={table}>
      <thead>
        <tr>
          <th style={cell}>{label(labels, "col_date")}</th>
          <th style={cell}>{label(labels, "admin_transfer_amount")}</th>
          <th style={cell}>{label(labels, "admin_transfer_note")}</th>
          <th style={cell}>{label(labels, "admin_transfer_code")}</th>
          <th style={cell}>{label(labels, "admin_col_orders")}</th>
          <th style={cell}>{label(labels, "admin_transfer_bill")}</th>
          <th style={cell}>{label(labels, "admin_transfer_proof")}</th>
        </tr>
      </thead>
      <tbody>
        {transfers.map((transfer) => (
          <tr key={transfer.id}>
            <td style={cell}>{shortDateTime(transfer.createdAt)}</td>
            <td style={cell}>{vnd(transfer.amountVnd, labels)}</td>
            <td style={cell}>{transfer.note ?? label(labels, "nothing_known")}</td>
            <td style={cell}>{transfer.transferCode ?? label(labels, "nothing_known")}</td>
            <td style={cell}>{label(labels, "label_orders", { count: transfer.orderIds.length })}</td>
            <td style={cell}>
              {transfer.billPath ? (
                <a href={transfer.billPath} rel="noreferrer" target="_blank">
                  {label(labels, "admin_transfer_view")}
                </a>
              ) : (
                label(labels, "admin_transfer_missing")
              )}
            </td>
            <td style={cell}>
              {transfer.proofPath ? (
                <a href={transfer.proofPath} rel="noreferrer" target="_blank">
                  {label(labels, "admin_transfer_view")}
                </a>
              ) : (
                label(labels, "admin_transfer_missing")
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
