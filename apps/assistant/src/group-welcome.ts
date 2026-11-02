/**
 * The welcome in the group, as the live assistant posted it (ENABLE_GROUP_WELCOME): when people
 * join a welcome group, one message tags each of them by name and gives the `group_welcome` text
 * from packages/labels. Each person is welcomed once ever per group, remembered in the assistant's
 * small state file (welcome-state-file.adapter.ts) before the send, so a person who leaves and joins
 * again is not welcomed twice. Joining registers no one (D25).
 *
 * Which groups welcome is the config's (`welcomeGroupIds`): production's configured groups without
 * the Dev group, and in dev the Dev group only. The send goes through the pacer like every other.
 */
import { DISPLAY_NAME_MAX_LENGTH } from "@cashback/contracts";

import { messageText } from "./messages";
import type { ChatTarget, GroupMember, Mention } from "./zalo.port";

/** Who was welcomed, as `groupId:userId`; null when nothing is saved yet. */
export interface WelcomeStore {
  load(): readonly string[] | null;
  save(welcomed: readonly string[]): void;
}

export const memoryWelcomeStore = (initial: readonly string[] | null = null): WelcomeStore & { saved: readonly string[] | null } => {
  const store = {
    saved: initial,
    load: () => store.saved,
    save: (welcomed: readonly string[]) => {
      store.saved = welcomed;
    },
  };
  return store;
};

export interface GroupWelcomeDeps {
  readonly welcomeGroupIds: readonly string[];
  readonly store: WelcomeStore;
  /** Sends in the pacer's turn. */
  readonly send: (target: ChatTarget, text: string, mentions: readonly Mention[]) => Promise<void>;
}

export type WelcomeOutcome = "welcomed" | "not_a_welcome_group" | "already_welcomed";

/** The text and tags of one welcome: `@Name @Name` on the first line, then the welcome. */
export function welcomeMessage(members: readonly GroupMember[]): { readonly text: string; readonly mentions: readonly Mention[] } {
  const mentions: Mention[] = [];
  let line = "";
  for (const member of members) {
    const name = (member.name ?? "").trim().slice(0, DISPLAY_NAME_MAX_LENGTH).trim();
    if (name === "") continue;
    const mark = `@${name}`;
    const pos = line === "" ? 0 : line.length + 1;
    line = line === "" ? mark : `${line} ${mark}`;
    mentions.push({ userId: member.userId, pos, len: mark.length });
  }
  const welcome = messageText("group_welcome");
  return { text: line === "" ? welcome : `${line}\n${welcome}`, mentions };
}

export function groupWelcomer(deps: GroupWelcomeDeps): (groupId: string, members: readonly GroupMember[]) => Promise<WelcomeOutcome> {
  const groups = new Set(deps.welcomeGroupIds);
  const welcomed = new Set(deps.store.load() ?? []);
  return async (groupId, members) => {
    if (!groups.has(groupId)) return "not_a_welcome_group";
    const fresh = members.filter((m, i) => !welcomed.has(`${groupId}:${m.userId}`) && members.findIndex((o) => o.userId === m.userId) === i);
    if (fresh.length === 0) return "already_welcomed";
    const next = [...welcomed, ...fresh.map((m) => `${groupId}:${m.userId}`)];
    deps.store.save(next);
    for (const key of next) welcomed.add(key);
    const { text, mentions } = welcomeMessage(fresh);
    await deps.send({ kind: "group", groupId }, text, mentions);
    return "welcomed";
  };
}
