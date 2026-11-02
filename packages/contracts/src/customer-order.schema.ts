/**
 * One of the signed-in customer's orders in full, and the report of a purchase that did not show
 * (FR-13, FR-15, FR-14, INV-5; Story 7.4, pen.dev opJFP and Gc1Zb). No call takes a customer id:
 * the session cookie names the customer, and an order of anyone else answers 404 like an unknown
 * one.
 *
 *   GET  /api/me/orders/<orderId>   the order's product, money split, steps and the payout that paid it
 *   POST /api/me/missing-orders     a purchase the customer made that the list does not show
 *
 * The split is the server's (packages/money over the stored approved commission). While the
 * network has not decided, every figure is the estimate (`estimate` true) and the page says so.
 * Written with zod/mini so the website's chunks stay small.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod/mini";

const instant = z.string().check(z.regex(INSTANT_PATTERN));
const dong = z.int().check(z.minimum(0));
const bps = z.int().check(z.minimum(0), z.maximum(10000));
const nullable = <T extends z.ZodMiniType>(schema: T) => z.nullable(schema);

export const myOrderPath = (orderId: string): string => `/api/me/orders/${encodeURIComponent(orderId)}`;
export const MY_MISSING_ORDERS_PATH = "/api/me/missing-orders";

/** The money of an order line by line, as the guide explains it (FR-13). */
export const myOrderMoneySchema = z.object({
  /** True while the network has not decided: the commission is its estimate, and so is the rest. */
  estimate: z.boolean(),
  commission: dong,
  feeBps: bps,
  fee: dong,
  /** The withheld tax rate; 0 in a period that is not withheld (then no tax line shows). */
  taxBps: bps,
  tax: dong,
  shareBps: bps,
  /** What the customer receives: the stored cashback once approved, the estimate before. */
  cashback: dong,
  /**
   * False when the split of the commission does not give the stored cashback (an order the old
   * system approved with its own figures): then only the commission and the cashback are shown.
   */
  explained: z.boolean(),
});
export type MyOrderMoney = z.infer<typeof myOrderMoneySchema>;

export const myOrderDetailSchema = z.object({
  orderId: z.string(),
  platform: nullable(z.string()),
  /** The customer's view of the status (a paid order cancelled afterwards reads REVERSED). */
  status: z.string(),
  productName: nullable(z.string()),
  productImageUrl: nullable(z.url({ protocol: /^https$/ })),
  orderValue: nullable(dong),
  /** Null when there is nothing to split (rejected, no figure from the network yet). */
  money: nullable(myOrderMoneySchema),
  rejectionReason: nullable(z.string()),
  recordedAt: nullable(instant),
  approvedAt: nullable(instant),
  paidAt: nullable(instant),
  /** The recorded payout that paid this order, with its public receipt. */
  payout: nullable(z.object({ recordedAt: nullable(instant), receiptToken: nullable(z.string()) })),
  /** The open clawback of a paid order the network cancelled or paid less for afterwards. */
  deducted: nullable(dong),
});
export type MyOrderDetail = z.infer<typeof myOrderDetailSchema>;

/** A Shopee order id (`241028D9TRX`: the date, then letters and digits) or a TikTok Shop one (digits only). */
export const MISSING_ORDER_ID = /^(\d{6}[A-Z0-9]{4,12}|\d{15,20})$/;
export const MISSING_ORDER_NOTE_MAX = 500;
export const MISSING_ORDER_URL_MAX = 2000;

export const missingOrderRequestSchema = z.strictObject({
  orderId: z.string().check(z.maxLength(40)),
  /** The day of the purchase, `YYYY-MM-DD` (Vietnam). */
  purchasedOn: z.string().check(z.maxLength(10)),
  /** The product's link; empty when the customer has none. */
  productUrl: z.string().check(z.maxLength(MISSING_ORDER_URL_MAX)),
  note: z.string().check(z.maxLength(MISSING_ORDER_NOTE_MAX)),
  /** The self-check the page asks first, as the customer answered it. */
  checks: z.strictObject({ openedInZalo: z.boolean(), otherCashbackLink: z.boolean(), guestLink: z.boolean() }),
});
export type MissingOrderRequest = z.infer<typeof missingOrderRequestSchema>;

export const MISSING_ORDER_RESULTS = ["received", "already_reported", "already_recorded"] as const;

export const missingOrderResponseSchema = z.object({
  /** `already_recorded`: the order is already the customer's own; the page opens it. */
  result: z.enum(MISSING_ORDER_RESULTS),
  orderId: z.string(),
});
export type MissingOrderResponse = z.infer<typeof missingOrderResponseSchema>;
