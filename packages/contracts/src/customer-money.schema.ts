/**
 * The signed-in customer's own money and orders on the website (FR-15, FR-37, FR-18, AD-6, AD-12,
 * INV-5; Stories 7.3 and 7.4). Every figure is the server's: the balance is `getBalances` with the
 * next payout's netting (the same figures as the admin's customer page and `/sodu`), the order
 * lines and the payouts come on the list contract, scoped by the server to the session's customer.
 * No call takes a customer id: the session cookie names the customer.
 *
 *   GET /api/me/money     the balance card, the bank card and the clawed-back orders
 *   GET /api/me/orders    the customer's order lines (orders, and bonuses as their own rows)
 *   GET /api/me/payouts   the customer's payouts, voided ones included
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod/mini";

import { listResponseMiniSchema } from "./list-mini.schema";

const instant = z.string().check(z.regex(INSTANT_PATTERN));
const dong = z.int().check(z.minimum(0));
const httpsImage = z.nullable(z.url({ protocol: /^https$/ }));
const nullable = <T extends z.ZodMiniType>(schema: T) => z.nullable(schema);

export const MY_MONEY_PATH = "/api/me/money";
export const MY_ORDERS_PATH = "/api/me/orders";
export const MY_PAYOUTS_PATH = "/api/me/payouts";

/** The proof image of one of the customer's payouts (Story 4.9), answered to its owner only. */
export const myProofPath = (payoutId: number): string => `/api/me/payouts/${payoutId}/proof`;

export const myMoneySchema = z.object({
  customerCode: z.string(),
  balance: z.object({
    /** What the next payout sends: approved + refunded - deducted. */
    payable: dong,
    /** The stored cashback of approved unpaid orders and confirmed bonuses: the approved lines add up to it. */
    approved: dong,
    /** What voided payouts gave back of clawbacks they had netted, owed again to the customer. */
    refunded: dong,
    /** The estimated cashback of orders the network has not decided yet. */
    waiting: dong,
    paid: dong,
    /** What the next payout nets of the open clawbacks (0 when none is open). */
    deducted: dong,
    /** What stays owed after that payout, netted by later ones. */
    owedAfter: dong,
  }),
  /** The saved bank account (last four digits only), or null when there is none. */
  bank: z.nullable(
    z.object({
      bankName: nullable(z.string()),
      holderName: nullable(z.string()),
      lastFour: z.string(),
      /** A website change waiting for the customer's confirmation in Zalo (FR-10). */
      held: z.boolean(),
    }),
  ),
  /** The open clawbacks, one per order a network cancelled (or paid less for) after it was paid; they add up to `deducted + owedAfter`. */
  deductions: z.array(
    z.object({
      /** The clawback's own id: a stable key, also for one without an order. */
      deductionId: z.string(),
      orderId: nullable(z.string()),
      productName: nullable(z.string()),
      productImageUrl: httpsImage,
      amount: dong,
    }),
  ),
  asOf: instant,
});
export type MyMoney = z.infer<typeof myMoneySchema>;

export const MY_ORDER_LINE_KINDS = ["order", "bonus"] as const;

/**
 * One line of the customer's orders: an order, or a campaign bonus as its own row (list-defects
 * "balance cards include bonuses rows never show"). `amount` is the approved cashback (or the
 * bonus) when `estimate` is false, the estimated cashback of an order still waiting for the
 * network when it is true, and null when the line counts nowhere (rejected, cancelled after
 * approval, being checked). `deducted` is the open clawback of a paid order the network cancelled.
 */
export const myOrderRowSchema = z.object({
  lineId: z.string(),
  kind: z.enum(MY_ORDER_LINE_KINDS),
  orderId: z.string(),
  platform: nullable(z.string()),
  status: z.string(),
  amount: nullable(dong),
  estimate: z.boolean(),
  /** The cancel reason code of a rejected order; the website words it. */
  rejectionReason: nullable(z.string()),
  campaignName: nullable(z.string()),
  productName: nullable(z.string()),
  productImageUrl: httpsImage,
  recordedAt: nullable(instant),
  approvedAt: nullable(instant),
  paidAt: nullable(instant),
  deducted: nullable(dong),
});
export type MyOrderRow = z.infer<typeof myOrderRowSchema>;
export const myOrdersResponseSchema = listResponseMiniSchema(myOrderRowSchema);

export const myPayoutRowSchema = z.object({
  payoutId: z.int().check(z.minimum(1)),
  /** What left the bank; 0 for a payout that only netted a clawback. */
  amount: dong,
  /** What it still counts as paid: the amount while recorded, 0 once voided. */
  paidAmount: dong,
  status: z.enum(["RECORDED", "VOIDED"]),
  recordedAt: nullable(instant),
  voidedAt: nullable(instant),
  receiptToken: nullable(z.string()),
  hasProof: z.boolean(),
});
export type MyPayoutRow = z.infer<typeof myPayoutRowSchema>;
export const myPayoutsResponseSchema = listResponseMiniSchema(myPayoutRowSchema);
