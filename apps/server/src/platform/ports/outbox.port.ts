/**
 * The outbox port (AD-16). Every module that tells a customer something enqueues it here,
 * inside the command's own transaction; the messaging module implements it. Modules never
 * import messaging, so this type is the only edge between them. The dedup key helpers live here
 * so every producer builds its keys the one way messaging reads them.
 */

/** `<entity>:<id>:<event>`: a snake_case entity and event around an id without colons or spaces. */
export const DEDUP_KEY_PATTERN = /^[a-z][a-z_]*:[^:\s]+:[a-z][a-z_]*$/;

const UNSAFE_IN_ID = /[%:\s]/gu;
const utf8 = new TextEncoder();

/**
 * The id part of a key: `%`, `:` and whitespace percent-encoded as their UTF-8 bytes (`AT 12345`
 * is `AT%2012345`, `x:1` is `x%3A1`), every other character as it is. Live ids are letters and
 * digits, so their keys read as the plain id; any other id still gets one key of its own, and
 * `dedupKeyParts` gives it back exactly.
 */
export function encodeDedupKeyId(id: string): string {
  return id.replace(UNSAFE_IN_ID, (c) => [...utf8.encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join(""));
}

export function dedupKey(entity: string, id: string, event: string): string {
  const key = `${entity}:${encodeDedupKeyId(id)}:${event}`;
  if (!DEDUP_KEY_PATTERN.test(key)) throw new RangeError(`not a dedup key: ${key}`);
  return key;
}

export function dedupKeyParts(key: string): { entity: string; id: string; event: string } {
  if (!DEDUP_KEY_PATTERN.test(key)) throw new RangeError(`not a dedup key: ${key}`);
  const [entity = "", encoded = "", event = ""] = key.split(":");
  return { entity, id: decodeURIComponent(encoded), event };
}

export interface OutboxMessage {
  /** One (entity, event) is told once: a second enqueue with the same key is a no-op. */
  readonly dedupKey: string;
  readonly customerId: string;
  /** A key into packages/labels/vi/messages.json; the text never lives in code. */
  readonly messageKey: string;
  /** Ids and amounts in dong only; never names, phone numbers or bank numbers. */
  readonly params: Readonly<Record<string, string | number>>;
  /**
   * For a message about a payout, what left the bank. A netting-only payout (0) is never told:
   * the outbox refuses it (AD-16, D42).
   */
  readonly transferAmount?: number;
}

export interface OutboxPort {
  enqueue(message: OutboxMessage): void;
}
