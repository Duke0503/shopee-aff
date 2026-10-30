import { eq, sql } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { payoutBatches } from "../../../shared/database/schema";
import { paginationMeta, type Page } from "./pagination";

/** The platform payout batches we have imported, newest first. */
export interface PayoutBatchesQuery extends Page {
  platform: string;
}

export interface PayoutBatchRow {
  batchId: string;
  platform: string;
  status: string;
  amountVnd: number;
  eligibleAmountVnd: number;
  createdTime: string | null;
  paidTime: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listPayoutBatches(
  db: Db,
  query: PayoutBatchesQuery,
): { batches: PayoutBatchRow[]; pagination: ReturnType<typeof paginationMeta> } {
  const where = query.platform !== "all" ? eq(payoutBatches.platform, query.platform) : undefined;
  const total =
    db.select({ n: sql<number>`count(*)` }).from(payoutBatches).where(where).get()?.n ?? 0;

  const batches = db
    .select({
      batchId: payoutBatches.batchId,
      platform: payoutBatches.platform,
      status: payoutBatches.status,
      amountVnd: payoutBatches.amount,
      eligibleAmountVnd: payoutBatches.eligibleAmount,
      createdTime: payoutBatches.createdTime,
      paidTime: payoutBatches.paidTime,
      createdAt: payoutBatches.createdAt,
      updatedAt: payoutBatches.updatedAt,
    })
    .from(payoutBatches)
    .where(where)
    .orderBy(sql`${payoutBatches.createdAt} desc`)
    .limit(query.limit)
    .offset(query.offset)
    .all();

  return { batches, pagination: paginationMeta(query, total) };
}
