/**
 * Order transition fixtures (AD-7, NFR-1): an order, one observation and its context, with the
 * next state, the steps and the effects `transition()` must give. Each case follows a row of the
 * transition table in docs/operations/status-flows.md. The server's orders module runs them
 * (apps/server/tests/order-transition.test.ts); this package only holds the data.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface TransitionCase {
  name: string;
  story: string;
  order: Record<string, unknown> | null;
  observation: Record<string, unknown>;
  context: Record<string, unknown>;
  expected: { next: string | null; steps: [string | null, string][]; effects: Record<string, unknown>[] };
}

export interface TransitionFixtureFile {
  rule: "transition";
  source: string;
  cases: TransitionCase[];
}

export const TRANSITION_FIXTURE = fileURLToPath(new URL("../fixtures/transition/transition.json", import.meta.url));

export function loadTransitionFixtures(path: string = TRANSITION_FIXTURE): TransitionFixtureFile {
  return JSON.parse(readFileSync(path, "utf8")) as TransitionFixtureFile;
}
