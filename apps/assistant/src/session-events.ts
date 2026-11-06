/**
 * What the assistant does with the session's events besides messages (assistant.ts): a friend
 * request is accepted after the server's check and a human pause (friend-accept.ts), as are the
 * requests still waiting in Zalo at start (`rescanFriendRequests`), people who
 * join a welcome group are welcomed (group-welcome.ts), and a session another login took is
 * reported to the server at once with a heartbeat that says so, so the owner is alerted without
 * waiting for the 5 minutes of `assistant_down`. Failures are logged by event name only.
 */
import type { AssistantHeartbeat } from "@cashback/contracts";

import type { FriendAccepter } from "./friend-accept";
import type { GroupJoinNotice } from "./group-join-notice";
import type { WelcomeOutcome } from "./group-welcome";
import type { InternalApi } from "./internal-api.adapter";
import type { GroupMember, SessionEventHandler } from "./zalo.port";

export interface SessionEventDeps {
  readonly friends: FriendAccepter;
  readonly welcome: (groupId: string, members: readonly GroupMember[]) => Promise<WelcomeOutcome>;
  /** Tells the DP Business group, apart from the welcome so neither delays the other (D64). */
  readonly joinNotice: GroupJoinNotice;
  readonly api: Pick<InternalApi, "heartbeat">;
  readonly beat: () => AssistantHeartbeat;
  readonly onError: (event: string, error: unknown) => void;
}

export function sessionEventHandler(deps: SessionEventDeps): SessionEventHandler {
  return (event) => {
    if (event.kind === "friend_request") {
      void deps.friends.accept(event.userId).catch((error: unknown) => deps.onError("assistant.friend.accept_failed", error));
    } else if (event.kind === "group_join") {
      void deps.welcome(event.groupId, event.members).catch((error: unknown) => deps.onError("assistant.group.welcome_failed", error));
      void deps.joinNotice(event.groupId, event.members).catch((error: unknown) => deps.onError("assistant.group.join_notice_failed", error));
    } else {
      deps.onError("assistant.zalo.session_conflict", new Error("zalo session taken by another login"));
      void deps.api.heartbeat(deps.beat()).catch((error: unknown) => deps.onError("assistant.heartbeat.failed", error));
    }
  };
}

/** At start: the friend requests that arrived while the assistant was not running, or were not accepted yet. */
export function rescanFriendRequests(friends: FriendAccepter, onError: (event: string, error: unknown) => void): void {
  void friends.rescan().catch((error: unknown) => onError("assistant.friend.rescan_failed", error));
}
