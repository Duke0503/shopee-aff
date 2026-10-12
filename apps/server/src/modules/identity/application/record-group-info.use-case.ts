import type { Db } from "../../../shared/database/connection";
import { groupInfo } from "../../../shared/database/schema";

export interface GroupInfoInput {
  groupId: string;
  groupName: string;
  totalMembers: number;
}

/**
 * Ports `_record_group_info`: remember how big the Zalo group is and what it is
 * called. The newest report replaces the previous one for that group.
 */
export function recordGroupInfo(db: Db, input: GroupInfoInput, nowIso: string): boolean {
  const groupId = (input.groupId ?? "").trim();
  if (!groupId) return false;

  db.insert(groupInfo)
    .values({
      groupId,
      groupName: input.groupName,
      totalMembers: input.totalMembers,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: groupInfo.groupId,
      set: { groupName: input.groupName, totalMembers: input.totalMembers, updatedAt: nowIso },
    })
    .run();

  return true;
}
