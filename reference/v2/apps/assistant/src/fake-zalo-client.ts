import type { ZaloClient, ZaloIncomingMessage } from "./zalo-client";

/**
 * An in-memory Zalo. It NEVER connects to Zalo: tests and local dry runs use
 * it, and the real adapter replaces it in production.
 */
export class FakeZaloClient implements ZaloClient {
  readonly sent: { chatId: string; text: string }[] = [];
  readonly friendRequests: { userId: string; greeting: string }[] = [];

  private handler: ((message: ZaloIncomingMessage) => Promise<void>) | null = null;

  onMessage(handler: (message: ZaloIncomingMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async sendText(chatId: string, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }

  async addFriend(userId: string, greeting: string): Promise<void> {
    this.friendRequests.push({ userId, greeting });
  }

  /** Test helper: deliver a message as if the customer had sent it. */
  async deliver(message: ZaloIncomingMessage): Promise<void> {
    if (!this.handler) throw new Error("no message handler registered");
    await this.handler(message);
  }
}
