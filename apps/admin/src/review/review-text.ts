/**
 * The words of the review queue (D57): each case reason's short name (list column and chips) and
 * its sentence saying why the system did not guess (panel), from packages/labels/vi/admin.json. A
 * reason the label file does not know shows as it is, never blank.
 */
import {
  REVIEW_CASE_REASONS,
  type ReviewCaseDetail,
  type ReviewCaseReasonName,
  type ReviewFact,
} from "@cashback/contracts";

import { adminText, type AdminKey } from "../labels";

const known = (reason: string): reason is ReviewCaseReasonName =>
  (REVIEW_CASE_REASONS as readonly string[]).includes(reason);

export const reasonLabel = (reason: string): string =>
  known(reason) ? adminText(`review_reason_${reason}` as AdminKey) : reason;
export const reasonWhy = (reason: string): string | null =>
  known(reason) ? adminText(`review_why_${reason}` as AdminKey) : null;

const FACT_KEYS = new Set<string>([
  "orderId",
  "networkStatus",
  "purchasedAt",
  "subId1",
  "subId2",
  "subId3",
  "subId4",
  "subId5",
  "unmatchedRequest",
  "itemCount",
  "orderValue",
  "reportedCommission",
  "problems",
  "networkPayoutId",
  "amount",
  "eligible",
  "withheld",
  "createdAt",
  "windowFrom",
  "matchedGross",
  "unknown",
  "orderIds",
  "settledBy",
  "status",
  "lastSeenInReportAt",
  "recordedAt",
]);

export const factLabel = (fact: ReviewFact): string =>
  FACT_KEYS.has(fact.key) ? adminText(`review_fact_${fact.key}` as AdminKey) : fact.key;

/** A case's subject as staff read it: the order id, a network payout's id, or a row with no order id. */
export function subjectText(subject: string): {
  readonly code: string | null;
  readonly text: string | null;
} {
  if (subject.startsWith("payout:"))
    return {
      code: subject.slice("payout:".length),
      text: adminText("review_subject_payout", { id: subject.slice("payout:".length) }),
    };
  if (subject.startsWith("#")) return { code: null, text: adminText("review_subject_no_order") };
  return { code: subject, text: null };
}

const NETWORK: Record<string, AdminKey> = {
  shopee: "network_shopee",
  accesstrade: "network_accesstrade",
};
export const networkName = (network: string): string =>
  adminText(NETWORK[network] ?? "network_unknown");

/** The reasons where the link's maker is the rule's one candidate, worth saying in a sentence. */
const LINK_HINT_REASONS: readonly string[] = [
  "unattributed",
  "unattributed_sub_id1",
  "owner_disagreement",
];

/** "Link R... do DP00031 tạo, có thể là đơn của khách này." when the case names one link and one candidate. */
export function candidateHint(detail: ReviewCaseDetail): string | null {
  if (!LINK_HINT_REASONS.includes(detail.reason) || detail.candidates.length !== 1) return null;
  const link = detail.facts.find((f) => f.key === "subId2")?.value;
  const code = detail.candidates[0]?.customerCode ?? null;
  if (typeof link !== "string" || link === "" || code === null) return null;
  return adminText("review_why_hint", { link, code });
}

/** The panel's title: "Đơn <id>" for an order, the network payout or the row with no order id otherwise. */
export function caseTitle(subject: string): string {
  const s = subjectText(subject);
  return s.text ?? adminText("review_panel_title", { subject: s.code ?? subject });
}
