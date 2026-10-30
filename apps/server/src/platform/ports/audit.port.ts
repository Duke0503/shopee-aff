/**
 * The audit port (AD-17). Every command that moves money or personal data records one entry
 * inside its own transaction; the operations module implements it over the insert-only
 * `audit_entries` table. Modules never import operations, so this type is the only edge.
 */

export interface Actor {
  readonly kind: "staff" | "customer" | "system";
  readonly id: string;
}

export interface AuditEntry {
  readonly actor: Actor;
  /** `context.aggregate.verb`, as for domain events (`payouts.payout.voided`). */
  readonly event: string;
  readonly entityId: string;
  /** Ids and fingerprints only, never names, phone numbers or bank numbers. */
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly reason?: string;
}

export interface AuditPort {
  record(entry: AuditEntry): void;
}
