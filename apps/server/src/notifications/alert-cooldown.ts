import type { AlertSeverity } from "./telegram-alerts";

/**
 * The anti-spam pause for owner alerts, ported from `telegram_alerts`. It is
 * deliberately in memory: restarting the server clears it, exactly like
 * today's Python, and the pause is not worth a table of its own.
 */

/** How long each severity stays quiet after it has been reported (seconds). */
const PAUSE_SECONDS: Record<AlertSeverity, number> = {
  CRITICAL: 300,
  HIGH: 900,
  WARNING: 1800,
};

/** Anything the parser does not recognise falls back to ten minutes. */
const DEFAULT_PAUSE_SECONDS = 600;

export class AlertCooldown {
  private readonly lastSentAt = new Map<string, number>();
  private readonly open = new Map<string, boolean>();

  /**
   * True when this alert may go out now — and remembers that it did. `force`
   * skips the pause but still records the send, as the Python did.
   */
  allow(fingerprint: string, severity: string, force: boolean, nowMs: number): boolean {
    const seconds = PAUSE_SECONDS[severity.toUpperCase() as AlertSeverity] ?? DEFAULT_PAUSE_SECONDS;
    const last = this.lastSentAt.get(fingerprint);
    if (!force && last !== undefined && nowMs - last < seconds * 1000) return false;
    this.lastSentAt.set(fingerprint, nowMs);
    this.open.set(fingerprint, true);
    return true;
  }

  /**
   * True when a recovery is worth sending, meaning the alert was still open.
   * Clears the state either way, so a second "recovered" stays quiet.
   */
  recover(fingerprint: string): boolean {
    const wasOpen = this.open.get(fingerprint) ?? false;
    this.open.set(fingerprint, false);
    this.lastSentAt.delete(fingerprint);
    return wasOpen;
  }
}

/** The injection token for the shared pause state. */
export const ALERT_COOLDOWN = Symbol("ALERT_COOLDOWN");
