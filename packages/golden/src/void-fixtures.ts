/**
 * Payout void fixtures (AD-9, D41, NFR-1; Story 4.10): the four combinations of a void, each as
 * the steps that build a recorded payout on a migrated ledger and what the void must leave behind:
 * every covered order's state and paid_at, its bonuses, the ledger entries the void writes (offsets
 * and credits back), each
 * clawback's open amount and the customer's payable balance. The server's payouts module runs them
 * (apps/server/tests/payout-void.test.ts); this package only holds the data.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type VoidStep =
  /** A Shopee report row approving the order with these commission parts. */
  | { readonly step: "approve"; readonly orderId: string; readonly parts: readonly number[] }
  /** A confirmed campaign bonus on the order. */
  | { readonly step: "bonus"; readonly orderId: string; readonly amount: number }
  /** An older PAID order of the customer with an open clawback of this amount. */
  | { readonly step: "clawback"; readonly orderId: string; readonly amount: number }
  /** A cancel row for the order, applied by reconciliation at this point. */
  | { readonly step: "cancel"; readonly orderId: string }
  | { readonly step: "claim" }
  | { readonly step: "confirm" };

export interface VoidCase {
  name: string;
  story: string;
  /** 1, 2, 3, 4 are the combinations of D41; 5 is a clawback a later payout already netted. */
  combination: 1 | 2 | 3 | 4 | 5;
  /** Which confirmed payout of the steps is voided, from 1; the last one when absent. */
  voidPayout?: number;
  steps: VoidStep[];
  expected: {
    /** Before the void: what the payout transferred and netted. */
    payout: { amount: number; netted: number };
    orders: { orderId: string; status: string; paidAt: null }[];
    awards: { orderId: string; status: string }[];
    /** The OFFSET entries the void writes, in order. */
    offsets: { clawbackId: string; amount: number }[];
    /** The NETTING_REFUND credits the void writes, in order. */
    refunds: { clawbackId: string; amount: number }[];
    clawbackOpen: Record<string, number>;
    payable: number;
  };
}

export interface VoidFixtureFile {
  rule: "voidPayout";
  source: string;
  cases: VoidCase[];
}

export const VOID_FIXTURE = fileURLToPath(new URL("../fixtures/payouts/void.json", import.meta.url));

export function loadVoidFixtures(path: string = VOID_FIXTURE): VoidFixtureFile {
  return JSON.parse(readFileSync(path, "utf8")) as VoidFixtureFile;
}
