/**
 * The owner alert port (AD-27, FR-30). Any module raises an alert by kind and severity; the
 * operations module implements it: the alert is stored with a per-severity cooldown (a repeat
 * inside it is counted, not sent again) and delivered to Telegram by a sender outside any
 * transaction. Modules never import operations, so this type is the only edge.
 */

export const ALERT_SEVERITIES = ["critical", "high", "warning"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/**
 * The step that found a problem, or why a request is stuck (D65). `captcha` and `login_lost` are the
 * reasons of a stuck request; the others are the steps that can meet a captcha.
 */
export const ALERT_SOURCES = ["link_request", "product_lookup", "conversion_report", "payout_record", "health_check", "captcha", "login_lost"] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];

/** Ids, names of steps and a page's address only: the customer's name and the product are read when the alert is sent (D65). */
export interface AlertDetail {
  readonly source: AlertSource;
  /** The link request a message is about; its customer is named in the owner's chat only. */
  readonly requestId?: string;
  /** The Shopee page that showed the block, origin and path only (D69). */
  readonly page?: string;
}

export interface AlertPort {
  /** `kind` is a stable snake_case name (`backup_failed`); only the detail can bring a customer into the text (D65). */
  alert(kind: string, severity: AlertSeverity, detail?: AlertDetail): void;
}
