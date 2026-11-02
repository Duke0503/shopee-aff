/**
 * One of the customer's orders in full (FR-13, FR-15, INV-5; Story 7.4, pen.dev opJFP), read only.
 * The order is found only under the stored ids the server resolved for the session (the survivor
 * and its merged aliases), so another customer's order reads as no order at all.
 *
 * The product is the link's snapshot (D56), or the report row's first item when the order came
 * without a link request. The money is packages/money's split of the stored approved commission
 * with the withheld setting stored at approval (an imported approval was withheld live); the
 * customer's figure is always the stored cashback (D3), and when the split does not give it (an
 * order approved by the old system with its own figures) the lines are not explained. While the
 * network has not decided, the estimate goes through the same split, withheld, the lower figure
 * `estimatedCashback` and the list show. A rejected or cancelled order has no money to split.
 * A paid order the network cancelled afterwards stays PAID in the ledger (D4) and reads REVERSED;
 * the caller says so from the payouts module's clawbacks.
 */
import type { MyOrderMoney } from "@cashback/contracts";
import { CASHBACK_SHARE_BPS, isWithheld, NETWORK_MONEY_RULES, splitCommission, WITHHOLDING_TAX_BPS, type AffiliateNetwork } from "@cashback/money";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { httpsImageUrl, productSnapshotsOf } from "../linking/index";
import { orderItems, orders } from "./schema";

export interface CustomerOrderFacts {
  readonly orderId: string;
  readonly network: AffiliateNetwork | null;
  readonly platform: string | null;
  readonly status: string;
  readonly productName: string | null;
  readonly productImageUrl: string | null;
  readonly orderValue: number | null;
  readonly money: MyOrderMoney | null;
  readonly rejectionReason: string | null;
  readonly recordedAt: string | null;
  readonly approvedAt: string | null;
  readonly paidAt: string | null;
}

interface SplitSource {
  readonly network: AffiliateNetwork | null;
  readonly status: string;
  readonly estimatedCommission: number | null;
  readonly approvedCommission: number | null;
  readonly cashback: number | null;
  readonly cashbackWithheld: boolean | null;
}

const ESTIMATE_WITHHELD = true;

function lines(network: AffiliateNetwork, commission: number, withheld: boolean, estimate: boolean, stored: number | null): MyOrderMoney {
  const split = splitCommission({ approvedCommission: commission, network, withheld });
  const taxed = isWithheld(network, withheld);
  return {
    estimate,
    commission,
    feeBps: Number(NETWORK_MONEY_RULES[network].feeBps),
    fee: split.fee,
    taxBps: taxed ? Number(WITHHOLDING_TAX_BPS) : 0,
    tax: split.tax,
    shareBps: Number(CASHBACK_SHARE_BPS),
    cashback: stored ?? split.cashback,
    explained: stored === null || stored === split.cashback,
  };
}

/** The order's money line by line, or null when there is none to show. */
export function orderMoneyOf(o: SplitSource): MyOrderMoney | null {
  if (o.network === null) return null;
  if (o.status === "AWAITING_APPROVAL") return o.estimatedCommission === null ? null : lines(o.network, o.estimatedCommission, ESTIMATE_WITHHELD, true, null);
  if ((o.status === "APPROVED" || o.status === "PAID") && o.approvedCommission !== null && o.cashback !== null) {
    return lines(o.network, o.approvedCommission, o.cashbackWithheld ?? true, false, o.cashback);
  }
  return null;
}

/** The first item the report gave, for an order without a link request (D56). */
function reportItem(db: LedgerDb, orderId: string): { name: string | null; imageUrl: string | null } | undefined {
  return db.select({ name: orderItems.name, imageUrl: orderItems.imageUrl }).from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.lineNo)).limit(1).get();
}

/** The order under the session's stored ids, or null when it is not theirs (or not at all). */
export function customerOrderFacts(db: LedgerDb, customerIds: readonly string[], orderId: string, cancelledAfterPayout: (orderId: string) => boolean): CustomerOrderFacts | null {
  if (customerIds.length === 0) return null;
  const o = db
    .select({
      orderId: orders.orderId,
      network: orders.network,
      platform: orders.platform,
      status: orders.status,
      requestId: orders.requestId,
      orderValue: orders.orderValue,
      estimatedCommission: orders.estimatedCommission,
      approvedCommission: orders.approvedCommission,
      cashback: orders.cashback,
      cashbackWithheld: orders.cashbackWithheld,
      rejectionReason: orders.rejectionReason,
      recordedAt: orders.recordedAt,
      approvedAt: orders.approvedAt,
      paidAt: orders.paidAt,
    })
    .from(orders)
    .where(and(eq(orders.orderId, orderId), inArray(orders.customerId, [...customerIds])))
    .get();
  if (o === undefined) return null;
  const status = o.status === "PAID" && cancelledAfterPayout(o.orderId) ? "REVERSED" : o.status;
  const snapshot = o.requestId === null ? undefined : productSnapshotsOf(db, [o.requestId]).get(o.requestId);
  const item = (snapshot?.productName ?? null) === null ? reportItem(db, o.orderId) : undefined;
  return {
    orderId: o.orderId,
    network: o.network,
    platform: o.platform,
    status,
    productName: snapshot?.productName ?? item?.name ?? null,
    productImageUrl: snapshot?.productImageUrl ?? httpsImageUrl(item?.imageUrl ?? null),
    orderValue: o.orderValue,
    money: orderMoneyOf({ ...o, status }),
    rejectionReason: status === "REJECTED" ? o.rejectionReason : null,
    recordedAt: o.recordedAt,
    approvedAt: o.approvedAt,
    paidAt: o.paidAt,
  };
}
