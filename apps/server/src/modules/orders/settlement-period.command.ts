/**
 * Settlement periods (D54, D59, FR-13, AD-5; Story 3.4, the admin screen is Story 4.18). An order's
 * period is its network and the Vietnam month of its approval. A Shopee approval takes the
 * withholding of the network's latest payout batch unless staff marked the period (the override),
 * withheld when neither is known; an AccessTrade period is always withheld (`@cashback/money`'s network
 * rules, through domain/settlement.ts). A mark changes only what later approvals read: cashback already stored is never
 * recomputed, so an order approved before the mark keeps its amount.
 */
import { NETWORK_MONEY_RULES, type AffiliateNetwork } from "@cashback/money";
import { and, eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { periodIsWithheld } from "./domain/settlement";
import { latestWithholding } from "./order-settlement.command";
import { settlementPeriods } from "./schema";

const PERIOD_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type WithholdingSource = "ALWAYS" | "STAFF" | "NETWORK" | "DEFAULT";

export interface PeriodWithholding {
  readonly withheld: boolean;
  readonly source: WithholdingSource;
  /** The batch the estimate comes from, for source NETWORK. */
  readonly networkPayoutId: string | null;
}

/**
 * The withholding an approval in this period takes now (D54, D59): AccessTrade always; else a
 * staff mark on the period (the owner's override); else the network's latest payout batch, read
 * from what it paid (the estimate until the batch that settles the order says); else withheld.
 * A cutover row is no staff mark: the live system withheld every period by rule, not by reading.
 */
export function periodWithholding(db: LedgerDb, network: AffiliateNetwork, periodMonth: string): PeriodWithholding {
  if (NETWORK_MONEY_RULES[network].alwaysWithheld) return { withheld: true, source: "ALWAYS", networkPayoutId: null };
  const mark = db
    .select({ withheld: settlementPeriods.withheld })
    .from(settlementPeriods)
    .where(and(eq(settlementPeriods.network, network), eq(settlementPeriods.periodMonth, periodMonth), eq(settlementPeriods.origin, "STAFF")))
    .get();
  if (mark !== undefined) return { withheld: periodIsWithheld(network, mark.withheld), source: "STAFF", networkPayoutId: null };
  const latest = latestWithholding(db, network);
  if (latest !== null) return { withheld: latest.withheld, source: "NETWORK", networkPayoutId: latest.networkPayoutId };
  return { withheld: periodIsWithheld(network, null), source: "DEFAULT", networkPayoutId: null };
}

/** Whether an approval in this period withholds the 10% tax now. */
export function periodWithheld(db: LedgerDb, network: AffiliateNetwork, periodMonth: string): boolean {
  return periodWithholding(db, network, periodMonth).withheld;
}

export type SettlementPeriodErrorCode = "invalid_period" | "always_withheld";

export class SettlementPeriodError extends Error {
  constructor(
    readonly code: SettlementPeriodErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SettlementPeriodError";
  }
}

export interface SettlementPeriodMark {
  readonly network: AffiliateNetwork;
  readonly periodMonth: string;
  readonly withheld: boolean;
}

/** Staff mark a period withheld or not; call inside `tx`. Orders already approved keep their cashback. */
export function markSettlementPeriod(db: LedgerDb, mark: SettlementPeriodMark, by: CommandAudit): void {
  if (!PERIOD_MONTH.test(mark.periodMonth)) throw new SettlementPeriodError("invalid_period", `not a YYYY-MM month: ${mark.periodMonth}`);
  if (!mark.withheld && NETWORK_MONEY_RULES[mark.network].alwaysWithheld) {
    throw new SettlementPeriodError("always_withheld", `${mark.network} always withholds the tax; its periods cannot be unmarked`);
  }
  db.insert(settlementPeriods)
    .values({ network: mark.network, periodMonth: mark.periodMonth, withheld: mark.withheld, origin: "STAFF" })
    .onConflictDoUpdate({ target: [settlementPeriods.network, settlementPeriods.periodMonth], set: { withheld: mark.withheld, origin: "STAFF" } })
    .run();
  by.audit.record({ actor: by.actor, event: "orders.settlement_period.marked", entityId: `${mark.network}:${mark.periodMonth}`, payload: { network: mark.network, periodMonth: mark.periodMonth, withheld: mark.withheld } });
}
