import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { activityLogs, customers } from "../../../shared/database/schema";
import { findCustomerIdByAnyId } from "../infrastructure/customer.repository";
import { recordGroupInfo } from "./record-group-info.use-case";

export interface GroupMember {
  uid: string;
  name: string;
}

export interface SyncGroupInput {
  groupId: string;
  groupName: string;
  members: GroupMember[];
}

export interface SyncGroupResult {
  synced: number;
  total: number;
}

/**
 * Ports `_sync_group_members`: the assistant hands over the group's member list
 * and everyone new is remembered. The head-count is the members plus the bot.
 *
 * An existing customer is never recreated and a name is only filled in when it
 * was blank, so a later sync cannot rename someone who set their own name. The
 * `group_join` log is written once per person, which is what makes a re-run safe.
 */
export function syncGroupMembers(db: Db, input: SyncGroupInput, nowIso: string): SyncGroupResult {
  recordGroupInfo(
    db,
    { groupId: input.groupId, groupName: input.groupName, totalMembers: input.members.length + 1 },
    nowIso,
  );

  let synced = 0;
  for (const member of input.members) {
    const uid = (member.uid ?? "").trim();
    if (!uid) continue;

    const found = findCustomerIdByAnyId(db, uid);
    if (!found) {
      db.insert(customers)
        .values({
          customerId: uid,
          zaloUserId: uid,
          displayName: member.name,
          role: "user",
          status: "active",
          createdAt: nowIso,
        })
        .onConflictDoNothing()
        .run();
      synced += 1;
    } else if (member.name) {
      db.update(customers)
        .set({
          displayName: sql`coalesce(nullif(${customers.displayName}, ''), ${member.name})`,
          zaloUserId: sql`coalesce(nullif(${customers.zaloUserId}, ''), ${uid})`,
        })
        .where(eq(customers.customerId, found))
        .run();
    }

    const logged = db
      .select({ id: activityLogs.id })
      .from(activityLogs)
      .where(and(eq(activityLogs.customerId, uid), eq(activityLogs.action, "group_join")))
      .get();
    if (!logged) {
      db.insert(activityLogs)
        .values({
          customerId: uid,
          action: "group_join",
          path: `zalo_group_${input.groupId}`,
          detail: JSON.stringify({ groupId: input.groupId, groupName: input.groupName, sync: true }),
          createdAt: nowIso,
        })
        .run();
    }
  }

  return { synced, total: input.members.length };
}
