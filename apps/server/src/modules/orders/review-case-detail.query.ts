/**
 * One review case as its panel shows it (FR-14, UJ-6, EXPERIENCE.md review case panel; Story
 * 4.15), read only. The stored report row becomes a list of read-only facts, each with the kind it
 * is shown as: the order id, the network's own status, when it was bought, the sub_ids the link
 * carried, the items' value and the commission the network reported (sums of the row's whole-dong
 * figures, through packages/money), and any part the reader could not read. A case opened from
 * other facts (an order the report stopped showing, a network payout, D59) lists those facts the
 * same way. The candidates are exactly the customers the rules produced, each resolved to its
 * survivor with its latest orders, the guest account never among them (D5); nothing here lets staff
 * name another customer or an amount. Stored JSON is read without throwing: a damaged value shows as
 * no facts and no candidates, and the case can still be dismissed.
 *
 * `applicable` is false for a resolved case and for a network payout case, which changes no order
 * and is only dismissed; `frozen` says apply may restore a FROZEN order or reject it.
 */
import type { ReviewCaseDetail, ReviewFact } from "@cashback/contracts";
import { sumDong } from "@cashback/money";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { customerCardsOf, customerCodeOf, customerKeys } from "../identity/index";
import { httpsImageUrl, type NetworkStatus } from "../linking/index";
import { recentOrdersOf } from "./order-cards.query";
import { findOrder } from "./order-ledger.repository";
import { SETTLEMENT_CASE_REASONS } from "./review-case.command";
import { caseCandidates, parseStored, storedRow } from "./review-plan.query";
import { reviewCases } from "./schema";

const RECENT_ORDERS = 5;

type Kind = ReviewFact["kind"];

/** How a fact of a non-report observation is shown; any other key is plain text. */
const FACT_KIND: Readonly<Record<string, Kind>> = {
  orderId: "code",
  networkPayoutId: "code",
  settledBy: "code",
  amount: "money",
  eligible: "money",
  matchedGross: "money",
  withheld: "flag",
  createdAt: "instant",
  windowFrom: "instant",
  lastSeenInReportAt: "instant",
  recordedAt: "instant",
  status: "orderStatus",
};

const fact = (
  key: string,
  kind: Kind,
  value: ReviewFact["value"],
  detail: string | null = null,
): ReviewFact => ({ key, kind, value, detail });

function plainValue(value: unknown): ReviewFact["value"] {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number"))
    return value.join(", ");
  return JSON.stringify(value);
}

/** The network's status in the order vocabulary staff know (EXPERIENCE.md status registry); null for one no map knows. */
const ORDER_STATE: Readonly<Record<NetworkStatus, string | null>> = {
  AWAITING: "AWAITING_APPROVAL",
  APPROVED: "APPROVED",
  CANCELLED: "REJECTED",
  UNKNOWN: null,
};

/**
 * The row's status as the order vocabulary, with the network's own words kept as a detail. A network
 * without an order-level status (AccessTrade) has one per item; one shared by every item is the row's.
 */
function statusFact(row: {
  readonly orderStatus: NetworkStatus | null;
  readonly rawOrderStatus: string | null;
  readonly items: readonly { readonly status: NetworkStatus; readonly rawStatus: string }[];
}): ReviewFact {
  const itemStates = [...new Set(row.items.map((i) => i.status))];
  const status = row.orderStatus ?? (itemStates.length === 1 ? (itemStates[0] ?? null) : null);
  const raw =
    row.rawOrderStatus ??
    ([...new Set(row.items.map((i) => i.rawStatus).filter((r) => r !== ""))].join(", ") || null);
  return fact("networkStatus", "orderStatus", status === null ? null : ORDER_STATE[status], raw);
}

/** The facts of a report row the case carries, in reading order; null when the JSON holds none. */
function reportFacts(json: string, network: ReviewCaseDetail["network"]): ReviewFact[] | null {
  const row = storedRow(json, network);
  if (row === null) return null;
  const extra = parseStored(json) as { unmatchedRequest?: unknown };
  const values = row.items.flatMap((i) => (i.value === null ? [] : [i.value]));
  const parts = row.items.flatMap((i) => i.commissionParts);
  const facts = [
    fact("orderId", "code", row.orderId === "" ? null : row.orderId),
    statusFact(row),
    fact("purchasedAt", "instant", row.purchasedAt),
    ...row.subIds.flatMap((id, i) => (id.trim() === "" ? [] : [fact(`subId${i + 1}`, "code", id)])),
    ...(typeof extra.unmatchedRequest === "string"
      ? [fact("unmatchedRequest", "code", extra.unmatchedRequest)]
      : []),
    fact("itemCount", "text", row.items.length),
    fact("orderValue", "money", values.length === 0 ? null : sumDong(values, "order value")),
    fact(
      "reportedCommission",
      "money",
      parts.length === 0 ? null : sumDong(parts, "reported commission"),
    ),
  ];
  return row.problems.length === 0
    ? facts
    : [...facts, fact("problems", "reasons", row.problems.join(","))];
}

function otherFacts(json: string): ReviewFact[] {
  const parsed = parseStored(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>).map(([key, value]) =>
    fact(key, FACT_KIND[key] ?? (typeof value === "boolean" ? "flag" : "text"), plainValue(value)),
  );
}

/** The rule's candidates, each resolved to its survivor; never the guest account (D5), whose orders earn nothing. */
function candidatesOf(db: LedgerDb, json: string): ReviewCaseDetail["candidates"] {
  const resolved = caseCandidates(json).flatMap((id) => {
    const found = customerKeys(db, id);
    return found === null || found.customer.role === "HOUSE" ? [] : [found];
  });
  const unique = resolved.filter(
    (r, i) => resolved.findIndex((o) => o.customer.customerId === r.customer.customerId) === i,
  );
  const cards = customerCardsOf(
    db,
    unique.map((r) => r.customer.customerId),
  );
  return unique.map(({ customer, keys }) => {
    const card = cards.get(customer.customerId);
    const recentOrders = recentOrdersOf(db, keys, RECENT_ORDERS).map((o) => ({
      ...o,
      productImageUrl: httpsImageUrl(o.productImageUrl),
    }));
    return {
      customerId: customer.customerId,
      customerCode: card?.customerCode ?? null,
      customerName: card?.displayName ?? null,
      recentOrders,
    };
  });
}

/** The panel's view of one case, or null when there is no such case. */
export function reviewCaseDetail(db: LedgerDb, caseId: number): ReviewCaseDetail | null {
  const c = db.select().from(reviewCases).where(eq(reviewCases.caseId, caseId)).get();
  if (c === undefined) return null;
  const stored =
    c.orderId === null && c.subject.startsWith("payout:")
      ? null
      : findOrder(db, c.orderId ?? c.subject);
  const order =
    stored === null
      ? null
      : {
          status: stored.status,
          customerCode: stored.customerId === null ? null : customerCodeOf(db, stored.customerId),
          cashback: stored.cashback,
        };
  return {
    caseId: c.caseId,
    network: c.network,
    subject: c.subject,
    orderId: c.orderId,
    reason: c.reason,
    status: c.status,
    resolution: c.resolution,
    openedAt: c.openedAt,
    resolvedAt: c.resolvedAt,
    resolutionReason: c.resolutionReason,
    order,
    facts: reportFacts(c.observation, c.network) ?? otherFacts(c.observation),
    candidates: candidatesOf(db, c.candidates),
    applicable: c.status === "OPEN" && !SETTLEMENT_CASE_REASONS.includes(c.reason),
    frozen: stored?.status === "FROZEN",
  };
}
