/**
 * The seam over the real Zalo transport. The rest of the assistant talks to
 * this interface only, so every piece stays testable without a live account,
 * and the real `zca-js` adapter plugs in at exactly one place
 * (`zca-adapter.ts`).
 */
export interface ZaloIncomingMessage {
  /** Where it arrived: a group id, or the customer id for a private chat. */
  chatId: string;
  /** The Zalo user id of the sender. This is the customer's `customer_id`. */
  senderId: string;
  text: string;
  /** True for a private chat (1-1), false for a group. */
  isPrivate: boolean;
}

export interface ZaloClient {
  /** Register the handler for incoming messages. */
  onMessage(handler: (message: ZaloIncomingMessage) => Promise<void>): void;
  /** Send text to a group or a private chat. */
  sendText(chatId: string, text: string): Promise<void>;
  /** Send a friend request. */
  addFriend(userId: string, greeting: string): Promise<void>;
}
