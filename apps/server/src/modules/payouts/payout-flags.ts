/**
 * A payable customer's flags (FR-16, FR-31, FR-10, EXPERIENCE.md flag badge), the same on the
 * Payouts row and in the payout panel: no bank account, a website change held until confirmed in
 * Zalo, a bank change within 72 hours, a bank account shared with another customer (the one FR-31
 * flag of v1), and netting only (the open clawbacks reach the gross, AD-6). Any of the first four
 * moves the row to "needs action"; a flagged row is never hidden.
 */
import { ACTION_FLAGS, PAYOUT_FLAGS, type PayoutFlag, type PayoutQueue } from "@cashback/contracts";
import { parseInstant, toMs, type Instant } from "@cashback/core";

import type { BankAccountFacts } from "../identity/index";

/** A bank change this recent is flagged before anyone pays into it (FR-10). */
export const BANK_CHANGE_FLAG_MS = 72 * 3_600_000;

export interface FlagFacts {
  readonly bank: BankAccountFacts | null;
  readonly sharedFingerprints: ReadonlySet<string>;
  readonly payable: number;
  readonly gross: number;
  readonly now: Instant;
  /** The customer's personal data was erased (FR-35): what is owed stays, nothing can be paid. */
  readonly erased?: boolean;
}

export function payoutFlags(f: FlagFacts): PayoutFlag[] {
  const on = new Set<PayoutFlag>();
  if (f.bank === null) on.add("NO_BANK");
  else {
    if (f.bank.held) on.add("BANK_HELD");
    if (f.bank.changedAt !== null && toMs(parseInstant(f.bank.changedAt)) >= toMs(f.now) - BANK_CHANGE_FLAG_MS) on.add("BANK_CHANGED");
    if (f.sharedFingerprints.has(f.bank.fingerprint)) on.add("SHARED_BANK");
  }
  if (f.payable === 0 && f.gross > 0) on.add("NETTING_ONLY");
  if (f.erased === true) on.add("ERASED");
  return PAYOUT_FLAGS.filter((flag) => on.has(flag));
}

export const queueOf = (flags: readonly PayoutFlag[]): PayoutQueue => (flags.some((flag) => ACTION_FLAGS.includes(flag)) ? "ACTION" : "PAYABLE");
