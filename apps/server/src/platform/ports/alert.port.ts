/**
 * The owner alert port (AD-27, FR-30). Any module raises an alert by kind and severity; the
 * operations module implements it: the alert is stored with a per-severity cooldown (a repeat
 * inside it is counted, not sent again) and delivered to Telegram by a sender outside any
 * transaction. Modules never import operations, so this type is the only edge.
 */

export const ALERT_SEVERITIES = ["critical", "high", "warning"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface AlertPort {
  /** `kind` is a stable snake_case name (`backup_failed`); the alert carries no personal data. */
  alert(kind: string, severity: AlertSeverity): void;
}
