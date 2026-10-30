/**
 * Alert cooldowns (AD-27): one alert of a kind and severity goes out, and repeats inside the
 * cooldown are counted on it instead of sent, so a failing job cannot flood the owner's chat.
 * The alert text names the kind, the severity and the repeats only: no personal data.
 */

/** The severities of the alert port (platform/ports/alert.port.ts); domain code imports no port. */
export type AlertSeverity = "critical" | "high" | "warning";

export const ALERT_COOLDOWN_MS: Readonly<Record<AlertSeverity, number>> = {
  critical: 5 * 60_000,
  high: 15 * 60_000,
  warning: 30 * 60_000,
};

export const ALERT_KIND = /^[a-z][a-z0-9_]*$/;

/** True when an alert raised `elapsedMs` after the last one of its kind and severity is a repeat. */
export function insideCooldown(severity: AlertSeverity, elapsedMs: number): boolean {
  return elapsedMs >= 0 && elapsedMs < ALERT_COOLDOWN_MS[severity];
}

export function alertText(alert: { kind: string; severity: AlertSeverity; suppressed: number }): string {
  const repeats = alert.suppressed > 0 ? ` (repeated ${alert.suppressed} more times inside the cooldown)` : "";
  return `[${alert.severity.toUpperCase()}] ${alert.kind}${repeats}`;
}
