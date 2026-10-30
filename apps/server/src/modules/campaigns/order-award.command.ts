/**
 * The campaigns side of an order's transition (AD-1, D35, D41, D55, status-flows.md section 5):
 * the orders module's `OrderAwardsPort`, bound to the command's transaction. Approval confirms
 * a held award; REJECTED and REVERSED void every award not yet paid; payout confirm pays the
 * confirmed ones, and a payout void returns them to CONFIRMED. FROZEN only suspends: the award
 * keeps its slot and state, and is out of every payable total because its order is FROZEN, so
 * suspending and resuming write nothing. Each move that changes a row writes one audit entry.
 */
import type { Clock } from "@cashback/core";
import { sumDong } from "@cashback/money";
import { and, eq, inArray } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import type { AwardMove, OrderAwardsPort } from "../orders/index";
import { campaignAwards, type CampaignAwardRow } from "./schema";

type AwardStatus = CampaignAwardRow["status"];

interface Move {
  readonly from: readonly AwardStatus[];
  readonly to: AwardStatus;
  readonly event: string;
  readonly stamp: (at: string) => Partial<CampaignAwardRow>;
}

const MOVES: Partial<Record<AwardMove, Move>> = {
  CONFIRMED: { from: ["HELD", "PAID"], to: "CONFIRMED", event: "confirmed", stamp: (at) => ({ confirmedAt: at, paidAt: null }) },
  VOID: { from: ["HELD", "CONFIRMED"], to: "VOID", event: "voided", stamp: (at) => ({ voidedAt: at }) },
  PAID: { from: ["CONFIRMED"], to: "PAID", event: "paid", stamp: (at) => ({ paidAt: at }) },
};

export function paidBonusOn(db: LedgerDb, orderId: string): number {
  const rows = db.select({ amount: campaignAwards.amount }).from(campaignAwards).where(and(eq(campaignAwards.orderId, orderId), eq(campaignAwards.status, "PAID"))).all();
  return sumDong(rows.map((r) => r.amount), "bonus");
}

export function moveAwards(db: LedgerDb, clock: Clock, orderId: string, to: AwardMove, by: CommandAudit): number {
  const move = MOVES[to];
  if (move === undefined) return 0;
  const result = db
    .update(campaignAwards)
    .set({ status: move.to, ...move.stamp(clock.now()) })
    .where(and(eq(campaignAwards.orderId, orderId), inArray(campaignAwards.status, [...move.from])))
    .run();
  if (result.changes > 0) by.audit.record({ actor: by.actor, event: `campaigns.award.${move.event}`, entityId: orderId, payload: { orderId, awards: result.changes } });
  return result.changes;
}

/**
 * Pays the named CONFIRMED awards of a payout (Story 4.8): the awards on a covered order are paid
 * by its transition already; this pays any other award the payout's snapshot covers, by id.
 * Returns how many of the named awards are PAID afterwards, so confirm can check them all.
 */
export function payAwards(db: LedgerDb, clock: Clock, awardIds: readonly number[], by: CommandAudit): number {
  if (awardIds.length === 0) return 0;
  const ids = [...awardIds];
  const result = db
    .update(campaignAwards)
    .set({ status: "PAID", paidAt: clock.now() })
    .where(and(inArray(campaignAwards.awardId, ids), eq(campaignAwards.status, "CONFIRMED")))
    .run();
  if (result.changes > 0) by.audit.record({ actor: by.actor, event: "campaigns.award.paid", entityId: ids.join(","), payload: { awards: result.changes } });
  return db.select({ awardId: campaignAwards.awardId }).from(campaignAwards).where(and(inArray(campaignAwards.awardId, ids), eq(campaignAwards.status, "PAID"))).all().length;
}

/** The orders port bound to one transaction's handle. */
export function orderAwardsFor(db: LedgerDb, clock: Clock, by: CommandAudit): OrderAwardsPort {
  return { paidBonus: (orderId) => paidBonusOn(db, orderId), move: (orderId, to) => void moveAwards(db, clock, orderId, to, by) };
}
