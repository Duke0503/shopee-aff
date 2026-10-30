/**
 * The audit port (AD-17, FR-29, INV-11). Every command that moves money or personal data takes
 * an `Actor` and records one entry inside its own transaction, so the entry commits or rolls
 * back with the act; the operations module implements it over the insert-only `audit_entries`
 * table. Modules never import operations, so this type is the only edge.
 *
 * A payload carries ids, counts, statuses and HMAC fingerprints only. The type refuses the keys
 * personal data travels under, and the implementation checks every entry again at run time.
 */
import { STAFF_ROLES, type StaffRole } from "@cashback/core";

export type { StaffRole } from "@cashback/core";

/**
 * Staff member (with the role their staff session carries, Story 4.2), signed-in customer, the
 * Zalo assistant, or a system job (`cutover`, `reconcile`).
 */
export type Actor =
  | { readonly kind: "staff"; readonly id: string; readonly role: StaffRole }
  | { readonly kind: "customer" | "assistant" | "system"; readonly id: string };

export const ACTOR_KINDS = ["staff", "customer", "assistant", "system"] as const satisfies readonly Actor["kind"][];

/** True for a staff actor whose role is one of `roles`; checked at run time, not only by type. */
export function hasStaffRole(actor: Actor, roles: readonly StaffRole[] = STAFF_ROLES): boolean {
  return actor.kind === "staff" && (roles as readonly string[]).includes(actor.role);
}

/** Keys that name personal data: never in an audit payload (a bank account appears only as its fingerprint). */
export type PersonalDataKey =
  | "accountNumber"
  | "account_number"
  | "bankAccount"
  | "bank_account"
  | "bankAccountNumber"
  | "bankNumber"
  | "holderName"
  | "holder_name"
  | "accountHolder"
  | "account_holder"
  | "name"
  | "displayName"
  | "display_name"
  | "phone"
  | "phoneNumber"
  | "phone_number"
  | "zaloUserId"
  | "zalo_user_id"
  | "password";

export type AuditValue = string | number | boolean | null;

export type AuditPayload = Readonly<Record<string, AuditValue>> & { readonly [K in PersonalDataKey]?: never };

export interface AuditEntry {
  readonly actor: Actor;
  /** `context.aggregate.verb`, as for domain events (`payouts.payout.voided`). */
  readonly event: string;
  readonly entityId: string;
  /** Ids and fingerprints only, never names, phone numbers or bank numbers. */
  readonly payload: AuditPayload;
  readonly reason?: string;
}

export interface AuditPort {
  record(entry: AuditEntry): void;
}

/** The actor of the one-shot cutover import (AD-24). */
export const CUTOVER_SYSTEM_ACTOR: Actor = { kind: "system", id: "cutover" };

/** What a command needs to record its act, bound to the command's own transaction. */
export interface CommandAudit {
  readonly actor: Actor;
  readonly audit: AuditPort;
}
