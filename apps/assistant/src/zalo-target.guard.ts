/**
 * Keeps the assistant inside its configured groups (AD-25, D37, Story 8.1). Whatever adapter is
 * behind the session, a send to a group outside `ZALO_GROUP_IDS` is refused before it reaches
 * Zalo, and a message from such a group is dropped before any handler sees it. In dev the
 * configuration allows only the Dev group (assistant.config.ts), so dev can never post to the
 * customer group.
 */
import type { ChatTarget, ZaloSession } from "./zalo.port";

export class ZaloTargetRefused extends Error {
  constructor() {
    super("zalo group is not in ZALO_GROUP_IDS");
    this.name = "ZaloTargetRefused";
  }
}

export function isAllowedTarget(target: ChatTarget, allowedGroupIds: ReadonlySet<string>): boolean {
  return target.kind === "private" || allowedGroupIds.has(target.groupId);
}

export function guardTargets(session: ZaloSession, allowedGroupIds: readonly string[]): ZaloSession {
  const allowed = new Set(allowedGroupIds);
  return {
    mode: session.mode,
    connected: () => session.connected(),
    onMessage: (handler) => session.onMessage(async (message) => (isAllowedTarget(message.chat, allowed) ? handler(message) : undefined)),
    sendText: async (target, text, mentions) => {
      if (!isAllowedTarget(target, allowed)) throw new ZaloTargetRefused();
      await session.sendText(target, text, mentions);
    },
    addFriend: (userId, greeting) => session.addFriend(userId, greeting),
    stop: () => session.stop(),
  };
}
