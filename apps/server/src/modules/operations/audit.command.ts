/**
 * `audit.record` (AD-17, FR-29, INV-11): one insert-only `audit_entries` row per money or
 * personal-data command, written through the command's own transaction handle, so the entry
 * commits and rolls back with the act. Each entry is checked first: a known actor kind and id,
 * an event named `context.aggregate.verb`, and a payload of ids and fingerprints only
 * (domain/audit-payload.ts). A refused entry throws, which rolls the whole command back.
 */
import type { Clock } from "@cashback/core";

import type { LedgerDb } from "../../platform/db/ledger";
import { ACTOR_KINDS, hasStaffRole, type Actor, type AuditEntry, type AuditPort, type CommandAudit } from "../../platform/ports/audit.port";
import { isAuditEvent, payloadProblems, type AuditProblem } from "./domain/audit-payload";
import { auditEntries } from "./schema";

export class AuditEntryError extends Error {
  readonly code = "audit_entry_refused";
  constructor(
    message: string,
    readonly problems: readonly AuditProblem[] = [],
  ) {
    super(message);
    this.name = "AuditEntryError";
  }
}

function check(entry: AuditEntry): void {
  if (!(ACTOR_KINDS as readonly string[]).includes(entry.actor.kind) || entry.actor.id.trim() === "") throw new AuditEntryError("an audit entry needs an actor kind and id");
  if (entry.actor.kind === "staff" && !hasStaffRole(entry.actor)) throw new AuditEntryError("a staff actor needs a staff role");
  if (!isAuditEvent(entry.event)) throw new AuditEntryError(`not a context.aggregate.verb event: ${entry.event}`);
  if (entry.entityId.trim() === "") throw new AuditEntryError("an audit entry needs an entity id");
  const problems = payloadProblems(entry.payload);
  // The message names the keys only: a refused value may be the personal data itself.
  if (problems.length > 0) throw new AuditEntryError(`audit payload refused: ${problems.map((p) => `${p.key} (${p.problem})`).join(", ")}`, problems);
}

/** Records one entry; call inside the command's `tx`. */
export function recordAudit(db: LedgerDb, clock: Clock, entry: AuditEntry): void {
  check(entry);
  db.insert(auditEntries)
    .values({
      recordedAt: clock.now(),
      actorKind: entry.actor.kind,
      actorId: entry.actor.id,
      event: entry.event,
      entityId: entry.entityId,
      payload: JSON.stringify(entry.payload),
      reason: entry.reason ?? null,
      actorRole: entry.actor.kind === "staff" ? entry.actor.role : null,
    })
    .run();
}

/** The audit port bound to one transaction's handle (platform/ports/audit.port.ts). */
export function auditFor(db: LedgerDb, clock: Clock): AuditPort {
  return { record: (entry) => recordAudit(db, clock, entry) };
}

/** The actor and the audit port a command takes, bound to one transaction's handle. */
export function commandAudit(db: LedgerDb, clock: Clock, actor: Actor): CommandAudit {
  return { actor, audit: auditFor(db, clock) };
}
