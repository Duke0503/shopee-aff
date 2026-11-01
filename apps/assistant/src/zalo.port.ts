/**
 * The seam over the one Zalo session (AD-15, D9, D37). The rest of the assistant talks to this
 * interface only. Two adapters sit behind it: the in-memory fake for dev and every test
 * (fake-zalo.adapter.ts), and the real personal account (zca-zalo.adapter.ts), which main.ts
 * constructs only with `ZALO_MODE=account`. Every adapter is wrapped by `guardTargets`
 * (zalo-target.guard.ts), so no group outside `ZALO_GROUP_IDS` is ever written to or listened to.
 */

export const ZALO_MODES = ["fake", "account"] as const;
export type ZaloMode = (typeof ZALO_MODES)[number];

/** Where a message goes or came from: a private chat with one person, or a group. */
export type ChatTarget = { readonly kind: "private"; readonly userId: string } | { readonly kind: "group"; readonly groupId: string };

export interface IncomingMessage {
  readonly chat: ChatTarget;
  /** The sender's Zalo user id as this account sees it. */
  readonly senderId: string;
  readonly text: string;
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>;

export interface ZaloSession {
  readonly mode: ZaloMode;
  connected(): boolean;
  /** One handler; a second call replaces the first. */
  onMessage(handler: MessageHandler): void;
  /** Called only by the pacer. */
  sendText(target: ChatTarget, text: string): Promise<void>;
  /** Called only by the friend-request queue, through the pacer. */
  addFriend(userId: string, greeting: string): Promise<void>;
  stop(): Promise<void>;
}
