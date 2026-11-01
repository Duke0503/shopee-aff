/**
 * The assistant's pino JSON logger (AD-27). The message is the event name,
 * `assistant.noun.verb`; tokens, Zalo ids, credentials and message text are redacted wherever
 * they appear in the first two levels of a log object.
 */
import { pino, type Logger } from "pino";

import type { LogLevel } from "./assistant.config";

const SENSITIVE = ["token", "assistantToken", "liveBotToken", "authorization", "cookie", "credentials", "userId", "senderId", "groupId", "zaloId", "text", "greeting", "phone"];

export const REDACT_PATHS = SENSITIVE.flatMap((key) => [key, `*.${key}`]);

export function assistantLogger(level: LogLevel): Logger {
  return pino({ level, base: { process: "assistant" }, redact: { paths: REDACT_PATHS, censor: "[redacted]" } });
}

export type { Logger };
