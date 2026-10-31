/**
 * The Overview golden ledger (FR-25, NFR-1, Story 4.17): seed rows for a migrated test ledger and
 * every figure the Overview must answer for one period, each computed independently with exact
 * fractions and half-up rounding, never by the server code. The server's Overview query runs it
 * (apps/server/tests/overview.test.ts); this package only holds the data.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface OverviewFixture {
  readonly rule: "overview";
  readonly source: string;
  /** The fixed clock of the run. */
  readonly clock: string;
  readonly query: { readonly period: string; readonly from?: string; readonly to?: string };
  /** SQL statements run in order on the test ledger. */
  readonly seed: readonly string[];
  /** The Overview's figures; `asOf` is the clock and is left out. */
  readonly expected: Readonly<Record<string, unknown>>;
}

export function loadOverviewFixture(): OverviewFixture {
  return JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/overview/overview-ledger.json", import.meta.url)), "utf8")) as OverviewFixture;
}
