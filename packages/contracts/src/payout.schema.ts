/**
 * The Payouts screen's contract (FR-16, FR-17, FR-31, AD-6, AD-9, Stories 4.6 and 4.7).
 *
 * The list row carries one value per field: the customer code and name apart, the bank apart from
 * the last four digits of the account, the settlement fact apart from the amount, every flag in
 * one set. `payable` is `getBalances` payable; nothing else is ever shown as owed.
 *
 * Opening a payout takes no body at all: the strict empty object refuses an amount, an order list
 * or any other field (INV-4). The answer is the server's preview, or "taken" with the name of the
 * staff member who holds the customer.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod";

import { listResponseSchema } from "./list.schema";

/** The two tabs of the Payouts list: payable now, and needs action first. */
export const PAYOUT_QUEUES = ["PAYABLE", "ACTION"] as const;
export type PayoutQueue = (typeof PAYOUT_QUEUES)[number];

/**
 * A row's flags, in display order. Every flag puts the row in "needs action". NETTING_ONLY (open
 * clawbacks reach the gross, AD-6) is a transfer of 0: it is never opened as a payout until the
 * netting-only payout of Story 4.11 records it.
 */
export const PAYOUT_FLAGS = ["NO_BANK", "BANK_HELD", "BANK_CHANGED", "SHARED_BANK", "NETTING_ONLY"] as const;
export type PayoutFlag = (typeof PAYOUT_FLAGS)[number];
export const ACTION_FLAGS: readonly PayoutFlag[] = ["NO_BANK", "BANK_HELD", "BANK_CHANGED", "SHARED_BANK", "NETTING_ONLY"];
/** Flags that refuse a claim outright: no confirmed account, or nothing to transfer. */
export const BLOCKING_FLAGS: readonly PayoutFlag[] = ["NO_BANK", "BANK_HELD", "NETTING_ONLY"];

/** The settled fact of a row's payable orders (D27): information only, never a status. */
export const SETTLEMENT_FACTS = ["UNSETTLED", "PARTLY_SETTLED", "SETTLED"] as const;

const instant = z.string().regex(INSTANT_PATTERN);
const dong = z.number().int().min(0);

export const payoutQueueRowSchema = z.object({
  customerId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  bankName: z.string().nullable(),
  accountLastFour: z.string().nullable(),
  orderCount: z.number().int().min(0),
  settledCount: z.number().int().min(0),
  settlement: z.enum(SETTLEMENT_FACTS).nullable(),
  /** Comma-separated PAYOUT_FLAGS, in that order; empty for none. */
  flags: z.string(),
  bankChangedAt: instant.nullable(),
  payable: dong,
  queue: z.enum(PAYOUT_QUEUES),
  /** The staff member holding an OPEN claim on the customer, if any. */
  claimStaffId: z.string().nullable(),
  claimStaffName: z.string().nullable(),
});
export type PayoutQueueRow = z.infer<typeof payoutQueueRowSchema>;

export const payoutQueueCountsSchema = z.object({ payable: z.number().int().min(0), action: z.number().int().min(0) });
export type PayoutQueueCounts = z.infer<typeof payoutQueueCountsSchema>;

/**
 * The Payouts list response: the list contract, plus each tab's whole total from the same build
 * of the queue (the tabs' own figures; `total` and `summary` stay those of the filtered rows).
 */
export const payoutListResponseSchema = listResponseSchema(payoutQueueRowSchema).extend({ queues: payoutQueueCountsSchema });
export type PayoutListResponse = z.infer<typeof payoutListResponseSchema>;

export const payoutCustomerParamsSchema = z.strictObject({ customerId: z.string().regex(/^[A-Za-z0-9]{1,64}$/) });
export const payoutClaimParamsSchema = z.strictObject({ claimId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/) });
/** Opening a payout takes nothing from the browser (INV-4). */
export const payoutClaimRequestSchema = z.strictObject({});

const previewOrderSchema = z.object({ orderId: z.string(), productName: z.string().nullable(), productImageUrl: z.url({ protocol: /^https$/ }).nullable(), cashback: dong, settled: z.boolean() });
const previewBonusSchema = z.object({ awardId: z.number().int(), orderId: z.string(), campaignName: z.string(), amount: dong });
const previewClawbackSchema = z.object({ clawbackId: z.string(), orderId: z.string().nullable(), open: z.number().int().min(1) });

export const payoutPreviewSchema = z.object({
  outcome: z.literal("claimed"),
  claimId: z.string(),
  transferReference: z.string(),
  openedAt: instant,
  customerId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  /** What the customer receives: getBalances payable (0 for netting only). */
  amount: dong,
  gross: dong,
  deductedNext: dong,
  bankName: z.string().nullable(),
  holderName: z.string().nullable(),
  accountLastFour: z.string(),
  /** The EMVCo VietQR text for exactly `amount`, or null with the reason. */
  qrPayload: z.string().nullable(),
  qrMissing: z.enum(["netting_only", "no_single_bank", "qr_failed"]).nullable(),
  flags: z.array(z.enum(PAYOUT_FLAGS)),
  orders: z.array(previewOrderSchema),
  bonuses: z.array(previewBonusSchema),
  clawbacks: z.array(previewClawbackSchema),
  /** The last claim was abandoned after its QR was shown: a transfer may have been made (D39). */
  warning: z.object({ amount: dong, at: instant }).nullable(),
});
export type PayoutPreview = z.infer<typeof payoutPreviewSchema>;

export const payoutClaimResponseSchema = z.discriminatedUnion("outcome", [payoutPreviewSchema, z.object({ outcome: z.literal("taken"), staffName: z.string() })]);
export type PayoutClaimResponse = z.infer<typeof payoutClaimResponseSchema>;

export const payoutAccountResponseSchema = z.object({ accountNumber: z.string() });
export const payoutReleaseResponseSchema = z.object({ claimId: z.string(), status: z.enum(["OPEN", "CONFIRMED", "ABANDONED"]) });
