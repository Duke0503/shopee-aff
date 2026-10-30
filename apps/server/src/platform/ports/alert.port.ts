/**
 * The owner alert port (AD-27). Any module raises an alert by kind and severity; the
 * operations module implements it with the per-severity cooldowns and sends it to Telegram.
 */

export type AlertSeverity = "critical" | "high" | "warning";

export interface AlertPort {
  /** `kind` is a stable snake_case name (`backup_failed`); the alert carries no personal data. */
  alert(kind: string, severity: AlertSeverity): void;
}
