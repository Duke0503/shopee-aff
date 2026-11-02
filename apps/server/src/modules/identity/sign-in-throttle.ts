/**
 * The doubling sign-in delay (AD-18, D48), shared by staff and customer sign-in. Each sign-in
 * keeps its failures in its own table under its own key (staff: submitted name and Access
 * identity; customers: code and client key); a store binds that row to one transaction handle,
 * and these two functions are the only rules applied to it.
 */
import { instantFromMs, toMs, type Clock } from "@cashback/core";

import { signInDelayMs } from "./domain/sign-in-delay";

export interface Throttle {
  readonly failures: number;
  readonly lockedUntil: string | null;
}

export interface ThrottleStore {
  read(): Throttle | null;
  save(next: Throttle, at: string): void;
}

/** Until when the key still waits, or null when it may try now. */
export function waitingUntil(store: ThrottleStore, clock: Clock): string | null {
  const lockedUntil = store.read()?.lockedUntil ?? null;
  return lockedUntil !== null && lockedUntil > clock.now() ? lockedUntil : null;
}

/** Counts one more failure and starts the wait the count calls for. */
export function countFailure(store: ThrottleStore, clock: Clock): Throttle {
  const now = clock.now();
  const failures = (store.read()?.failures ?? 0) + 1;
  const delay = signInDelayMs(failures);
  const next: Throttle = { failures, lockedUntil: delay > 0 ? instantFromMs(toMs(now) + delay) : null };
  store.save(next, now);
  return next;
}
