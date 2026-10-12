/**
 * The shapes the staff console's routes answer with. Split from `./api-types`
 * because the console surface is much larger than the customer one; both are
 * re-exported by `./api-client`, so callers import from `@mmo/contracts`.
 */

import type { ApiPagination } from "./api-types";

/** One customer to pay, with the identity the owner must check first. */
export interface ApiPaymentRow {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  amountVnd: number;
  blockedReason: string | null;
  bankChangedRecently: boolean;
}

export interface ApiPayables {
  ready: ApiPaymentRow[];
  blocked: ApiPaymentRow[];
}

/** A transfer already recorded, as the money-out history shows it. */
export interface ApiPaymentTransfer {
  id: number;
  customerId: string | null;
  amountVnd: number;
  transferCode: string | null;
  note: string | null;
  orderIds: string[];
  createdAt: string;
  notifiedAt: string | null;
}

export interface ApiPaymentsPage {
  ok: boolean;
  payables: ApiPayables;
  /** The summary figures, added up by the server (the browser never does). */
  totals: ApiPaymentTotals;
  transfers: ApiPaymentTransfer[];
}

export interface ApiPaymentTotals {
  readyCount: number;
  readyVnd: number;
  blockedCount: number;
  blockedVnd: number;
  allCount: number;
  allVnd: number;
}

/** The VietQR fields, present only when the bank matched for certain. */
export interface ApiVietQr {
  bankBin: string;
  accountNumber: string;
  amountVnd: number;
  note: string;
}

export interface ApiPaymentPlanOrder {
  orderId: string;
  cashbackVnd: number;
  approvedAt: string | null;
  recordedAt: string | null;
}

/** What paying one customer right now would mean. Nothing is recorded yet. */
export interface ApiPaymentPlan {
  ok: boolean;
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  orders: ApiPaymentPlanOrder[];
  ordersVnd: number;
  bonusVnd: number;
  totalVnd: number;
  memo: string;
  qr: ApiVietQr | null;
}

/** The orders the plan listed; the server still computes the amount itself. */
export interface ApiConfirmPayoutInput {
  customerId: string;
  orderIds: string[];
  note?: string;
  transferCode?: string;
}

export interface ApiConfirmPayoutResult {
  ok: boolean;
  transferId: number;
  amountVnd: number;
  billToken: string;
  billPath: string;
}

/** One row of the admin customer list. Aggregates are stored columns only. */
export interface ApiUserRow {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  zaloUserId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  loginCount: number;
  status: string;
  orderCount: number;
  totalCashback: number;
  awaitingAmount: number;
  readyAmount: number;
  paidAmount: number;
  lastBotActivity: string | null;
  recentRequests: Array<{ name: string; createdAt: string; affiliateUrl: string | null }>;
}

export interface ApiUsersPage {
  ok: boolean;
  users: ApiUserRow[];
  pagination: ApiPagination;
}

export interface ApiUsersQuery {
  search?: string;
  bank?: "all" | "has_bank" | "no_bank";
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/** One order in the staff list: the customer page's row, plus whose it is. */
export interface ApiAdminOrder extends ApiUserOrder {
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
}

export interface ApiAdminOrdersQuery {
  search?: string;
  status?: string;
  settlementStatus?: string;
  platform?: string;
  customerId?: string;
  /** A day (`2026-10-05`) or a full stamp; the server widens a day to 00:00–23:59. */
  fromDate?: string;
  toDate?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface ApiAdminOrdersPage {
  orders: ApiAdminOrder[];
  pagination: ApiPagination;
}

/** Marking orders paid happens only after the money really left. */
export interface ApiMarkPaidInput {
  customerId: string;
  orderIds: string[];
}

export interface ApiMarkPaidResult {
  ok: boolean;
  paid: number;
  /** The orders that were left alone: unknown, another customer's, or already paid. */
  skipped: string[];
  message?: string;
}

/** What an order earned, and on what basis. Mirrors the server's breakdown. */
export interface ApiOrderBreakdown {
  basis: "approved" | "estimate" | "none";
  commissionVnd: number;
  serviceFeeVnd: number;
  withheldTaxVnd: number;
  netVnd: number;
  cashbackVnd: number;
  operatorKeepsVnd: number;
  operatorMarginPercent: number;
}

export interface ApiUserOrder {
  orderId: string;
  status: string;
  platform: string;
  settlementStatus: string;
  orderValueVnd: number | null;
  estimatedCommissionVnd: number | null;
  approvedCommissionVnd: number | null;
  cashbackVnd: number;
  rejectionReason: string | null;
  recordedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  productName: string;
  sourceUrl: string | null;
  breakdown: ApiOrderBreakdown;
}

export interface ApiUserRequest {
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

export interface ApiUserTransfer {
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

export interface ApiUserStats {
  totalCashbackVnd: number;
  readyVnd: number;
  awaitingVnd: number;
  paidVnd: number;
  totalOrders: number;
  totalRequests: number;
  totalTransferredVnd: number;
  totalAdminProfitVnd: number;
  periodIsWithheld: boolean;
}

/** One customer's page. Amounts all come from the server. */
export interface ApiUserDetail {
  ok: boolean;
  user: {
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
  };
  orders: ApiUserOrder[];
  linkRequests: ApiUserRequest[];
  transfers: ApiUserTransfer[];
  stats: ApiUserStats;
}

export interface ApiRecordTransferInput {
  customerId: string;
  /** Empty means every order of that customer that is approved and unpaid. */
  orderIds?: string[];
  /** What the screen showed; the server refuses a mismatch instead of paying it. */
  amountVnd?: number;
  note?: string;
  transferCode?: string;
  proofImage?: string;
}

export interface ApiRecordTransferResult {
  ok: boolean;
  transferId: number;
  amountVnd: number;
  billToken: string;
  billPath: string;
}

export interface ApiCampaign {
  campaignId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  slots: number;
  bonusVnd: number;
  perCustomer: number;
  status: string;
}

export interface ApiTransfer {
  id: number;
  customerId: string;
  amountVnd: number;
  note: string | null;
  orderIds: string[];
  createdAt: string;
}
