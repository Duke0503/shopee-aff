/**
 * The shared pino logger (AD-27, code.md §9, NFR-6). Every server log line goes through
 * it, so redaction applies everywhere: bank numbers, phone numbers, Zalo ids, tokens,
 * secrets, session ids, passwords and auth headers never reach a log. Redaction walks the
 * whole object, so a sensitive key is caught at any depth, in arrays and in child
 * bindings, whatever its spelling (`sessionId`, `session_id`, `Session-Id`).
 * The message is the event name, `context.noun.verb`.
 */
import { pino, type DestinationStream, type Logger } from "pino";

import type { LogLevel } from "../config/env.config";

export type { Logger } from "pino";

export const REDACTED = "[redacted]";

/** Keys whose value is personal data or a secret, as they are commonly spelled. */
export const SENSITIVE_KEYS = [
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "internalToken",
  "bridgeToken",
  "x-internal-token",
  "x-bridge-token",
  "secret",
  "fingerprintKey",
  "authorization",
  "cookie",
  "set-cookie",
  "sessionId",
  "sessionToken",
  "phone",
  "phoneNumber",
  "bankNumber",
  "bankAccountNumber",
  "accountNumber",
  "zaloId",
  "zaloUid",
] as const;

/** A key is compared with case and separators removed. */
const normalise = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const EXACT = new Set(SENSITIVE_KEYS.map(normalise));
/** Any key containing one of these is sensitive (`fingerprintSecret`, `refresh_token`). */
const CONTAINS = ["password", "token", "secret", "cookie", "sessionid", "phone", "accountnumber", "banknumber", "zaloid", "zalouid"];

export function isSensitiveKey(key: string): boolean {
  const n = normalise(key);
  return EXACT.has(n) || CONTAINS.some((part) => n.includes(part));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    return value.map((item) => redactValue(item, seen));
  }
  if (!isPlainObject(value)) return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) result[key] = isSensitiveKey(key) ? REDACTED : redactValue(inner, seen);
  return result;
}

/** A copy of `object` with every sensitive key's value replaced, at any depth. */
export function redact(object: Record<string, unknown>): Record<string, unknown> {
  return redactValue(object, new WeakSet()) as Record<string, unknown>;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Defaults to stdout; tests pass a stream to read the lines back. */
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const settings = { level: options.level ?? "info", formatters: { log: redact, bindings: redact } };
  const logger = options.destination ? pino(settings, options.destination) : pino(settings);
  // pino drops the bindings formatter for children, so child bindings are redacted here;
  // every child (Fastify's per-request loggers included) inherits this method.
  const child = logger.child;
  logger.child = function (this: Logger, bindings, childOptions) {
    return child.call(this, redact(bindings), childOptions);
  } as Logger["child"];
  return logger;
}
