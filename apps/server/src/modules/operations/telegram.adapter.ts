/**
 * The Telegram sender (AD-27): one `sendMessage` call per message, never inside a transaction, to
 * the chat it is bound to: the owner's chat for alerts, and the DP Business group's chat for the
 * order, settlement and new-member notices (D62, D63, D64); an order notice's text carries a customer's name and id, and a new-member notice a joiner's name and Zalo id. The bot token is a secret from platform/config and appears
 * in no log line or error message. `fetch` is injected so tests use a fake and never reach the
 * network.
 *
 * The message is the owner's Vietnamese text for the alert kind from packages/labels/vi/alerts.json
 * (Story 8.3), in the live system's Telegram format (src/cashback/core/telegram_alerts.py
 * `report_bug`, owner requirement 2026-11-02): the severity header with the title, the source, the
 * Vietnam time `HH:MM:SS - DD/MM/YYYY`, the details and the action, sent with `parse_mode: HTML`.
 * Every text is escaped as the live `_sanitize_html` did. `telegramText` fills in only the label
 * file's words, the time, the repeat count and, for an alert about one link request, the facts its
 * caller read for it (the customer's name and id and the product, D65). So no bank number or token
 * can reach the chat through an alert, and a name only through those facts; that guarantee belongs
 * to `telegramText`, not to `telegramSender`.
 */
import { formatVnAlertStamp, type Instant } from "@cashback/core";
import ALERT_LABELS from "@cashback/labels/vi/alerts.json" with { type: "json" };

import type { AlertDetail } from "../../platform/ports/alert.port";
import type { AlertSeverity } from "./domain/alert-cooldown";

/** What one step says in place of its kind's own words. */
interface StepText {
  readonly details: string;
  readonly source?: string;
  readonly action?: string;
}

/** Who and what an alert about one link request names; a null name or product is left out (D65). */
export interface AlertRequestFacts {
  readonly id: string;
  readonly name: string | null;
  readonly product: string | null;
}

interface KindText {
  readonly title: string;
  readonly details: string;
  readonly source?: string;
  readonly action?: string;
  /** By the detail's source: the words that name the step that found it (D65). */
  readonly steps?: Readonly<Record<string, StepText>>;
  /** The header of another severity, where the live system showed that one for the same alert. */
  readonly badge?: string;
}

const LABELS = ALERT_LABELS as unknown as Readonly<Record<string, string>> & { readonly kinds: Readonly<Record<string, KindText>>; readonly unknown_kind: KindText };

const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);

/** As the live `_sanitize_html`: `&`, `<` and `>` escaped for Telegram's HTML mode. */
const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** True when the alert kind has its own owner text. */
export const hasAlertLabel = (kind: string): boolean => /^[a-z][a-z0-9_]*$/.test(kind) && Object.hasOwn(LABELS.kinds, kind);

const isSeverity = (value: string | undefined): value is AlertSeverity => value === "critical" || value === "high" || value === "warning";

/** The kind's words, with those of the step the detail names when the kind has its own for it. */
function wordsOf(kind: string, detail: AlertDetail | null | undefined): KindText {
  const known = hasAlertLabel(kind) ? LABELS.kinds[kind] : undefined;
  if (known === undefined) return { title: LABELS.unknown_kind.title, details: fill(LABELS.unknown_kind.details, { kind }) };
  const step = detail !== null && detail !== undefined && known.steps !== undefined && Object.hasOwn(known.steps, detail.source) ? known.steps[detail.source] : undefined;
  return step === undefined ? known : { ...known, ...step };
}

function requestLines(facts: AlertRequestFacts): string[] {
  const named = facts.name !== null && facts.name !== facts.id;
  const customer = named ? fill(LABELS["line_customer_named"] ?? "", { name: facts.name ?? "", id: facts.id }) : fill(LABELS["line_customer_id"] ?? "", { id: facts.id });
  return facts.product === null ? [customer] : [customer, fill(LABELS["line_product"] ?? "", { product: facts.product })];
}

/** The Telegram text (HTML) of one stored alert, stamped with the time it was raised. */
export function telegramText(alert: { kind: string; severity: AlertSeverity; suppressed: number; raisedAt: string; detail?: AlertDetail | null }, request?: AlertRequestFacts | null): string {
  const text = wordsOf(alert.kind, alert.detail);
  const details = request === null || request === undefined ? text.details : [text.details, ...requestLines(request)].join("\n");
  const severity = isSeverity(text.badge) ? text.badge : alert.severity;
  const lines = [
    fill(LABELS[`header_${severity}`] ?? "{title}", { title: escapeHtml(text.title) }),
    fill(LABELS["line_source"] ?? "", { source: escapeHtml(text.source ?? LABELS["default_source"] ?? "") }),
    fill(LABELS["line_time"] ?? "", { time: formatVnAlertStamp(alert.raisedAt as Instant) }),
    fill(LABELS["line_details"] ?? "", { details: escapeHtml(details) }),
  ];
  if (text.action !== undefined) lines.push(fill(LABELS["line_action"] ?? "", { action: escapeHtml(text.action) }));
  if (alert.suppressed > 0) lines.push(fill(LABELS["line_repeated"] ?? "", { count: String(alert.suppressed) }));
  return lines.join("\n");
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
          body: JSON.stringify({ chat_id: options.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
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
