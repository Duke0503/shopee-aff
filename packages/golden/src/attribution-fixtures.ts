/**
 * Attribution fixtures (AD-8, D5, D6, D7, NFR-1): report sub_ids against a small customer
 * directory, with the owner or review case the rule must produce. The server's orders module
 * runs them (apps/server/tests/attribution.test.ts); this package only holds the data.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface AttributionDirectoryData {
  /** Customer ids that exist (any status). */
  customers: string[];
  /** Customers whose role is HOUSE (the guest account, D5). */
  guests: string[];
  /** Customers whose status is ERASED: their old links attribute to them, earning nothing like a guest (FR-35). */
  erased: string[];
  /** Alias to surviving customer id. */
  aliases: Record<string, string>;
  /** Link request id to the customer id stored on it (which may resolve to nobody). */
  requests: Record<string, string>;
}

export interface AttributionCase {
  name: string;
  story?: string;
  input: { subIds: string[]; production: boolean };
  expected: unknown;
}

export interface AttributionFixtureFile {
  rule: "attribute";
  source: string;
  directory: AttributionDirectoryData;
  cases: AttributionCase[];
}

export const ATTRIBUTION_FIXTURE = fileURLToPath(new URL("../fixtures/attribution/attribution.json", import.meta.url));

export function loadAttributionFixtures(path: string = ATTRIBUTION_FIXTURE): AttributionFixtureFile {
  return JSON.parse(readFileSync(path, "utf8")) as AttributionFixtureFile;
}
