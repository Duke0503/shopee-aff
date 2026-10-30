/**
 * Writing off a clawback (AD-6, D42, FR-17, Story 4.11): an admin closes what a clawback still
 * owes with one positive WRITE_OFF entry and a reason, so a clawback can always close even when
 * the customer never earns enough to net it. Entries stay insert-only: the open amount is the sum
 * of the entries before it, read under the write lock, so a second write-off finds it closed. The
 * audit entry names the admin as its actor and carries the reason.
 */
import type { Clock } from "@cashback/core";
import { clawbackOpenAmount, openClawbackTotal } from "@cashback/money";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { hasStaffRole, type CommandAudit } from "../../platform/ports/audit.port";
import { CLAWBACK_KINDS, ledgerEntries } from "./schema";

export const WRITE_OFF_REASON_MAX = 500;

export type WriteOffErrorCode = "admin_only" | "clawback_not_found" | "clawback_closed" | "reason_required";

export class WriteOffError extends Error {
  constructor(readonly code: WriteOffErrorCode) {
    super(`clawback write-off: ${code}`);
    this.name = "WriteOffError";
  }
}

export interface WrittenOff {
  readonly clawbackId: string;
  /** The positive entry written: what the clawback still owed. */
  readonly amount: number;
}

export function writeOffClawback(db: LedgerDb, input: { readonly clawbackId: string; readonly reason: string }, deps: { readonly clock: Clock; readonly by: CommandAudit }): WrittenOff {
  if (!hasStaffRole(deps.by.actor, ["ADMIN"])) throw new WriteOffError("admin_only");
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > WRITE_OFF_REASON_MAX) throw new WriteOffError("reason_required");
  const entries = db.select().from(ledgerEntries).where(and(eq(ledgerEntries.clawbackId, input.clawbackId), inArray(ledgerEntries.kind, [...CLAWBACK_KINDS]))).orderBy(asc(ledgerEntries.entryId)).all();
  const original = entries.find((e) => e.kind === "CLAWBACK");
  if (original === undefined) throw new WriteOffError("clawback_not_found");
  const owed = openClawbackTotal([clawbackOpenAmount(entries.map((e) => e.amount))]);
  if (owed === 0) throw new WriteOffError("clawback_closed");
  db.insert(ledgerEntries)
    .values({ customerId: original.customerId, clawbackId: input.clawbackId, kind: "WRITE_OFF", amount: owed, orderId: original.orderId, reason, createdAt: deps.clock.now(), createdBy: deps.by.actor.id })
    .run();
  deps.by.audit.record({ actor: deps.by.actor, event: "payouts.clawback.written_off", entityId: input.clawbackId, payload: { clawbackId: input.clawbackId, customerId: original.customerId, orderId: original.orderId, amount: owed }, reason });
  return { clawbackId: input.clawbackId, amount: owed };
}
