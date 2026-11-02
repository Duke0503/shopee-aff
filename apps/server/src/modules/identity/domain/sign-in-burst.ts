/**
 * A burst of failed customer sign-ins across codes (AD-18, NFR-5; Story 7.2 AC3). The per-code
 * delay slows a guesser on one code; someone spraying one password over many codes never waits,
 * so the owner hears about it instead: once 50 failures land within 10 minutes, one alert. While
 * failures keep that pace no second alert is raised; a failure arriving after the pace has dropped
 * re-arms the watch. Only the last 50 failure times are kept, so a long attack holds no more.
 */
export const SIGN_IN_BURST = { failures: 50, windowMs: 10 * 60_000 } as const;

export interface SignInBurstWatch {
  /** Notes one failed sign-in at `atMs`; true exactly when this failure starts a burst. */
  failed(atMs: number): boolean;
}

export function signInBurstWatch(limits: { readonly failures: number; readonly windowMs: number } = SIGN_IN_BURST): SignInBurstWatch {
  const recent: number[] = [];
  let raised = false;
  return {
    failed(atMs) {
      recent.push(atMs);
      if (recent.length > limits.failures) recent.shift();
      const oldest = recent[0] ?? atMs;
      const burst = recent.length === limits.failures && atMs - oldest < limits.windowMs;
      if (!burst) {
        raised = false;
        return false;
      }
      if (raised) return false;
      raised = true;
      return true;
    },
  };
}
