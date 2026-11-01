/**
 * Registering a person who wrote to the Zalo assistant (AD-23, FR-8, D10, D25, INV-6; Story 6.2).
 * Only the assistant's internal routes call it: no public route creates a customer (D10). The
 * caller decides that the person showed intent (a private message, or a product link pasted in
 * the community group); joining the group alone never reaches here (D25).
 *
 * The Zalo id is resolved first through `resolveCustomer`, so a person seen before, under an
 * alias of a merged record included, gets the survivor back and no second row. A new person gets
 * the next customer code from the counter in the same transaction, and their Zalo id as the
 * permanent customer id, as the live system did (letters and digits only, so it can be sub_id1).
 * When that id is still held by an erased record, the new code is the id instead. Call inside
 * `tx`; the audit entry carries the code and the channel only, never the name (AD-17).
 */
import { searchText, sortKey, type Clock } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { issueCustomerCode } from "./customer-code.command";
import { customerCodeOf, resolveCustomer } from "./customer.query";
import { customers } from "./schema";

/** A Zalo user id as the assistant passes it: letters and digits only, so it can be a sub_id1 (D7). */
export const ZALO_USER_ID_PATTERN = /^[A-Za-z0-9]{1,40}$/;
export const DISPLAY_NAME_MAX = 120;

/** Where the person showed intent (D25). */
export const REGISTRATION_CHANNELS = ["private_message", "group_link"] as const;
export type RegistrationChannel = (typeof REGISTRATION_CHANNELS)[number];

export class CustomerRegisterError extends Error {
  constructor(readonly code: "zalo_id_invalid" | "zalo_id_held") {
    super(`customer registration refused: ${code}`);
    this.name = "CustomerRegisterError";
  }
}

export interface RegistrationInput {
  readonly zaloUserId: string;
  readonly displayName: string | null;
  readonly via: RegistrationChannel;
}

export interface Registered {
  /** The survivor for a person seen before. */
  readonly customerId: string;
  /** Null only for a record without a code (staff or the guest account resolved by a Zalo id). */
  readonly customerCode: string | null;
  readonly status: "ACTIVE" | "DISABLED";
  readonly created: boolean;
}

const idTaken = (db: LedgerDb, id: string): boolean => db.select({ id: customers.customerId }).from(customers).where(eq(customers.customerId, id)).get() !== undefined;
const zaloIdHeld = (db: LedgerDb, zaloUserId: string): boolean => db.select({ id: customers.customerId }).from(customers).where(eq(customers.zaloUserId, zaloUserId)).get() !== undefined;

export function registerCustomer(db: LedgerDb, input: RegistrationInput, deps: { readonly clock: Clock; readonly logger: Pick<Logger, "warn">; readonly by: CommandAudit }): Registered {
  if (!ZALO_USER_ID_PATTERN.test(input.zaloUserId)) throw new CustomerRegisterError("zalo_id_invalid");
  const known = resolveCustomer(db, input.zaloUserId);
  if (known !== null) return { customerId: known.customerId, customerCode: customerCodeOf(db, known.customerId), status: known.status, created: false };
  // A row that keeps this Zalo id but resolves to nobody (a merge with no survivor) is a data error, not a new person.
  if (zaloIdHeld(db, input.zaloUserId)) throw new CustomerRegisterError("zalo_id_held");
  const customerCode = issueCustomerCode(db, deps.logger, deps.by);
  const customerId = idTaken(db, input.zaloUserId) ? customerCode : input.zaloUserId;
  const displayName = input.displayName?.trim().slice(0, DISPLAY_NAME_MAX) || null;
  db.insert(customers)
    .values({
      customerId,
      customerCode,
      role: "USER",
      status: "ACTIVE",
      zaloUserId: input.zaloUserId,
      privateChatId: input.via === "private_message" ? input.zaloUserId : null,
      displayName,
      searchText: searchText(displayName, customerCode, input.zaloUserId),
      sortKey: sortKey(displayName ?? ""),
      createdAt: deps.clock.now(),
    })
    .run();
  deps.by.audit.record({ actor: deps.by.actor, event: "identity.customer.registered", entityId: customerId, payload: { customerCode, via: input.via } });
  return { customerId, customerCode, status: "ACTIVE", created: true };
}
