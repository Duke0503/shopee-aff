/**
 * The server flag `messaging.silent` (AD-16, AD-24, D46; Story 6.10). While it is on, `enqueue`
 * records each new notification as a would-be send and makes none due, so the first
 * reconciliation after the cutover import cannot burst messages on the one Zalo account. The
 * import turns it on; the owner turns it off by command once the would-be sends were read. Each
 * change is audited with its actor; setting the value it already has changes and audits nothing.
 */
import type { Instant } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { messagingSettings } from "./schema";

export interface SilentFlag {
  readonly silent: boolean;
  readonly changedAt: Instant | null;
  readonly changedBy: string | null;
}

export function silentFlag(db: LedgerDb): SilentFlag {
  const row = db.select().from(messagingSettings).where(eq(messagingSettings.id, 1)).get();
  return { silent: row?.silent === 1, changedAt: (row?.changedAt as Instant | null | undefined) ?? null, changedBy: row?.changedBy ?? null };
}

export const isSilent = (db: LedgerDb): boolean => silentFlag(db).silent;

/** Sets the flag; call inside `tx`. `changed` is false when it already had that value. */
export function setSilent(db: LedgerDb, silent: boolean, at: Instant, by: CommandAudit): { readonly silent: boolean; readonly changed: boolean } {
  if (isSilent(db) === silent) return { silent, changed: false };
  const changedBy = `${by.actor.kind}:${by.actor.id}`;
  db.insert(messagingSettings)
    .values({ id: 1, silent: silent ? 1 : 0, changedAt: at, changedBy })
    .onConflictDoUpdate({ target: messagingSettings.id, set: { silent: silent ? 1 : 0, changedAt: at, changedBy } })
    .run();
  by.audit.record({ actor: by.actor, event: "messaging.settings.silent_changed", entityId: "messaging.silent", payload: { silent } });
  return { silent, changed: true };
}
