/**
 * The run-time check behind the audit port's payload type (AD-17, INV-11, SECURITY_MODEL.md):
 * an audit payload carries ids, counts, statuses and HMAC fingerprints only. A key that names
 * personal data is refused whatever its spelling; a string value with whitespace (a name), a
 * Vietnamese phone number, or a fingerprint key whose value is not an HMAC-SHA-256 hex digest is
 * refused too. Bank numbers have no shape of their own (a request id is also eleven digits), so
 * they are kept out by key: a bank account appears only as `bankFingerprint`.
 *
 * A key declared as an identifier (`id`, or ending in `Id`, `Ids`, `_id`, `_ids`) holds a
 * permanent id the ledger issued or a network sent, never free text: the value heuristics do not
 * apply to it, so a customer id that happens to look like a phone number never rolls a command
 * back. Its key is still checked, so a Zalo user id stays refused.
 */

const normalise = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Parts of a normalised key that mean personal data or a secret, and keys that are one on their own. */
const PERSONAL_KEY_PARTS = ["accountnumber", "banknumber", "holder", "name", "phone", "zalo", "password", "token", "secret", "address", "email"];
const PERSONAL_KEYS = new Set(["account", "bankaccount", "bank"]);

const PHONE = /^(?:\+?84|0)\d{9,10}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const IDENTIFIER_KEY = /^(?:id|ids)$|(?:Id|Ids|_id|_ids)$/;
const EVENT = /^[a-z][a-z_]*\.[a-z][a-z_]*\.[a-z][a-z_]*$/;

export type AuditProblem = { readonly key: string; readonly problem: "personal_key" | "whitespace" | "phone_number" | "not_a_fingerprint" | "not_a_value" };

export const isIdentifierKey = (key: string): boolean => IDENTIFIER_KEY.test(key);

export function isPersonalKey(key: string): boolean {
  const n = normalise(key);
  if (n.endsWith("fingerprint")) return false;
  return PERSONAL_KEYS.has(n) || PERSONAL_KEY_PARTS.some((part) => n.includes(part));
}

function valueProblem(key: string, value: unknown): AuditProblem["problem"] | null {
  if (value !== null && !["string", "number", "boolean"].includes(typeof value)) return "not_a_value";
  if (normalise(key).endsWith("fingerprint")) return typeof value === "string" && FINGERPRINT.test(value) ? null : "not_a_fingerprint";
  if (typeof value !== "string" || isIdentifierKey(key)) return null;
  if (/\s/u.test(value)) return "whitespace";
  return PHONE.test(value) ? "phone_number" : null;
}

/** Every problem of a payload; empty when it may be written. */
export function payloadProblems(payload: Readonly<Record<string, unknown>>): AuditProblem[] {
  const problems: AuditProblem[] = [];
  for (const [key, value] of Object.entries(payload)) {
    const problem = isPersonalKey(key) ? "personal_key" : valueProblem(key, value);
    if (problem !== null) problems.push({ key, problem });
  }
  return problems;
}

export const isAuditEvent = (event: string): boolean => EVENT.test(event);
