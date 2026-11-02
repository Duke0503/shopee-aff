/**
 * Failed customer sign-ins on codes nobody holds (Story 7.2): counted in memory and written once
 * an hour as one audit entry by the sign-in job, so a spray of made-up codes writes one row an
 * hour, not one per attempt. A restart loses at most an hour of the count; the burst alert has
 * already seen each failure.
 */
export interface UnknownSignInTally {
  note(): void;
  /** The count since the last take, and zero again. */
  take(): number;
}

export function unknownSignInTally(): UnknownSignInTally {
  let count = 0;
  return {
    note: () => void (count += 1),
    take: () => {
      const taken = count;
      count = 0;
      return taken;
    },
  };
}
