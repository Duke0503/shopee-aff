/**
 * Payout claims (AD-9, AD-7, D19, D39, INV-2, INV-4, Story 4.7). Opening a customer's payout is
 * one command in one transaction: it reads the server's snapshot (payout-snapshot.query.ts), and
 * either finds the customer claimed by another staff member (nothing is written), or keeps this
 * staff member's own OPEN claim while its snapshot still holds, or writes one new OPEN claim with
 * the snapshot, its hash, a transfer reference of its own and, when the preview carries a VietQR,
 * the time the QR was shown.
 *
 * A customer with nothing to pay, without a bank account or with a held website change is refused:
 * no claim and no QR. A customer whose open clawbacks reach the gross is claimed as a netting-only
 * payout (Story 4.11, D42): transfer 0, no QR, and no bank account needed, because no money moves.
 * A refusal is returned, not thrown, so the same committed transaction still abandons this staff
 * member's stale OPEN claim. Confirming a claim is payout-confirm.command.ts (Story 4.8).
 *
 * A claim is never deleted. The claim-expiry job marks one idle for 10 minutes ABANDONED, and so
 * does its own staff member closing the panel; when the last claim before a new one was abandoned
 * after its QR was shown, the new preview warns that a transfer may already have been made.
 */
import { randomBytes } from "node:crypto";
import type { PayoutFlag } from "@cashback/contracts";
import { instantFromMs, parseInstant, toMs, type Clock } from "@cashback/core";
import { and, desc, eq, lte, ne, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { hasStaffRole, type CommandAudit } from "../../platform/ports/audit.port";
import { accountNumberOf, bankAccountsOf, normaliseAccountNumber, sharedBankFingerprints, staffNamesOf } from "../identity/index";
import { vietQrPayload, VietQrError } from "./domain/vietqr";
import { payoutFlags } from "./payout-flags";
import { payoutSnapshot, PayoutSnapshotError, type PayoutSnapshot } from "./payout-snapshot.query";
import { payoutClaims, type PayoutClaimRow } from "./schema";

/** An OPEN claim with no activity for this long becomes ABANDONED (D39). */
export const CLAIM_IDLE_MS = 10 * 60_000;

export type PayoutClaimErrorCode =
  | "staff_only"
  | "customer_not_found"
  | "nothing_to_pay"
  | "netting_only"
  | "no_bank"
  | "bank_held"
  | "claim_not_found"
  | "not_your_claim"
  | "account_changed"
  | "snapshot_mismatch"
  | "other_claim_open"
  | "confirm_paused";

export class PayoutClaimError extends Error {
  constructor(
    readonly code: PayoutClaimErrorCode,
    /** Ids and counts only, for the log: why an internal check refused. */
    readonly detail?: string,
  ) {
    super(`payout claim: ${code}${detail === undefined ? "" : ` (${detail})`}`);
    this.name = "PayoutClaimError";
  }
}

/**
 * Why a preview carries no QR: the whole payable is netted (a netting-only payout), the bank name matches no single VietQR
 * bank (M-7), or the account or reference cannot be put in a VietQR. Staff then pay by hand.
 */
export type QrMissing = "netting_only" | "no_single_bank" | "qr_failed";

export interface ClaimedPayout {
  readonly kind: "claimed";
  readonly claim: PayoutClaimRow;
  readonly snapshot: PayoutSnapshot;
  readonly qrPayload: string | null;
  readonly qrMissing: QrMissing | null;
  /** The row's flags (payout-flags.ts), shown again in the panel. */
  readonly flags: readonly PayoutFlag[];
  /** The last claim before this one was abandoned after its QR was shown (D39). */
  readonly warning: { readonly amount: number; readonly at: string } | null;
}

export type ClaimOutcome = ClaimedPayout | { readonly kind: "taken"; readonly staffName: string } | { readonly kind: "refused"; readonly code: PayoutClaimErrorCode };

export interface ClaimDeps {
  readonly clock: Clock;
  readonly by: CommandAudit;
  /** Tests fix the claim ids; production draws them at random. */
  readonly newClaimId?: () => string;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 8 random Crockford base32 characters: the short claim id the transfer reference carries. */
export function randomClaimId(): string {
  return [...randomBytes(8)].map((b) => CROCKFORD[b % 32]).join("");
}

export const openClaimOf = (db: LedgerDb, customerId: string): PayoutClaimRow | undefined => db.select().from(payoutClaims).where(and(eq(payoutClaims.customerId, customerId), eq(payoutClaims.status, "OPEN"))).get();

function lastClaimBefore(db: LedgerDb, customerId: string, claimId: string | null): PayoutClaimRow | undefined {
  const others = claimId === null ? eq(payoutClaims.customerId, customerId) : and(eq(payoutClaims.customerId, customerId), ne(payoutClaims.claimId, claimId));
  return db.select().from(payoutClaims).where(others).orderBy(desc(payoutClaims.openedAt), desc(sql`rowid`)).get();
}

function warningOf(last: PayoutClaimRow | undefined): ClaimedPayout["warning"] {
  return last !== undefined && last.status === "ABANDONED" && last.qrShownAt !== null ? { amount: last.amount, at: last.qrShownAt } : null;
}

function flagsOf(db: LedgerDb, snapshot: PayoutSnapshot, clock: Clock): PayoutFlag[] {
  return payoutFlags({ bank: snapshot.bank, sharedFingerprints: sharedBankFingerprints(db), payable: snapshot.balance.payable, gross: snapshot.balance.gross, now: clock.now() });
}

function qrFor(db: LedgerDb, snapshot: PayoutSnapshot, reference: string): Pick<ClaimedPayout, "qrPayload" | "qrMissing"> {
  if (snapshot.balance.payable === 0) return { qrPayload: null, qrMissing: "netting_only" };
  const bank = snapshot.bank?.vietQrBank ?? null;
  const number = accountNumberOf(db, snapshot.customerId);
  if (bank === null || number === null) return { qrPayload: null, qrMissing: "no_single_bank" };
  try {
    return { qrPayload: vietQrPayload({ bankBin: bank.bin, accountNumber: normaliseAccountNumber(number), amount: snapshot.balance.payable, content: reference }), qrMissing: null };
  } catch (error) {
    if (error instanceof VietQrError) return { qrPayload: null, qrMissing: "qr_failed" };
    throw error;
  }
}

/** A payout whose open clawbacks take the whole gross: transfer 0 (AD-6, D42). */
export const isNettingOnly = (snapshot: PayoutSnapshot): boolean => snapshot.balance.gross > 0 && snapshot.balance.payable === 0;

function refusalOf(snapshot: PayoutSnapshot): PayoutClaimErrorCode | null {
  if (snapshot.balance.gross === 0) return "nothing_to_pay";
  if (isNettingOnly(snapshot)) return null;
  if (snapshot.bank === null) return "no_bank";
  return snapshot.bank.held ? "bank_held" : null;
}

function freshClaimId(db: LedgerDb, draw: () => string): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = draw();
    if (db.select({ id: payoutClaims.claimId }).from(payoutClaims).where(eq(payoutClaims.claimId, id)).get() === undefined) return id;
  }
  throw new Error("payout claim: no free claim id after 5 draws");
}

function abandon(db: LedgerDb, claim: PayoutClaimRow, deps: Pick<ClaimDeps, "clock" | "by">, reason: "idle" | "closed" | "superseded"): void {
  db.update(payoutClaims).set({ status: "ABANDONED", abandonedAt: deps.clock.now() }).where(and(eq(payoutClaims.claimId, claim.claimId), eq(payoutClaims.status, "OPEN"))).run();
  deps.by.audit.record({ actor: deps.by.actor, event: "payouts.claim.abandoned", entityId: claim.claimId, payload: { claimId: claim.claimId, customerId: claim.customerId, reason, qrShown: claim.qrShownAt !== null } });
}

function insertClaim(db: LedgerDb, snapshot: PayoutSnapshot, deps: ClaimDeps): ClaimedPayout {
  const bank = snapshot.bank;
  if (bank === null && !isNettingOnly(snapshot)) throw new PayoutClaimError("no_bank");
  const warning = warningOf(lastClaimBefore(db, snapshot.customerId, null));
  const claimId = freshClaimId(db, deps.newClaimId ?? randomClaimId);
  const transferReference = snapshot.customerCode === null ? claimId : `${snapshot.customerCode} ${claimId}`;
  const qr = qrFor(db, snapshot, transferReference);
  const now = deps.clock.now();
  const ids = (values: readonly (string | number)[]): string => JSON.stringify([...values].sort());
  const claim = db
    .insert(payoutClaims)
    .values({
      claimId,
      customerId: snapshot.customerId,
      staffId: deps.by.actor.id,
      status: "OPEN",
      orderIds: ids(snapshot.orders.map((o) => o.orderId)),
      awardIds: JSON.stringify(snapshot.bonuses.map((b) => b.awardId).sort((a, b) => a - b)),
      clawbackIds: ids(snapshot.clawbacks.map((c) => c.clawbackId)),
      amount: snapshot.balance.payable,
      bankFingerprint: bank?.fingerprint ?? null,
      bankHeld: bank?.held ?? false,
      snapshotHash: snapshot.hash,
      transferReference,
      openedAt: now,
      lastActiveAt: now,
      qrShownAt: qr.qrPayload === null ? null : now,
    })
    .returning()
    .get();
  deps.by.audit.record({
    actor: deps.by.actor,
    event: "payouts.claim.opened",
    entityId: claimId,
    payload: { claimId, customerId: snapshot.customerId, amount: claim.amount, ...(bank === null ? {} : { bankFingerprint: bank.fingerprint }), snapshotHash: snapshot.hash, qrShown: qr.qrPayload !== null, warned: warning !== null },
  });
  return { kind: "claimed", claim, snapshot, ...qr, flags: flagsOf(db, snapshot, deps.clock), warning };
}

/** The staff member's own OPEN claim whose snapshot still holds: touched, and given its QR time the first time it carries a QR. */
function keepClaim(db: LedgerDb, open: PayoutClaimRow, snapshot: PayoutSnapshot, deps: ClaimDeps): ClaimedPayout {
  const qr = qrFor(db, snapshot, open.transferReference);
  const now = deps.clock.now();
  const qrShownAt = open.qrShownAt ?? (qr.qrPayload === null ? null : now);
  const claim = db.update(payoutClaims).set({ lastActiveAt: now, qrShownAt }).where(eq(payoutClaims.claimId, open.claimId)).returning().get();
  return { kind: "claimed", claim, snapshot, ...qr, flags: flagsOf(db, snapshot, deps.clock), warning: warningOf(lastClaimBefore(db, snapshot.customerId, open.claimId)) };
}

function snapshotOrRefusal(db: LedgerDb, customerKey: string): PayoutSnapshot | PayoutClaimErrorCode {
  try {
    return payoutSnapshot(db, customerKey) ?? "customer_not_found";
  } catch (error) {
    if (error instanceof PayoutSnapshotError) return "snapshot_mismatch";
    throw error;
  }
}

/** Opens (or keeps) the calling staff member's claim on the customer behind `customerKey`; run inside `tx`. */
export function openPayoutClaim(db: LedgerDb, customerKey: string, deps: ClaimDeps): ClaimOutcome {
  if (!hasStaffRole(deps.by.actor)) throw new PayoutClaimError("staff_only");
  const snapshot = snapshotOrRefusal(db, customerKey);
  if (typeof snapshot === "string") return { kind: "refused", code: snapshot };
  const open = openClaimOf(db, snapshot.customerId);
  if (open !== undefined && open.staffId !== deps.by.actor.id) return { kind: "taken", staffName: staffNamesOf(db, [open.staffId]).get(open.staffId) ?? open.staffId };
  const refusal = refusalOf(snapshot);
  if (open !== undefined && open.snapshotHash === snapshot.hash && refusal === null) return keepClaim(db, open, snapshot, deps);
  if (open !== undefined) abandon(db, open, deps, "superseded");
  if (refusal !== null) return { kind: "refused", code: refusal };
  return insertClaim(db, snapshot, deps);
}

export function ownClaim(db: LedgerDb, claimId: string, deps: Pick<ClaimDeps, "by">): PayoutClaimRow {
  if (!hasStaffRole(deps.by.actor)) throw new PayoutClaimError("staff_only");
  const claim = db.select().from(payoutClaims).where(eq(payoutClaims.claimId, claimId)).get();
  if (claim === undefined) throw new PayoutClaimError("claim_not_found");
  if (claim.staffId !== deps.by.actor.id) throw new PayoutClaimError("not_your_claim");
  return claim;
}

/** Closing the panel releases the staff member's own OPEN claim (ABANDONED, kept); anything else is a no-op. */
export function releasePayoutClaim(db: LedgerDb, claimId: string, deps: Pick<ClaimDeps, "clock" | "by">): PayoutClaimRow {
  const claim = ownClaim(db, claimId, deps);
  if (claim.status === "OPEN") abandon(db, claim, deps, "closed");
  return db.select().from(payoutClaims).where(eq(payoutClaims.claimId, claimId)).get() ?? claim;
}

/**
 * The full account number of an OPEN claim, for the panel's copy button (EXPERIENCE.md masked
 * account): only to the claim's own staff member, and every reveal is in the audit trail with the
 * account's fingerprint, never the number. When the saved account is no longer the one the claim
 * showed (changed, or now held for confirmation), nothing is revealed and the panel reloads.
 */
export function revealClaimAccount(db: LedgerDb, claimId: string, deps: Pick<ClaimDeps, "clock" | "by">): string {
  const claim = ownClaim(db, claimId, deps);
  if (claim.status !== "OPEN") throw new PayoutClaimError("claim_not_found");
  if (claim.amount === 0) throw new PayoutClaimError("netting_only");
  const current = bankAccountsOf(db, [claim.customerId]).get(claim.customerId);
  const number = accountNumberOf(db, claim.customerId);
  if (current === undefined || number === null || current.fingerprint !== claim.bankFingerprint || current.held !== claim.bankHeld) throw new PayoutClaimError("account_changed");
  db.update(payoutClaims).set({ lastActiveAt: deps.clock.now() }).where(eq(payoutClaims.claimId, claimId)).run();
  deps.by.audit.record({ actor: deps.by.actor, event: "payouts.claim.account_revealed", entityId: claimId, payload: { claimId, customerId: claim.customerId, bankFingerprint: claim.bankFingerprint } });
  return normaliseAccountNumber(number);
}

/** The claim-expiry job's one transaction: every OPEN claim idle for CLAIM_IDLE_MS becomes ABANDONED. */
export function expireIdleClaims(db: LedgerDb, deps: Pick<ClaimDeps, "clock" | "by">): number {
  const cutoff = instantFromMs(toMs(parseInstant(deps.clock.now())) - CLAIM_IDLE_MS);
  const idle = db.select().from(payoutClaims).where(and(eq(payoutClaims.status, "OPEN"), lte(payoutClaims.lastActiveAt, cutoff))).all();
  for (const claim of idle) abandon(db, claim, deps, "idle");
  return idle.length;
}

/** The order is in the snapshot of an OPEN claim (D39, AD-7): a cancel waits until the claim ends. */
export function coveredByOpenClaim(db: LedgerDb, orderId: string): boolean {
  return db.get<{ hit: number } | undefined>(sql`SELECT 1 AS hit FROM payout_claims c, json_each(c.order_ids) j WHERE c.status = 'OPEN' AND j.value = ${orderId} LIMIT 1`) !== undefined;
}
