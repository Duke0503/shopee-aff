/**
 * Paces outgoing messages so a burst cannot look like a bot or flood a chat.
 * A minimum gap is kept per key (a group id, or a customer id for private
 * chats), and one busy group does not slow another down.
 */
export class GroupPacer {
  private readonly lastSentAt = new Map<string, number>();

  constructor(private readonly minGapMs: number) {}

  /** How long to wait before sending to this key, in milliseconds. */
  delayFor(key: string, nowMs: number): number {
    const previous = this.lastSentAt.get(key);
    if (previous === undefined) return 0;
    return Math.max(0, this.minGapMs - (nowMs - previous));
  }

  /** Record that a message was just sent to this key. */
  mark(key: string, nowMs: number): void {
    this.lastSentAt.set(key, nowMs);
  }
}
