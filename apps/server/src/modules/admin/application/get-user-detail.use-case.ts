import type { Balance } from "@mmo/money";
import { desc, eq, inArray, or, sql } from "drizzle-orm";

import { estimateProductName } from "../../affiliate";
import { computeBalanceFor, decodeOrderIds, listTransfersForCustomer } from "../../ledger";
import { listOrders } from "../../orders";
import { cashbackRate } from "../../../shared/config/cashback-rate";
import { periodIsWithheld } from "../../../shared/config/period-is-withheld";
import type { Db } from "../../../shared/database/connection";
import { activityLogs, customers, linkRequests } from "../../../shared/database/schema";
import {
  orderBreakdown,
  type BreakdownStatus,
  type OrderBreakdown,
} from "../domain/order-breakdown";

/**
 * One customer's page: who they are, what they bought, what we sent them and
 * what it all comes to. Ports `_admin_user_detail`, read-only.
 *
 * The three balance numbers come from the SAME function the customer's own page
 * uses (`computeBalanceFor`), so staff and customer can never be shown different
 * figures. The per-order breakdown is explained by `orderBreakdown`.
 */
const RECENT_REQUESTS = 100;

export interface UserDetailUser {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  zaloUserId: string | null;
  privateChatId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  consentAt: string | null;
  status: string;
  role: string;
  createdAt: string;
  lastLoginAt: string | null;
  loginCount: number;
  lastBotActivity: string | null;
}

export interface UserDetailOrder {
  orderId: string;
  status: string;
  platform: string;
  settlementStatus: string;
  orderValueVnd: number | null;
  estimatedCommissionVnd: number | null;
  approvedCommissionVnd: number | null;
  /** The saved cashback, or — before approval — the estimate the customer sees. */
  cashbackVnd: number;
  rejectionReason: string | null;
  recordedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  productName: string;
  sourceUrl: string | null;
  breakdown: OrderBreakdown;
}

export interface UserDetailRequest {
  requestId: string;
  createdAt: string;
  sourceUrl: string;
  affiliateUrl: string | null;
  platform: string;
  channel: string | null;
  status: string;
  estimatedCommissionVnd: number | null;
  productName: string;
}

export interface UserDetailTransfer {
  id: number;
  amountVnd: number;
  transferCode: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  orderIds: string[];
  /** The bill sent to the customer; empty when the row has no token. */
  billPath: string;
  /** The bank screenshot; served only to the customer or to staff. */
  proofPath: string;
}

export interface UserDetailStats {
  totalCashbackVnd: number;
  /** Approved and unpaid, plus their CONFIRMED bonuses: what we owe now. */
  readyVnd: number;
  /** Waiting orders, at the estimate the customer is shown. */
  awaitingVnd: number;
  paidVnd: number;
  totalOrders: number;
  totalRequests: number;
  totalTransferredVnd: number;
  totalAdminProfitVnd: number;
  periodIsWithheld: boolean;
}

export interface UserDetail {
  user: UserDetailUser;
  orders: UserDetailOrder[];
  linkRequests: UserDetailRequest[];
  transfers: UserDetailTransfer[];
  stats: UserDetailStats;
}

type OrderRow = ReturnType<typeof listOrders>[number];
type TransferRow = ReturnType<typeof listTransfersForCustomer>[number];

interface OrderRequest {
  estimateDetail: string | null;
  sourceUrl: string;
}

/** The link requests behind these orders, in one read instead of one each. */
function requestsForOrders(db: Db, requestIds: string[]): Map<string, OrderRequest> {
  if (requestIds.length === 0) return new Map();
  const rows = db
    .select({
      requestId: linkRequests.requestId,
      estimateDetail: linkRequests.estimateDetail,
      sourceUrl: linkRequests.sourceUrl,
    })
    .from(linkRequests)
    .where(inArray(linkRequests.requestId, requestIds))
    .all();
  return new Map(rows.map((row) => [row.requestId, row]));
}

/** The last bot contact: a link request or a logged command, whichever is later. */
function lastBotActivity(db: Db, customerId: string, zaloUserId: string | null): string | null {
  const lastRequest =
    db
      .select({ at: sql<string | null>`max(${linkRequests.createdAt})` })
      .from(linkRequests)
      .where(eq(linkRequests.customerId, customerId))
      .get()?.at ?? null;

  // Activity is keyed by our customer id, or by the Zalo id before a sign-in.
  const key = eq(activityLogs.customerId, customerId);
  const keyOrZalo =
    zaloUserId === null || zaloUserId === ""
      ? key
      : or(key, eq(activityLogs.customerId, zaloUserId));
  const lastLog =
    db
      .select({ at: sql<string | null>`max(${activityLogs.createdAt})` })
      .from(activityLogs)
      .where(keyOrZalo)
      .get()?.at ?? null;

  return (
    [lastRequest, lastLog]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null
  );
}

function orderView(
  order: OrderRow,
  request: OrderRequest | undefined,
  rate: number,
  withheld: boolean,
): UserDetailOrder {
  const breakdown = orderBreakdown({
    status: order.status as BreakdownStatus,
    approvedCommissionVnd: order.approvedCommission,
    estimatedCommissionVnd: order.estimatedCommission,
    savedCashbackVnd: order.cashbackAmount,
    cashbackRate: rate,
    periodIsWithheld: withheld,
  });

  return {
    orderId: order.orderId,
    status: order.status,
    platform: order.platform,
    settlementStatus: order.settlementStatus,
    orderValueVnd: order.orderValue,
    estimatedCommissionVnd: order.estimatedCommission,
    approvedCommissionVnd: order.approvedCommission,
    cashbackVnd: order.cashbackAmount ?? breakdown.cashbackVnd,
    rejectionReason: order.rejectionReason,
    recordedAt: order.recordedAt,
    approvedAt: order.approvedAt,
    paidAt: order.paidAt,
    productName: estimateProductName(request?.estimateDetail ?? null),
    sourceUrl: request?.sourceUrl ?? null,
    breakdown,
  };
}

function transferView(transfer: TransferRow): UserDetailTransfer {
  const billToken = transfer.billToken ?? "";
  const hasProof = (transfer.proofImage ?? "").trim() !== "";
  return {
    id: transfer.id,
    amountVnd: transfer.amount,
    transferCode: transfer.transferCode,
    note: transfer.note,
    createdAt: transfer.createdAt,
    createdBy: transfer.createdBy,
    orderIds: decodeOrderIds(transfer.orderIds),
    billPath: billToken === "" ? "" : `/b/${billToken}`,
    // The proof is addressed by the bill token, so a row without one has none.
    proofPath: hasProof && billToken !== "" ? `/api/proofs/${billToken}` : "",
  };
}

function requestViews(db: Db, customerId: string): UserDetailRequest[] {
  return db
    .select({
      requestId: linkRequests.requestId,
      createdAt: linkRequests.createdAt,
      sourceUrl: linkRequests.sourceUrl,
      affiliateUrl: linkRequests.affiliateUrl,
      platform: linkRequests.platform,
      channel: linkRequests.channel,
      status: linkRequests.status,
      estimatedCommission: linkRequests.estimatedCommission,
      estimateDetail: linkRequests.estimateDetail,
    })
    .from(linkRequests)
    .where(eq(linkRequests.customerId, customerId))
    .orderBy(desc(linkRequests.createdAt))
    .limit(RECENT_REQUESTS)
    .all()
    .map((row) => ({
      requestId: row.requestId,
      createdAt: row.createdAt,
      sourceUrl: row.sourceUrl,
      affiliateUrl: row.affiliateUrl,
      platform: row.platform,
      channel: row.channel,
      status: row.status,
      estimatedCommissionVnd: row.estimatedCommission,
      productName: estimateProductName(row.estimateDetail),
    }));
}

type CustomerRow = typeof customers.$inferSelect;

function userView(row: CustomerRow, lastActivity: string | null): UserDetailUser {
  return {
    customerId: row.customerId,
    customerCode: row.customerCode,
    displayName: row.displayName,
    zaloUserId: row.zaloUserId,
    privateChatId: row.privateChatId,
    bankName: row.bankName,
    bankAccount: row.bankAccount,
    accountHolder: row.accountHolder,
    consentAt: row.consentAt,
    status: row.status,
    role: row.role,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    loginCount: row.loginCount,
    lastBotActivity: lastActivity,
  };
}

/** The totals under the customer's name. The three balance figures come from
 * `computeBalanceFor`, so staff and customer are told the same numbers. */
function statsView(
  orderViews: UserDetailOrder[],
  transfers: TransferRow[],
  balance: Balance,
  totalRequests: number,
  withheld: boolean,
): UserDetailStats {
  return {
    totalCashbackVnd:
      balance.approvedWaitingVnd + balance.stillWithShopVnd + balance.alreadyPaidVnd,
    readyVnd: balance.approvedWaitingVnd,
    awaitingVnd: balance.stillWithShopVnd,
    paidVnd: balance.alreadyPaidVnd,
    totalOrders: orderViews.length,
    totalRequests,
    totalTransferredVnd: transfers.reduce((sum, transfer) => sum + transfer.amount, 0),
    totalAdminProfitVnd: orderViews.reduce((sum, view) => sum + view.breakdown.operatorKeepsVnd, 0),
    periodIsWithheld: withheld,
  };
}

export function getUserDetail(db: Db, customerId: string): UserDetail | null {
  const row = db.select().from(customers).where(eq(customers.customerId, customerId)).get();
  if (!row) return null;

  const rate = cashbackRate();
  const withheld = periodIsWithheld();
  const orders = listOrders(db, { customerId });
  const requestIds = [
    ...new Set(
      orders.map((order) => order.requestId).filter((id): id is string => id !== null && id !== ""),
    ),
  ];
  const requests = requestsForOrders(db, requestIds);
  const orderViews = orders.map((order) =>
    orderView(order, requests.get(order.requestId ?? ""), rate, withheld),
  );

  const transfers = listTransfersForCustomer(db, customerId);
  const balance = computeBalanceFor(db, customerId, rate);
  const totalRequests =
    db
      .select({ n: sql<number>`count(*)` })
      .from(linkRequests)
      .where(eq(linkRequests.customerId, customerId))
      .get()?.n ?? 0;

  return {
    user: userView(row, lastBotActivity(db, customerId, row.zaloUserId)),
    orders: orderViews,
    linkRequests: requestViews(db, customerId),
    transfers: transfers.map(transferView),
    stats: statsView(orderViews, transfers, balance, totalRequests, withheld),
  };
}
