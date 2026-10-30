/**
 * The import report (AD-24, D45): what the owner reads before signing off the cutover. It lists
 * every value that fit no time rule (table, key, column; the value is never written), counts
 * approximate times, compares every imported id row by row with the source, and names any row
 * the import could not take. Bank accounts appear only by their last four digits.
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
    | "unknown_customer_status";
  table: string;
  key: string;
  /** Never personal data: a last four, a status value, a column name. */
  detail?: string;
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
  };
}
