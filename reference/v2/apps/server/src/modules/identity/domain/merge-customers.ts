/**
 * Merging a customer who exists twice because the bot changed Zalo account.
 * Ports the decisions of `ledger/merge.py`; the actual row moves are
 * infrastructure. The row under the NEW id survives (it is the id the running
 * bot can message); the old id becomes an alias so old links and old logins
 * keep working.
 */

/** Every table that points at a customer. `campaign_awards` is NOT moved (today's behaviour). */
export const MERGE_MOVES = [
  "link_requests",
  "orders",
  "sessions",
  "activity_logs",
  "payment_transfers",
] as const;

export interface MergeRow {
  customerId: string;
  zaloUserId: string | null;
  customerCode: string | null;
  displayName: string | null;
  role: string | null;
  bankName: string | null;
  bankAccount: string | null;
  passwordHash: string | null;
  passwordSetAt: string | null;
  loginCount: number | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface MergePair {
  name: string;
  old: MergeRow;
  new: MergeRow;
  conflict: string;
}

export interface MergePlan {
  survivorId: string;
  retiredId: string;
  keepCode: string | null;
  aliases: string[];
  copyBankDetails: boolean;
  passwordFromRetired: boolean;
  loginCount: number;
  lastLoginAt: string | null;
  createdAt: string;
  moves: string[];
}

/** Anything a machine should not decide on someone's behalf. */
export function mergeConflict(retired: MergeRow, survivor: MergeRow): string {
  const bothBanks = Boolean(retired.bankAccount) && Boolean(survivor.bankAccount);
  const different =
    retired.bankAccount !== survivor.bankAccount || retired.bankName !== survivor.bankName;
  return bothBanks && different ? "two different bank accounts" : "";
}

/** Display names held by exactly two customer rows, older first. */
export function findMergePairs(rows: MergeRow[]): MergePair[] {
  const byName = new Map<string, MergeRow[]>();
  for (const row of rows) {
    if ((row.role ?? "user") !== "user") continue;
    const name = (row.displayName ?? "").trim();
    if (!name) continue;
    byName.set(name, [...(byName.get(name) ?? []), row]);
  }

  const pairs: MergePair[] = [];
  for (const name of [...byName.keys()].sort()) {
    const group = byName.get(name) ?? [];
    if (group.length !== 2) continue;
    const [retired, survivor] = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!retired || !survivor) continue;
    pairs.push({ name, old: retired, new: survivor, conflict: mergeConflict(retired, survivor) });
  }
  return pairs;
}

/** The survivor's updates and the aliases to write. Throws on a conflict. */
export function planMerge(retired: MergeRow, survivor: MergeRow): MergePlan {
  const conflict = mergeConflict(retired, survivor);
  if (conflict) throw new Error(`merge refused: ${conflict}`);

  const codes = [retired.customerCode, survivor.customerCode].filter(
    (code): code is string => Boolean(code),
  );
  const keepCode = codes.length > 0 ? ([...codes].sort()[0] ?? null) : null;
  const retiredCodes = codes.filter((code) => code !== keepCode);

  const aliases = [...new Set([retired.customerId, retired.zaloUserId ?? "", ...retiredCodes])].filter(
    (alias) => alias !== "" && alias !== survivor.customerId,
  );

  const passwordFromRetired =
    Boolean(retired.passwordHash) &&
    (!survivor.passwordHash || (retired.passwordSetAt ?? "") > (survivor.passwordSetAt ?? ""));

  return {
    survivorId: survivor.customerId,
    retiredId: retired.customerId,
    keepCode,
    aliases,
    copyBankDetails: !survivor.bankAccount && Boolean(retired.bankAccount),
    passwordFromRetired,
    loginCount: (retired.loginCount ?? 0) + (survivor.loginCount ?? 0),
    lastLoginAt: [retired.lastLoginAt ?? "", survivor.lastLoginAt ?? ""].sort().pop() || null,
    createdAt: [retired.createdAt, survivor.createdAt].sort()[0] ?? survivor.createdAt,
    moves: [...MERGE_MOVES],
  };
}
