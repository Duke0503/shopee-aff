/**
 * The review queue and one case's panel (FR-14, UJ-6, FR-37, Story 4.15).
 *
 * `REVIEW_CASE_REASONS` is every reason a case opens with, in the order the chips show them; the
 * server checks its own reason type against it. The settlement reasons (D59) change no order, so
 * their cases are only dismissed.
 *
 * The list row is one value per field, oldest first by default. The list response also carries
 * the whole count of open and of resolved cases, the two tabs' own totals; the reason chips' counts
 * are the facets of the filtered set.
 *
 * The panel's detail shows the report row as read-only facts (each one key, its kind and its
 * value), the candidates the rules produced with their recent orders, and whether apply is
 * possible at all. Nothing in it is an editable amount or a free choice of customer.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod";

import { listResponseSchema } from "./list.schema";

const instant = z.string().regex(INSTANT_PATTERN);

export const REVIEW_CASE_REASONS = [
  "unattributed",
  "unattributed_sub_id1",
  "owner_disagreement",
  "dev_link_in_production",
  "production_link_in_dev",
  "unknown_status",
  "missing_order_id",
  "no_items",
  "missing_commission",
  "invalid_amount",
  "invalid_quantity",
  "ambiguous_sub_ids",
  "conflicting_sub_ids",
  "cancel_after_approval",
  "cancel_after_payout",
  "commission_drop",
  "commission_drop_after_payout",
  "wrong_rejection",
  "network_mismatch",
  "not_seen_in_report",
  "settlement_mismatch",
  "settlement_conflict",
  "settlement_not_approved",
  "settlement_facts_changed",
] as const;
export type ReviewCaseReasonName = (typeof REVIEW_CASE_REASONS)[number];

/** Network payout cases (D59): checked against the network and dismissed, never applied. */
export const DISMISS_ONLY_REASONS: readonly ReviewCaseReasonName[] = [
  "settlement_mismatch",
  "settlement_conflict",
  "settlement_not_approved",
  "settlement_facts_changed",
];

export const REVIEW_NETWORKS = ["shopee", "accesstrade"] as const;

export const reviewCaseRowSchema = z.object({
  caseId: z.number().int().min(1),
  network: z.enum(REVIEW_NETWORKS),
  /** The report's order id, `#<fingerprint>` for a row without one, or `payout:<id>` for a network payout. */
  subject: z.string(),
  orderId: z.string().nullable(),
  reason: z.string(),
  status: z.enum(["OPEN", "RESOLVED"]),
  resolution: z.enum(["APPLIED", "DISMISSED"]).nullable(),
  openedAt: instant,
  resolvedAt: instant.nullable(),
});
export type ReviewCaseRow = z.infer<typeof reviewCaseRowSchema>;

export const reviewCaseCountsSchema = z.object({
  open: z.number().int().min(0),
  resolved: z.number().int().min(0),
});

export const reviewCaseListSchema = listResponseSchema(reviewCaseRowSchema).extend({
  counts: reviewCaseCountsSchema,
});
export type ReviewCaseList = z.infer<typeof reviewCaseListSchema>;

/**
 * How a read-only fact of the report row is shown: plain text, a code chip, an amount, a time, a
 * yes/no, an order status of the registry (null: one the system does not know), or reason codes
 * (comma-separated) shown in their words.
 */
export const REVIEW_FACT_KINDS = [
  "text",
  "code",
  "money",
  "instant",
  "flag",
  "orderStatus",
  "reasons",
] as const;

export const reviewFactSchema = z.object({
  /** A label key suffix (`review_fact_<key>`); an unknown key is shown as it is. */
  key: z.string(),
  kind: z.enum(REVIEW_FACT_KINDS),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  /** The network's own words behind a mapped value (its raw status), shown small, if at all. */
  detail: z.string().nullable(),
});
export type ReviewFact = z.infer<typeof reviewFactSchema>;

const recentOrderSchema = z.object({
  orderId: z.string(),
  productName: z.string().nullable(),
  productImageUrl: z.url({ protocol: /^https$/ }).nullable(),
  status: z.string(),
  cashback: z.number().int().nullable(),
  recordedAt: instant.nullable(),
});

export const reviewCandidateSchema = z.object({
  customerId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  /** The candidate's latest orders, newest first, at most five. */
  recentOrders: z.array(recentOrderSchema),
});
export type ReviewCandidate = z.infer<typeof reviewCandidateSchema>;

export const reviewCaseDetailSchema = reviewCaseRowSchema.extend({
  resolutionReason: z.string().nullable(),
  /** The order recorded under the case, if any, as it stands now. */
  order: z
    .object({
      status: z.string(),
      customerCode: z.string().nullable(),
      cashback: z.number().int().nullable(),
    })
    .nullable(),
  facts: z.array(reviewFactSchema),
  candidates: z.array(reviewCandidateSchema),
  /** False for a resolved case and for a network payout case: only dismiss is offered, or nothing. */
  applicable: z.boolean(),
  /** A FROZEN order: apply restores the state it was frozen from, or rejects it. */
  frozen: z.boolean(),
});
export type ReviewCaseDetail = z.infer<typeof reviewCaseDetailSchema>;
