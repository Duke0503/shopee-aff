/**
 * Telling the server who joined a welcome group, for the DP Business group's Telegram notice (D64).
 * The config's welcome groups only: production's, never the Dev group; a dev assistant has the Dev
 * group alone, and a dev server refuses a production chat. A rejoin is told again, as live. The member
 * count is read from Zalo as the live bot did; a failed read is logged and still tells, without the rank.
 * This never touches the welcome: session-events.ts runs the two apart.
 */
import { DISPLAY_NAME_MAX_LENGTH } from "@cashback/contracts";

import type { InternalApi } from "./internal-api.adapter";
import { messageText } from "./messages";
import type { GroupMember, ZaloSession } from "./zalo.port";

export interface GroupJoinNoticeDeps {
  readonly welcomeGroupIds: readonly string[];
  readonly zalo: Pick<ZaloSession, "groupMemberCount">;
  readonly api: Pick<InternalApi, "groupJoined">;
  readonly onError: (event: string, error: unknown) => void;
}

export type GroupJoinNotice = (groupId: string, members: readonly GroupMember[]) => Promise<void>;

const nameOf = (member: GroupMember): string => {
  const name = (member.name ?? "").trim().slice(0, DISPLAY_NAME_MAX_LENGTH).trim();
  return name === "" ? messageText("member_fallback_name", { suffix: member.userId.slice(-4) }) : name;
};

export function groupJoinNotice(deps: GroupJoinNoticeDeps): GroupJoinNotice {
  const groups = new Set(deps.welcomeGroupIds);
  return async (groupId, members) => {
    if (!groups.has(groupId)) return;
    const memberCount = await deps.zalo.groupMemberCount(groupId).catch((error: unknown) => {
      deps.onError("assistant.group.member_count_failed", error);
      return null;
    });
    const unique = members.filter((m, i) => members.findIndex((o) => o.userId === m.userId) === i);
    await deps.api.groupJoined({ groupName: messageText("group_default_name"), memberCount, members: unique.map((m) => ({ userId: m.userId, name: nameOf(m) })) });
  };
}
