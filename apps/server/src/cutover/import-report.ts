/**
 * The import report (AD-24, D45): what the owner reads before signing off the cutover. It lists
 * every value that fit no time rule (table, key, column; the value is never written), counts
 * approximate times, compares every imported id row by row with the source, and names any row
 * the import could not take. Bank accounts appear only by their last four digits. For orders it
 * shows the paid parity per customer (D44) and every stored cashback the new split would compute
 * differently (kept as stored, D34); for links the requests still queued; for notifications the
 * keys seeded as already sent (D46) and the ones the live system had not sent yet.
 */

export interface TimeProblem {
  table: string;
  key: string;
  column: string;
}

export interface ReportNote {
  kind:
    | "alias_target_missing"
    | "bank_account_incomplete"
    | "bank_consent_missing"
    | "customer_id_not_alphanumeric"
    | "unknown_customer_role"
    | "unknown_customer_status"
    | "order_customer_missing"
    | "order_customer_via_alias"
    | "order_request_missing"
    | "unknown_order_status"
    | "unknown_platform"
    | "paid_at_status_conflict"
    | "paid_at_missing"
    | "paid_cashback_missing"
    | "house_cashback_zeroed"
    | "amount_not_whole_dong"
    | "link_customer_missing"
    | "link_customer_via_alias"
    | "unknown_link_status"
    | "expired_without_link"
    | "share_code_invalid"
    | "rate_not_whole_bps"
    | "estimate_unreadable"
    | "unknown_notified_status"
    | "notification_key_invalid";
  table: string;
  key: string;
  /** Never personal data: a last four, a status value, a column name. */
  detail?: string;
}

/**
 * Rows the report already names as not importable, or imported with a known gap, per compared
 * table: the row-by-row comparison skips them instead of listing them a second time.
 */
export const COMPARISON_SKIPS = {
  customer_aliases: ["alias_target_missing"],
  orders: ["order_customer_missing", "order_customer_via_alias", "amount_not_whole_dong"],
  link_requests: ["link_customer_missing", "link_customer_via_alias"],
  share_codes: ["link_customer_missing", "share_code_invalid"],
} as const satisfies Record<string, readonly ReportNote["kind"][]>;

/** The keys of rows `table` skips, from the notes. */
export function skippedKeys(notes: readonly ReportNote[], table: keyof typeof COMPARISON_SKIPS): Set<string> {
  const kinds: readonly string[] = COMPARISON_SKIPS[table];
  return new Set(notes.filter((n) => kinds.includes(n.kind)).map((n) => n.key));
}

export interface TableComparison {
  source: number;
  imported: number;
  /** Source keys whose row in the new ledger differs or is missing, with the field. */
  mismatches: { key: string; field: string }[];
}

/** Two live rows that would share one value the new schema keeps unique (after normalisation). */
export interface DuplicateIdentity {
  column: "zalo_user_id" | "customer_code";
  /** The customer ids of the rows sharing it. */
  keys: string[];
}

/** A live value changed by normalisation; Zalo ids are personal data, so only codes show values. */
export interface NormalisedValue {
  table: "customers";
  key: string;
  column: "customer_code" | "zalo_user_id";
  from?: string;
  to?: string;
}

export interface PaidParity {
  /** "pass" only when every customer's paid total matches the live one to the dong. */
  result: "pass" | "fail";
  /** Customers compared (guests excluded: they are never paid, D5). */
  customers: number;
  mismatches: { customerId: string; live: number; imported: number }[];
}

export interface OrdersSection {
  imported: number;
  byStatus: Record<string, number>;
  settlementPeriods: number;
  paidParity: PaidParity;
  /** Stored cashback kept although the FR-13 split gives another amount (D34). */
  cashbackDifferences: { orderId: string; stored: number; newSplit: number }[];
  /**
   * Live orders whose paid time and paid status disagree. Each counts as paid on both sides of
   * parity (D4), so it does not fail parity by itself; the owner signs each one off.
   */
  paidStatusConflicts: PaidStatusConflict[];
}

export interface PaidStatusConflict {
  orderId: string;
  kind: "paid_at_without_paid_status" | "paid_status_without_paid_at";
  liveStatus: string;
}

export interface LinksSection {
  imported: number;
  byStatus: Record<string, number>;
  /** Live requests still waiting for their link, imported as QUEUED (Story 2.5 AC3). */
  queued: string[];
  shareCodes: number;
  productOffers: number;
  /** Where each request's product name came from (D56). */
  snapshots: Record<"estimate" | "product_cache" | "none", number>;
}

export interface NotificationsSection {
  /** Keys of events the live system already told, stored as sent (D46). */
  seeded: number;
  seededByEvent: Record<string, number>;
  /** Unsent live notifications: imported as due (none in this release) or listed here. */
  importedAsDue: number;
  listed: string[];
}

export interface ImportOutcome {
  ok: boolean;
  /** The refusal or failure code, null on success. */
  reason: string | null;
  error: string | null;
}

export interface ImportReport {
  outcome: ImportOutcome;
  timeProblems: TimeProblem[];
  duplicates: DuplicateIdentity[];
  normalised: NormalisedValue[];
  /** Per `table.column`: values converted but flagged approximate. */
  approximate: Record<string, number>;
  notes: ReportNote[];
  comparison: Record<string, TableComparison>;
  counter: { liveCounterLast: number; highestAliasCode: string | null; importedCounterLast: number; nextCode: string } | null;
  bankAccounts: { imported: number; lastFour: string[] };
  orders: OrdersSection | null;
  links: LinksSection | null;
  notifications: NotificationsSection | null;
}

export function emptyReport(): ImportReport {
  return {
    outcome: { ok: false, reason: "not_finished", error: null },
    timeProblems: [],
    duplicates: [],
    normalised: [],
    approximate: {},
    notes: [],
    comparison: {},
    counter: null,
    bankAccounts: { imported: 0, lastFour: [] },
    orders: null,
    links: null,
    notifications: null,
  };
}
