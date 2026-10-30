/**
 * The status registry (AD-10, FR-38, code.md §8). Every status of
 * `docs/operations/status-flows.md`, in lifecycle order, with its tone, label key,
 * customer message key and allowed transitions. Screens, chat and exports read it;
 * none defines its own status text, order or meaning. A test parses status-flows.md and
 * fails when the two differ, so a status changes in the document first.
 *
 * Label keys point into `packages/labels/vi/status.json` and customer message keys into
 * `packages/labels/vi/messages.json` (D57); the text itself never lives in code. Only
 * order statuses carry a message key: status-flows.md gives a customer sentence for
 * those alone.
 */

export const TONES = ["waiting", "approved", "done", "attention", "rejected", "neutral"] as const;
export type Tone = (typeof TONES)[number];

export interface StatusDefinition<V extends string = string> {
  readonly value: V;
  /** Position in the lifecycle, from 1; this is the sort order and the chip order. */
  readonly order: number;
  readonly tone: Tone;
  readonly labelKey: string;
  readonly messageKey: string | null;
  /** Set for a timed state that is computed from a stored column and never stored itself. */
  readonly derivedFrom: string | null;
}

export interface EntityDefinition<V extends string = string> {
  readonly statuses: readonly StatusDefinition<V>[];
  readonly initial: readonly V[];
  readonly transitions: readonly (readonly [from: V, to: V])[];
  /** For an entity whose state is computed from other rows instead of a status column. */
  readonly derivedFrom: string | null;
}

interface StatusRow<V extends string> {
  value: V;
  tone: Tone;
  labelKey: string;
  messageKey?: string;
  derivedFrom?: string;
}

interface EntitySpec<V extends string> {
  statuses: readonly StatusRow<V>[];
  initial: readonly V[];
  transitions: readonly (readonly [V, V])[];
  derivedFrom?: string;
}

function define<const V extends string>(spec: EntitySpec<V>): EntityDefinition<V> {
  return {
    statuses: spec.statuses.map((row, i) => ({
      value: row.value,
      order: i + 1,
      tone: row.tone,
      labelKey: row.labelKey,
      messageKey: row.messageKey ?? null,
      derivedFrom: row.derivedFrom ?? null,
    })),
    initial: spec.initial,
    transitions: spec.transitions,
    derivedFrom: spec.derivedFrom ?? null,
  };
}

const order = define({
  statuses: [
    { value: "AWAITING_APPROVAL", tone: "waiting", labelKey: "status_awaiting_approval", messageKey: "order_recorded" },
    { value: "FROZEN", tone: "attention", labelKey: "status_frozen", messageKey: "order_frozen" },
    { value: "APPROVED", tone: "approved", labelKey: "status_approved", messageKey: "order_approved" },
    { value: "REVERSED", tone: "rejected", labelKey: "status_reversed", messageKey: "order_reversed" },
    { value: "PAID", tone: "done", labelKey: "status_paid", messageKey: "order_paid" },
    { value: "REJECTED", tone: "rejected", labelKey: "status_rejected", messageKey: "order_rejected" },
  ],
  initial: ["AWAITING_APPROVAL"],
  transitions: [
    ["AWAITING_APPROVAL", "APPROVED"],
    ["AWAITING_APPROVAL", "REJECTED"],
    ["AWAITING_APPROVAL", "FROZEN"],
    ["APPROVED", "FROZEN"],
    ["FROZEN", "AWAITING_APPROVAL"],
    ["FROZEN", "APPROVED"],
    ["FROZEN", "REJECTED"],
    ["REJECTED", "AWAITING_APPROVAL"],
    ["APPROVED", "REVERSED"],
    ["APPROVED", "PAID"],
    ["PAID", "APPROVED"],
    ["PAID", "REVERSED"],
  ],
});

/** A clawback has no status column: it is open while the sum of its ledger entries is below 0. */
const clawback = define<never>({ statuses: [], initial: [], transitions: [], derivedFrom: "ledger_entries" });

const linkRequest = define({
  statuses: [
    { value: "QUEUED", tone: "neutral", labelKey: "status_link_request_queued" },
    { value: "ISSUED", tone: "approved", labelKey: "status_link_request_issued" },
    { value: "DELIVERED", tone: "approved", labelKey: "status_link_request_delivered" },
    { value: "CONVERTED", tone: "done", labelKey: "status_link_request_converted" },
    { value: "FAILED", tone: "rejected", labelKey: "status_link_request_failed" },
  ],
  initial: ["QUEUED"],
  transitions: [
    ["QUEUED", "ISSUED"],
    ["ISSUED", "DELIVERED"],
    ["DELIVERED", "CONVERTED"],
    ["QUEUED", "FAILED"],
  ],
});

const payoutClaim = define({
  statuses: [
    { value: "OPEN", tone: "waiting", labelKey: "status_payout_claim_open" },
    { value: "CONFIRMED", tone: "done", labelKey: "status_payout_claim_confirmed" },
    { value: "ABANDONED", tone: "neutral", labelKey: "status_payout_claim_abandoned" },
  ],
  initial: ["OPEN"],
  transitions: [
    ["OPEN", "CONFIRMED"],
    ["OPEN", "ABANDONED"],
    ["ABANDONED", "CONFIRMED"],
  ],
});

const payout = define({
  statuses: [
    { value: "RECORDED", tone: "done", labelKey: "status_payout_recorded" },
    { value: "VOIDED", tone: "rejected", labelKey: "status_payout_voided" },
  ],
  initial: ["RECORDED"],
  transitions: [["RECORDED", "VOIDED"]],
});

const campaignAward = define({
  statuses: [
    { value: "HELD", tone: "waiting", labelKey: "status_campaign_award_held" },
    { value: "CONFIRMED", tone: "approved", labelKey: "status_campaign_award_confirmed" },
    { value: "PAID", tone: "done", labelKey: "status_campaign_award_paid" },
    { value: "VOID", tone: "rejected", labelKey: "status_campaign_award_void" },
  ],
  initial: ["HELD"],
  transitions: [
    ["HELD", "CONFIRMED"],
    ["CONFIRMED", "PAID"],
    ["HELD", "VOID"],
    ["CONFIRMED", "VOID"],
    ["PAID", "CONFIRMED"],
    ["PAID", "VOID"],
  ],
});

const reviewCase = define({
  statuses: [
    { value: "OPEN", tone: "attention", labelKey: "status_review_case_open" },
    { value: "RESOLVED", tone: "done", labelKey: "status_review_case_resolved" },
  ],
  initial: ["OPEN"],
  transitions: [["OPEN", "RESOLVED"]],
});

const networkSettlement = define({
  statuses: [
    { value: "PROCESSING", tone: "waiting", labelKey: "status_network_settlement_processing" },
    { value: "PAID", tone: "done", labelKey: "status_network_settlement_paid" },
    { value: "FAILED", tone: "rejected", labelKey: "status_network_settlement_failed" },
  ],
  initial: ["PROCESSING"],
  transitions: [
    ["PROCESSING", "PAID"],
    ["PROCESSING", "FAILED"],
  ],
});

const customer = define({
  statuses: [
    { value: "ACTIVE", tone: "approved", labelKey: "status_customer_active" },
    { value: "LOCKED", tone: "waiting", labelKey: "status_customer_locked", derivedFrom: "locked_until" },
    { value: "DISABLED", tone: "neutral", labelKey: "status_customer_disabled" },
    { value: "MERGED", tone: "neutral", labelKey: "status_customer_merged" },
    { value: "ERASED", tone: "neutral", labelKey: "status_customer_erased" },
  ],
  initial: ["ACTIVE"],
  transitions: [],
});

export const STATUS_REGISTRY = {
  order,
  clawback,
  linkRequest,
  payoutClaim,
  payout,
  campaignAward,
  reviewCase,
  networkSettlement,
  customer,
} as const;

export type StatusRegistry = typeof STATUS_REGISTRY;
export type EntityName = keyof StatusRegistry;
export type StatusOf<E extends EntityName> = StatusRegistry[E]["statuses"][number]["value"];

export type OrderStatus = StatusOf<"order">;
export type LinkRequestStatus = StatusOf<"linkRequest">;
export type PayoutClaimStatus = StatusOf<"payoutClaim">;
export type PayoutStatus = StatusOf<"payout">;
export type CampaignAwardStatus = StatusOf<"campaignAward">;
export type ReviewCaseStatus = StatusOf<"reviewCase">;
export type NetworkSettlementStatus = StatusOf<"networkSettlement">;
export type CustomerStatus = StatusOf<"customer">;
