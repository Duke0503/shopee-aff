/**
 * The proof image of a payout (AD-21, D49, INV-13, Story 4.9). Staff attach it after the transfer,
 * from the payout panel; the file is already sanitized and written by the time this runs, so the
 * transaction only records where it is, with its SHA-256 and size, and the audit entry. A
 * netting-only payout moved no money and takes no proof; a voided payout keeps the proof it has
 * but takes no new one. A second upload replaces the row, and the audit trail keeps both hashes.
 *
 * Reading it back is allowed to staff (any role) and to the payout's own customer, whose session
 * resolves through merges to the same surviving customer; to anyone else it does not exist.
 */
import type { Clock } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { hasStaffRole, type CommandAudit } from "../../platform/ports/audit.port";
import { resolveCustomer } from "../identity/index";
import { payoutProofs, payouts, type PayoutProofRow, type ProofContentType } from "./schema";

export type PayoutProofErrorCode = "staff_only" | "payout_not_found" | "payout_voided" | "proof_not_needed";

export class PayoutProofError extends Error {
  constructor(readonly code: PayoutProofErrorCode) {
    super(`payout proof: ${code}`);
    this.name = "PayoutProofError";
  }
}

/** Where proof files are kept (proof-store.adapter.ts); written before, never inside, a transaction. */
export interface ProofStore {
  /** Writes the bytes under a new random name and returns the name. */
  write(bytes: Buffer, contentType: ProofContentType): string;
  /** The bytes of a stored file, or null when there is none by that name. */
  read(fileName: string): Buffer | null;
  /** Removes a file written for a command whose transaction then refused it. */
  discard(fileName: string): void;
}

export interface StoredProofFile {
  readonly fileName: string;
  readonly contentType: ProofContentType;
  readonly byteSize: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

export interface RecordedProof {
  readonly payoutId: number;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly uploadedAt: string;
  readonly replaced: boolean;
}

/** Why this payout takes no proof now, or null when it does; read before the upload is processed and again inside its transaction. */
export function proofRefusal(db: LedgerDb, payoutId: number): Exclude<PayoutProofErrorCode, "staff_only"> | null {
  const payout = db.select({ status: payouts.status, amount: payouts.transferAmount }).from(payouts).where(eq(payouts.payoutId, payoutId)).get();
  if (payout === undefined) return "payout_not_found";
  if (payout.status === "VOIDED") return "payout_voided";
  return payout.amount === 0 ? "proof_not_needed" : null;
}

export function recordPayoutProof(db: LedgerDb, input: { readonly payoutId: number; readonly file: StoredProofFile }, deps: { readonly clock: Clock; readonly by: CommandAudit }): RecordedProof {
  const { by } = deps;
  if (!hasStaffRole(by.actor)) throw new PayoutProofError("staff_only");
  const refusal = proofRefusal(db, input.payoutId);
  if (refusal !== null) throw new PayoutProofError(refusal);
  const before = db.select({ sha256: payoutProofs.sha256 }).from(payoutProofs).where(eq(payoutProofs.payoutId, input.payoutId)).get();
  const uploadedAt = deps.clock.now();
  const row = { ...input.file, uploadedBy: by.actor.id, uploadedAt };
  db.insert(payoutProofs)
    .values({ payoutId: input.payoutId, ...row })
    .onConflictDoUpdate({ target: payoutProofs.payoutId, set: row })
    .run();
  by.audit.record({
    actor: by.actor,
    event: "payouts.proof.recorded",
    entityId: String(input.payoutId),
    payload: { payoutId: input.payoutId, sha256: input.file.sha256, byteSize: input.file.byteSize, contentType: input.file.contentType, ...(before === undefined ? {} : { replacedSha256: before.sha256 }) },
  });
  return { payoutId: input.payoutId, byteSize: input.file.byteSize, width: input.file.width, height: input.file.height, uploadedAt, replaced: before !== undefined };
}

/** The proof of a payout for staff; null when it has none. */
export function proofOf(db: LedgerDb, payoutId: number): PayoutProofRow | null {
  return db.select().from(payoutProofs).where(eq(payoutProofs.payoutId, payoutId)).get() ?? null;
}

/** The proof of a payout for the signed-in customer: null unless the payout is theirs. */
export function customerProofOf(db: LedgerDb, payoutId: number, customerId: string): PayoutProofRow | null {
  const payout = db.select({ customerId: payouts.customerId }).from(payouts).where(eq(payouts.payoutId, payoutId)).get();
  if (payout === undefined) return null;
  const owner = resolveCustomer(db, payout.customerId);
  if (owner === null || owner.customerId !== customerId) return null;
  return proofOf(db, payoutId);
}
