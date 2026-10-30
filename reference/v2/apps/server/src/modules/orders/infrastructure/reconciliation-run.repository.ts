import type { Db } from "../../../shared/database/connection";
import { reconciliationRuns } from "../../../shared/database/schema";

/** One line per reconciliation pass, with its counts. */
export interface ReconciliationRun {
  ranAt: string;
  source: string;
  periodStart: string | null;
  periodEnd: string | null;
  rowsRead: number;
  ordersNew: number;
  approved: number;
  rejected: number;
  skipped: number;
  needsReview: number;
  error: string | null;
}

export function logRun(db: Db, run: ReconciliationRun): void {
  db.insert(reconciliationRuns).values(run).run();
}

export function lastRun(db: Db) {
  return db.select().from(reconciliationRuns).orderBy(reconciliationRuns.id).all().at(-1) ?? null;
}
