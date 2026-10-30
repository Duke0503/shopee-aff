/**
 * The outbox port (AD-16). Every module that tells a customer something enqueues it here,
 * inside the command's own transaction; the messaging module implements it. Modules never
 * import messaging, so this type is the only edge between them.
 */

export interface OutboxMessage {
  /** One (entity, event) is told once: a second enqueue with the same key is a no-op. */
  readonly dedupKey: string;
  readonly customerId: string;
  /** A key into packages/labels/vi/messages.json; the text never lives in code. */
  readonly messageKey: string;
  /** Ids and amounts in dong only; never names, phone numbers or bank numbers. */
  readonly params: Readonly<Record<string, string | number>>;
}

export interface OutboxPort {
  enqueue(message: OutboxMessage): void;
}
