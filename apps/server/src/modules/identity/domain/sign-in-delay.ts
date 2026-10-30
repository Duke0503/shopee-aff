/**
 * The doubling sign-in delay (AD-18, D48, FR-9): the first five failures cost nothing; the sixth
 * starts a wait of 1 minute, and each further failure doubles it (2, 4, 8) up to 15 minutes. A
 * fixed lock would let anyone lock every account; a growing wait only slows a guesser down.
 */
const FREE_FAILURES = 5;
const FIRST_DELAY_MS = 60_000;
const MAX_DELAY_MS = 15 * 60_000;

/** How long to wait after `failures` failed sign-ins in a row; 0 for the first five. */
export function signInDelayMs(failures: number): number {
  if (failures <= FREE_FAILURES) return 0;
  return Math.min(MAX_DELAY_MS, FIRST_DELAY_MS * 2 ** (failures - FREE_FAILURES - 1));
}
