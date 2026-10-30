import type { Db } from "../../../shared/database/connection";
import { activityLogs, customers } from "../../../shared/database/schema";

export type RecordActivityResult = { ok: true; action: string } | { ok: false; reason: "missing_action" };

export interface ActivityLogInput {
  action: string;
  customerId?: string | null;
  displayName?: string | null;
  path?: string | null;
  detail?: string | null;
}

/**
 * Ports `_record_activity_log`: one row in the shared, append-only activity log.
 *
 * A `group_join` is often the first time we see someone, so it also remembers
 * them as a customer. An existing row is left untouched — never overwritten —
 * so a later sync cannot erase a name or a bank account.
 */
export function recordActivityLog(db: Db, input: ActivityLogInput, nowIso: string): RecordActivityResult {
  const action = (input.action ?? "").trim();
  if (!action) return { ok: false, reason: "missing_action" };

  const customerId = input.customerId ?? null;

  db.insert(activityLogs)
    .values({
      customerId,
      action,
      path: input.path ?? null,
      detail: input.detail ?? null,
      createdAt: nowIso,
    })
    .run();

  if (action === "group_join" && customerId) {
    db.insert(customers)
      .values({
        customerId,
        zaloUserId: customerId,
        displayName: input.displayName ?? "",
        role: "user",
        status: "active",
        createdAt: nowIso,
      })
      .onConflictDoNothing()
      .run();
  }

  return { ok: true, action };
}
