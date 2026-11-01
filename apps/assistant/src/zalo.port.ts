/**
 * The seam over the one Zalo session (AD-15, D9, D37). The rest of the assistant talks to this
 * interface only. Three adapters sit behind it: the in-memory fake for dev and every test
 * (fake-zalo.adapter.ts), the real personal account (zca-zalo.adapter.ts), which main.ts
 * constructs only with `ZALO_MODE=account`, and the send-only relay to the Dev group through the
 * live bot (relay-zalo.adapter.ts), only with `ZALO_MODE=relay` in dev. Every adapter is wrapped by `guardTargets`
 * (zalo-target.guard.ts), so no group outside `ZALO_GROUP_IDS` is ever written to or listened to.
 */

export const ZALO_MODES = ["fake", "account", "relay"] as const;
export type ZaloMode = (typeof ZALO_MODES)[number];

/** Where a message goes or came from: a private chat with one person, or a group. */
export type ChatTarget = { readonly kind: "private"; readonly userId: string } | { readonly kind: "group"; readonly groupId: string };

export interface IncomingMessage {
  readonly chat: ChatTarget;
  /** The sender's Zalo user id as this account sees it. */
  readonly senderId: string;
  /** The name the sender shows in Zalo, when the session gives one. */
  readonly senderName?: string | null;
  readonly text: string;
  /** True when the message quotes an earlier one (a reply in Zalo), when the session says so. */
  readonly quoted?: boolean;
}

/**
 * A tag of a person in a group message: the text from `pos` for `len` characters (`@Name`) is shown
 * as a mention of `userId`, as Zalo (and the live bot's broadcast API) take it.
 */
export interface Mention {
  readonly userId: string;
  readonly pos: number;
  readonly len: number;
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>;

export interface ZaloSession {
  readonly mode: ZaloMode;
  /**
   * False while the session is lost (Zalo closed it, locked or logged out the account): the
   * heartbeat reports it, the server alerts the owner after 5 minutes (Story 6.11) and no
   * notification is pulled meanwhile, so none is lost.
   */
  connected(): boolean;
  /** The Zalo account the session runs on (its own id), or null when it has none (the relay). */
  accountId(): string | null;
  /** One handler; a second call replaces the first. */
  onMessage(handler: MessageHandler): void;
  /** Called only by the pacer; `mentions` tag people in a group message. */
  sendText(target: ChatTarget, text: string, mentions?: readonly Mention[]): Promise<void>;
  /** Called only by the friend-request queue, through the pacer. */
  addFriend(userId: string, greeting: string): Promise<void>;
  stop(): Promise<void>;
}
