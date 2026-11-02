/**
 * One client's failed customer sign-ins across every code (AD-18, NFR-5; Story 7.2). The per-code
 * delay is kept per (code, client) so nobody can lock another person out; this window is what
 * stops one client from trying one password on many codes: 20 failures within 10 minutes make
 * that client wait 10 minutes from the twentieth, whatever code it tries next.
 */
export const CLIENT_SIGN_IN_LIMIT = { failures: 20, windowMs: 10 * 60_000 } as const;

export interface ClientWindow {
  readonly windowStartedMs: number;
  readonly failures: number;
  readonly lockedUntilMs: number | null;
}

export function clientAfterFailure(prev: ClientWindow | null, nowMs: number, limit: { readonly failures: number; readonly windowMs: number } = CLIENT_SIGN_IN_LIMIT): ClientWindow {
  if (prev === null || nowMs - prev.windowStartedMs >= limit.windowMs) return { windowStartedMs: nowMs, failures: 1, lockedUntilMs: limit.failures <= 1 ? nowMs + limit.windowMs : null };
  const failures = prev.failures + 1;
  return { windowStartedMs: prev.windowStartedMs, failures, lockedUntilMs: failures >= limit.failures ? nowMs + limit.windowMs : prev.lockedUntilMs };
}
