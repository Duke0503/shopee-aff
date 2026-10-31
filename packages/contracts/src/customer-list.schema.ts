/**
 * The admin Customers list and one customer's page (FR-26, FR-15, FR-37, AD-6, Story 4.14).
 *
 * A list row carries one value per field: the customer code and name apart, the bank apart from
 * the last four digits, the order count, `payable` and `paid` from `getBalances` (the same figures
 * as the Payouts row and the customer page), the flags of the shared payout flag rules, and three
 * derived facts the filters and chips use: whether something is owed, whether a flag is on, and
 * the bank state (saved, waiting for the Zalo confirmation, or none) from the same rules.
 *
 * The customer page carries the balance card's figures, the bank account with only its last four
 * digits and the 72-hour change flag, the open clawbacks, and the exact count behind each tab.
 * No field carries a full account number.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod";

import { listResponseSchema } from "./list.schema";
import { PAYOUT_FLAGS } from "./payout.schema";

const instant = z.string().regex(INSTANT_PATTERN);
const dong = z.number().int().min(0);

export const YES_NO = ["YES", "NO"] as const;
/** A customer's bank account by the payout flag rules: saved, saved on the web but not confirmed in Zalo, or none. */
export const CUSTOMER_BANK_STATES = ["SAVED", "HELD", "NONE"] as const;
export type CustomerBankState = (typeof CUSTOMER_BANK_STATES)[number];

export const adminCustomerRowSchema = z.object({
  customerId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  bankName: z.string().nullable(),
  accountLastFour: z.string().nullable(),
  orderCount: z.number().int().min(0),
  payable: dong,
  paid: dong,
  /** Comma-separated PAYOUT_FLAGS, in that order; empty for none. */
  flags: z.string(),
  bankChangedAt: instant.nullable(),
  owed: z.enum(YES_NO),
  flagged: z.enum(YES_NO),
  bank: z.enum(CUSTOMER_BANK_STATES),
});
export type AdminCustomerRow = z.infer<typeof adminCustomerRowSchema>;

export const adminCustomersResponseSchema = listResponseSchema(adminCustomerRowSchema);

/** A customer named in a desk address: an id, a code, an alias or a Zalo id. */
export const customerKeyParamsSchema = z.strictObject({
  customerKey: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
});

export const customerPageSchema = z.object({
  customerId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  status: z.enum(["ACTIVE", "DISABLED", "ERASED"]),
  zaloUserId: z.string().nullable(),
  joinedAt: instant.nullable(),
  /** When the personal data was erased (FR-35); null for a live customer. */
  erasedAt: instant.nullable(),
  /** getBalances, the one payable definition (AD-6). */
  balance: z.object({ payable: dong, gross: dong, waiting: dong, paid: dong, deductedNext: dong }),
  flags: z.array(z.enum(PAYOUT_FLAGS)),
  bank: z
    .object({
      bankName: z.string().nullable(),
      holderName: z.string().nullable(),
      lastFour: z.string(),
      changedAt: instant.nullable(),
      /** Saved on the website and not yet confirmed in Zalo: payouts wait (FR-10). */
      held: z.boolean(),
      /** Saved within the last 72 hours (FR-10, the BANK_CHANGED flag). */
      changedRecently: z.boolean(),
    })
    .nullable(),
  clawbacks: z.array(
    z.object({
      clawbackId: z.string(),
      orderId: z.string().nullable(),
      open: z.number().int().min(1),
    }),
  ),
  /** The exact number of records behind each tab, never capped. */
  counts: z.object({
    orders: z.number().int().min(0),
    linkRequests: z.number().int().min(0),
    payouts: z.number().int().min(0),
  }),
});
export type CustomerPage = z.infer<typeof customerPageSchema>;

export const LINK_REQUEST_NETWORKS = ["shopee", "accesstrade"] as const;

/** One link request on a customer's page (D56 product snapshot, https images only). */
export const adminLinkRequestRowSchema = z.object({
  requestId: z.string(),
  productName: z.string().nullable(),
  productImageUrl: z.url({ protocol: /^https$/ }).nullable(),
  network: z.enum(LINK_REQUEST_NETWORKS).nullable(),
  status: z.string(),
  createdAt: instant.nullable(),
});
export type AdminLinkRequestRow = z.infer<typeof adminLinkRequestRowSchema>;

export const adminLinkRequestsResponseSchema = listResponseSchema(adminLinkRequestRowSchema);

/** Erasing a customer's personal data (FR-35, Story 4.16): the forced erase needs the admin's reason. */
export const customerEraseRequestSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict();
export type CustomerEraseRequest = z.infer<typeof customerEraseRequestSchema>;

export const customerErasedResponseSchema = z.object({
  customerId: z.string(),
  erasedAt: instant,
  forced: z.boolean(),
  mergedRecords: z.number().int().min(0),
});
export type CustomerErasedResponse = z.infer<typeof customerErasedResponseSchema>;
