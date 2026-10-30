import { LOCKOUT_MINUTES, MAX_ATTEMPTS } from "./password-policy";

/**
 * The sign-in decision, ported from `core/accounts.py::authenticate`.
 * Pure: "now" is passed in, never read from the clock inside a rule.
 *
 *   - five wrong guesses inside the window lock the account for 15 minutes
 *   - on locking, failed_logins resets to 0 and locked_until is set
 *   - a non-locking failure also clears locked_until (as the Python does)
 */
export type LoginOutcome = "ok" | "bad_credentials" | "locked";

export interface LoginState {
  failedLogins: number;
  lockedUntil: string | null;
  status: string;
}

export interface FailedAttemptResult {
  failedLogins: number;
  lockedUntil: string | null;
  outcome: LoginOutcome;
}

/** ISO timestamps compare chronologically as strings, as in the Python. */
export function isLocked(lockedUntil: string | null, nowIso: string): boolean {
  return lockedUntil !== null && lockedUntil !== "" && lockedUntil > nowIso;
}

/** Local-naive ISO, matching the Python's stamps (no UTC shift). */
function addMinutes(iso: string, minutes: number): string {
  const at = new Date(Date.parse(iso) + minutes * 60_000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

/** The new counters and the message after one wrong password. */
export function nextFailedAttempt(state: LoginState, nowIso: string): FailedAttemptResult {
  const failures = (state.failedLogins || 0) + 1;
  if (failures >= MAX_ATTEMPTS) {
    return { failedLogins: 0, lockedUntil: addMinutes(nowIso, LOCKOUT_MINUTES), outcome: "locked" };
  }
  return { failedLogins: failures, lockedUntil: null, outcome: "bad_credentials" };
}
