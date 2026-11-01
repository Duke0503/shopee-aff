/**
 * Merge proposals after a new Zalo account is connected (FR-11, FR-36, D9, D10; Story 6.11). Zalo
 * ids differ per viewing account, so a known customer who writes to the new account is registered
 * again (only the assistant creates customers, D10) and has two records. Two signals propose a
 * pair, the newer record merged into the older one:
 *
 * - `code_claimed`: the newer record's owner wrote the older customer code in the private chat
 *   (merge-claim.command.ts). The stronger signal, though anyone can type a code.
 * - `same_name`: the newer record, registered since the account change, has the Zalo name (its
 *   stored sort key: case, spacing and tone marks as written) of exactly one older record, and no
 *   other record registered since has it. A name shared on either side proposes nothing: a guess
 *   could put one person's money in another's record.
 *
 * Both records must still be active customers. A pair named by both signals is listed once, as
 * `code_claimed`. Read only: a proposal is merged only through the admin command's preview and
 * apply (Story 4.19), never here. Two queries whatever the number of customers.
 */
import type { Instant } from "@cashback/core";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { LedgerDb } from "../../platform/db/ledger";
import { customers, mergeClaims } from "./schema";

export const MERGE_PROPOSAL_REASONS = ["code_claimed", "same_name"] as const;
export type MergeProposalReason = (typeof MERGE_PROPOSAL_REASONS)[number];

export interface MergeProposalSide {
  readonly customerId: string;
  readonly customerCode: string | null;
  readonly customerName: string | null;
}

export interface MergeProposal {
  /** The record registered under the new Zalo account. */
  readonly merged: MergeProposalSide;
  /** The older record the person had under the previous account. */
  readonly survivor: MergeProposalSide;
  readonly reason: MergeProposalReason;
}

const side = { customerId: customers.customerId, customerCode: customers.customerCode, customerName: customers.displayName, sortKey: customers.sortKey, createdAt: customers.createdAt };
const activeUser = and(eq(customers.role, "USER"), eq(customers.status, "ACTIVE"));

function claimProposals(db: LedgerDb): MergeProposal[] {
  const claimant = alias(customers, "claimant");
  const claimed = alias(customers, "claimed");
  return db
    .select({
      merged: { customerId: claimant.customerId, customerCode: claimant.customerCode, customerName: claimant.displayName },
      survivor: { customerId: claimed.customerId, customerCode: claimed.customerCode, customerName: claimed.displayName },
    })
    .from(mergeClaims)
    .innerJoin(claimant, eq(claimant.customerId, mergeClaims.claimantId))
    .innerJoin(claimed, eq(claimed.customerId, mergeClaims.claimedId))
    .where(and(eq(claimant.role, "USER"), eq(claimant.status, "ACTIVE"), eq(claimed.role, "USER"), eq(claimed.status, "ACTIVE")))
    .orderBy(mergeClaims.claimedAt, mergeClaims.claimantId)
    .all()
    .map((row) => ({ ...row, reason: "code_claimed" as const }));
}

function nameProposals(db: LedgerDb, since: Instant): MergeProposal[] {
  const isNew = sql<number>`sum(case when ${customers.createdAt} >= ${since} then 1 else 0 end)`;
  const unique = db
    .select({ sortKey: customers.sortKey })
    .from(customers)
    .where(and(activeUser, ne(customers.sortKey, "")))
    .groupBy(customers.sortKey)
    .having(and(sql`${isNew} = 1`, sql`count(*) - ${isNew} = 1`))
    .all()
    .map((r) => r.sortKey);
  if (unique.length === 0) return [];
  const rows = db.select(side).from(customers).where(and(activeUser, inArray(customers.sortKey, unique))).all();
  const strip = ({ sortKey: _key, createdAt: _at, ...rest }: (typeof rows)[number]): MergeProposalSide => rest;
  return unique.flatMap((key) => {
    const pair = rows.filter((r) => r.sortKey === key);
    const merged = pair.find((r) => r.createdAt !== null && r.createdAt >= since);
    const survivor = pair.find((r) => r !== merged);
    return merged === undefined || survivor === undefined ? [] : [{ merged: strip(merged), survivor: strip(survivor), reason: "same_name" as const }];
  });
}

/** Every proposal: the code claims, then the name matches since `since` (null: none by name). */
export function mergeProposals(db: LedgerDb, since: Instant | null): MergeProposal[] {
  const claims = claimProposals(db);
  const seen = new Set(claims.map((p) => `${p.merged.customerId}>${p.survivor.customerId}`));
  const names = since === null ? [] : nameProposals(db, since).filter((p) => !seen.has(`${p.merged.customerId}>${p.survivor.customerId}`));
  return [...claims, ...names];
}
