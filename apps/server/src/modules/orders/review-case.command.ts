/**
 * Opening review cases (AD-7, AD-8, FR-14, status-flows.md §6; Story 3.5), inside the caller's
 * transaction. A case is the system declining to guess: it carries the report row, its
 * fingerprint and the candidates the rules produced, and never changes money or an order itself.
 *
 * One case is OPEN per (network, subject, reason). A later run that meets the same reason again
 * refreshes that case's evidence when the row or the candidates changed, and writes nothing when
 * they did not, so an hourly run over the same report leaves the cases as they are. Opening and
 * refreshing each write one audit entry (ids and counts only, AD-17).
 */
import type { Instant } from "@cashback/core";
import type { AffiliateNetwork } from "@cashback/money";
import { and, eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import type { ReviewCaseReason } from "./domain/transition";
import { reviewCases } from "./schema";

/**
 * Every reason a case opens with: the transition's (D31 freeze reasons, D55 drops, cancels after
 * approval or payout), attribution's (D58), a row whose order id belongs to another network, and
 * an awaiting order the report has not shown for 14 days (R5, D43), and a wrong rejection staff
 * reported (D38, Story 3.9), and a network payout that did not match its orders to the dong or
 * listed an order another payout already settled (D59, Story 4.21).
 */
export type CaseReason = ReviewCaseReason | "network_mismatch" | "not_seen_in_report" | "wrong_rejection" | SettlementCaseReason;

export type SettlementCaseReason = "settlement_mismatch" | "settlement_conflict" | "settlement_not_approved" | "settlement_facts_changed";
/** The reasons of network payout cases: they change no order, so they are only ever dismissed. */
export const SETTLEMENT_CASE_REASONS: readonly string[] = ["settlement_mismatch", "settlement_conflict", "settlement_not_approved", "settlement_facts_changed"] satisfies readonly SettlementCaseReason[];

export interface CaseEvidence {
  readonly network: AffiliateNetwork;
  /** The report's order id, or `#<fingerprint>` for a row without one. */
  readonly subject: string;
  /** Set only when an order is recorded under the subject. */
  readonly orderId: string | null;
  readonly reason: CaseReason;
  /** Customer ids the rules produced; staff choose no other (Story 3.9). */
  readonly candidates: readonly string[];
  /** The normalized row (or the aging facts) as JSON. */
  readonly observation: string;
  /** The report row's fingerprint; null when no row opened the case. */
  readonly fingerprint: string | null;
}

export type CaseWrite = {
  readonly write: "opened" | "refreshed" | "unchanged";
  readonly caseId: number;
};

export interface CaseWriters {
  readonly by: CommandAudit;
  readonly at: Instant;
}

function openCase(db: LedgerDb, e: CaseEvidence, w: CaseWriters): number {
  return db
    .insert(reviewCases)
    .values({
      ...e,
      candidates: JSON.stringify(e.candidates),
      status: "OPEN",
      openedAt: w.at,
      openedBy: w.by.actor.id,
    })
    .returning({ caseId: reviewCases.caseId })
    .get().caseId;
}

/** Opens the case, or refreshes the evidence of the one already OPEN for the same network, subject and reason. */
export function openOrRefreshCase(db: LedgerDb, e: CaseEvidence, w: CaseWriters): CaseWrite {
  const open = db
    .select()
    .from(reviewCases)
    .where(and(eq(reviewCases.network, e.network), eq(reviewCases.subject, e.subject), eq(reviewCases.reason, e.reason), eq(reviewCases.status, "OPEN")))
    .get();
  const payload = {
    network: e.network,
    reason: e.reason,
    orderId: e.orderId,
    candidates: e.candidates.length,
  };
  if (open === undefined) {
    const caseId = openCase(db, e, w);
    w.by.audit.record({
      actor: w.by.actor,
      event: "orders.review_case.opened",
      entityId: String(caseId),
      payload: { caseId, ...payload },
    });
    return { write: "opened", caseId };
  }
  const candidates = JSON.stringify(e.candidates);
  const orderId = open.orderId ?? e.orderId;
  if (open.observation === e.observation && open.fingerprint === e.fingerprint && open.candidates === candidates && open.orderId === orderId) return { write: "unchanged", caseId: open.caseId };
  db.update(reviewCases)
    .set({
      observation: e.observation,
      fingerprint: e.fingerprint,
      candidates,
      orderId,
      refreshedAt: w.at,
    })
    .where(eq(reviewCases.caseId, open.caseId))
    .run();
  w.by.audit.record({
    actor: w.by.actor,
    event: "orders.review_case.refreshed",
    entityId: String(open.caseId),
    payload: { caseId: open.caseId, ...payload },
  });
  return { write: "refreshed", caseId: open.caseId };
}

/**
 * Resolves the OPEN case of an order for one reason as the system, with an outcome that names why
 * (`seen_again`); used only where the condition that opened the case is gone by itself. The
 * resolution is DISMISSED: nothing about the order or its money changes (status-flows.md §6).
 */
export function resolveOpenCase(db: LedgerDb, orderId: string, reason: CaseReason, outcome: string, w: CaseWriters): number | null {
  const open = db
    .select({ caseId: reviewCases.caseId, network: reviewCases.network })
    .from(reviewCases)
    .where(and(eq(reviewCases.orderId, orderId), eq(reviewCases.reason, reason), eq(reviewCases.status, "OPEN")))
    .get();
  if (open === undefined) return null;
  db.update(reviewCases).set({ status: "RESOLVED", resolution: "DISMISSED", resolvedAt: w.at, resolvedBy: w.by.actor.id, resolutionReason: outcome }).where(eq(reviewCases.caseId, open.caseId)).run();
  w.by.audit.record({ actor: w.by.actor, event: "orders.review_case.resolved", entityId: String(open.caseId), payload: { caseId: open.caseId, network: open.network, reason, orderId, outcome } });
  return open.caseId;
}

/**
 * Whether staff already resolved a case of this network, subject and reason opened from exactly
 * these facts (`fingerprint`): a source that repeats the same facts every run must not reopen a
 * case staff dismissed; new facts open a new one (Story 4.21).
 */
export function caseResolvedWith(db: LedgerDb, e: Pick<CaseEvidence, "network" | "subject" | "reason"> & { readonly fingerprint: string }): boolean {
  const found = db
    .select({ caseId: reviewCases.caseId })
    .from(reviewCases)
    .where(and(eq(reviewCases.network, e.network), eq(reviewCases.subject, e.subject), eq(reviewCases.reason, e.reason), eq(reviewCases.status, "RESOLVED"), eq(reviewCases.fingerprint, e.fingerprint)))
    .get();
  return found !== undefined;
}
