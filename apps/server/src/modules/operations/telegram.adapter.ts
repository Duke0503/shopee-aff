/**
 * The Telegram sender for owner alerts (AD-27): one `sendMessage` call to the owner's chat per
 * alert, never inside a transaction. The bot token is a secret from platform/config and appears
 * in no log line or error message. `fetch` is injected so tests use a fake and never reach the
 * network.
 *
 * The message is the owner's Vietnamese text for the alert kind from packages/labels/vi/alerts.json
 * (Story 8.3): the severity word, the label and the repeat count, nothing else, so no personal
 * data, bank number or token can reach the chat.
 */
import ALERT_LABELS from "@cashback/labels/vi/alerts.json" with { type: "json" };

import type { AlertSeverity } from "./domain/alert-cooldown";

const LABELS: Readonly<Record<string, string>> = ALERT_LABELS;

const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);

/** True when the alert kind has its own owner text. */
export const hasAlertLabel = (kind: string): boolean => /^[a-z][a-z0-9_]*$/.test(kind) && !kind.startsWith("severity_") && kind !== "repeated" && kind !== "unknown_kind" && typeof LABELS[kind] === "string";

/** The Telegram text of one stored alert. */
export function telegramText(alert: { kind: string; severity: AlertSeverity; suppressed: number }): string {
  const severity = LABELS[`severity_${alert.severity}`] ?? alert.severity;
  const body = hasAlertLabel(alert.kind) ? (LABELS[alert.kind] as string) : fill(LABELS["unknown_kind"] ?? "{kind}", { kind: alert.kind });
  const repeats = alert.suppressed > 0 ? ` ${fill(LABELS["repeated"] ?? "", { count: String(alert.suppressed) })}` : "";
  return `[${severity}] ${body}${repeats}`;
}

export interface AlertSender {
  send(text: string): Promise<void>;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export interface TelegramOptions {
  botToken: string;
  chatId: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class TelegramSendError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? "telegram: request failed" : `telegram: HTTP ${status}`);
    this.name = "TelegramSendError";
  }
}

const TELEGRAM_API = "https://api.telegram.org";

export function telegramSender(options: TelegramOptions): AlertSender {
  const send: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    async send(text) {
      let response: { ok: boolean; status: number };
      try {
        response = await send(`${TELEGRAM_API}/bot${options.botToken}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: options.chatId, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
      } catch {
        // The error of a failed request may carry the URL, and the URL carries the token.
        throw new TelegramSendError(null);
      }
      if (!response.ok) throw new TelegramSendError(response.status);
    },
  };
}
