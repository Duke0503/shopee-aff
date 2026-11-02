/**
 * The welcome in the group, as the live assistant posted it (ENABLE_GROUP_WELCOME,
 * sendGroupWelcomeBatch): when people join a welcome group, one message picks one of the live
 * bot's three welcome texts at random (`group_welcome_1..3` in packages/labels), tags each new
 * person where the text says `{tag}` ("@A, @B & @C"), names the group, and sends the text's bold
 * parts as styles. Each person is welcomed once ever per group, remembered in the assistant's
 * small state file (welcome-state-file.adapter.ts) before the send, so a person who leaves and joins
 * again is not welcomed twice. Joining registers no one (D25).
 *
 * Which groups welcome is the config's (`welcomeGroupIds`): production's configured groups without
 * the Dev group, and in dev the Dev group only. The send goes through the pacer like every other.
 * The group is named as the live bot named the main group ("group_default_name"); the new
 * assistant does not read group names from Zalo.
 */
import { DISPLAY_NAME_MAX_LENGTH } from "@cashback/contracts";

import { messageText, styledMessage, type MessageKey } from "./messages";
import type { StyledText } from "./styled-text";
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
  /** Picks one of the welcome texts, as the live bot did; tests fix it. */
  readonly random?: () => number;
  /** Sends in the pacer's turn. */
  readonly send: (target: ChatTarget, message: StyledText, mentions: readonly Mention[]) => Promise<void>;
}

export type WelcomeOutcome = "welcomed" | "not_a_welcome_group" | "already_welcomed";

export const GROUP_WELCOME_KEYS: readonly MessageKey[] = ["group_welcome_1", "group_welcome_2", "group_welcome_3"];

/** Stands for the tags while the text is rendered; never sent. */
const TAG_MARK = "\u0000";

/** The tags as the live bot wrote them: "@A", "@A & @B", "@A, @B & @C", with each one's mention. */
function tagsOf(members: readonly GroupMember[], at: number): { readonly text: string; readonly mentions: Mention[] } {
  let text = "";
  const mentions: Mention[] = [];
  members.forEach((member, i) => {
    if (i > 0) text += i === members.length - 1 ? " & " : ", ";
    const name = (member.name ?? "").trim().slice(0, DISPLAY_NAME_MAX_LENGTH).trim();
    const mark = `@${name === "" ? messageText("member_fallback_name", { suffix: member.userId.slice(-4) }) : name}`;
    mentions.push({ userId: member.userId, pos: at + text.length, len: mark.length });
    text += mark;
  });
  return { text, mentions };
}

/** The text, styles and tags of one welcome, from the welcome text `key`. */
export function welcomeMessage(members: readonly GroupMember[], key: MessageKey = "group_welcome_1"): { readonly message: StyledText; readonly mentions: readonly Mention[] } {
  const template = styledMessage(key, { tag: TAG_MARK, groupName: messageText("group_default_name") });
  const at = template.text.indexOf(TAG_MARK);
  const tags = tagsOf(members, at);
  const grow = tags.text.length - TAG_MARK.length;
  const text = `${template.text.slice(0, at)}${tags.text}${template.text.slice(at + TAG_MARK.length)}`;
  const styles = template.styles.map((s) => (s.start > at ? { ...s, start: s.start + grow } : s));
  return { message: { text, styles }, mentions: tags.mentions };
}

export function groupWelcomer(deps: GroupWelcomeDeps): (groupId: string, members: readonly GroupMember[]) => Promise<WelcomeOutcome> {
  const groups = new Set(deps.welcomeGroupIds);
  const welcomed = new Set(deps.store.load() ?? []);
  const random = deps.random ?? (() => 0);
  return async (groupId, members) => {
    if (!groups.has(groupId)) return "not_a_welcome_group";
    const fresh = members.filter((m, i) => !welcomed.has(`${groupId}:${m.userId}`) && members.findIndex((o) => o.userId === m.userId) === i);
    if (fresh.length === 0) return "already_welcomed";
    const next = [...welcomed, ...fresh.map((m) => `${groupId}:${m.userId}`)];
    deps.store.save(next);
    for (const key of next) welcomed.add(key);
    const key = GROUP_WELCOME_KEYS[Math.min(GROUP_WELCOME_KEYS.length - 1, Math.floor(random() * GROUP_WELCOME_KEYS.length))] ?? "group_welcome_1";
    const { message, mentions } = welcomeMessage(fresh, key);
    await deps.send({ kind: "group", groupId }, message, mentions);
    return "welcomed";
  };
}
