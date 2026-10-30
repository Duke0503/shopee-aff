/**
 * The order shape every route returns. Kept in one place so the customer's own
 * route and the assistant's route can never drift apart.
 */
export interface OrderResponse {
  orderId: string;
  status: string;
  orderValueVnd: number | null;
  cashbackVnd: number | null;
  recordedAt: string | null;
  paidAt: string | null;
}

interface OrderRow {
  orderId: string;
  status: string;
  orderValue: number | null;
  cashbackAmount: number | null;
  recordedAt: string | null;
  paidAt: string | null;
}

export function toOrderResponse(row: OrderRow): OrderResponse {
  return {
    orderId: row.orderId,
    status: row.status,
    orderValueVnd: row.orderValue,
    cashbackVnd: row.cashbackAmount,
    recordedAt: row.recordedAt,
    paidAt: row.paidAt,
  };
}
