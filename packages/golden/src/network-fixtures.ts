/**
 * Network report fixtures (AD-22, D38, NFR-1): raw report rows in the exact shape each
 * network sends, with the statuses, amounts and signal they must produce. The server's
 * linking and orders modules run them (apps/server/tests/network-golden.test.ts); this
 * package only holds and checks the data, so it imports no app code.
 *
 * Every case says where it came from. `synthetic-from-code` rows reproduce the field
 * shapes and status strings of the live Python readers; `real-anonymised` rows are real
 * report rows with personal data removed, dropped in by the owner (fixtures/networks/README.md).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROVENANCES = ["synthetic-from-code", "real-anonymised"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const NETWORK_RULES = ["statusMap", "accesstradeLine", "shopeeConversion", "accesstradeTransactions", "shopeeExportStatus", "shopeeExportAmount"] as const;
export type NetworkRule = (typeof NETWORK_RULES)[number];

export interface NetworkCase {
  name: string;
  provenance: Provenance;
  /** The acceptance criterion the case covers, e.g. "1.11 AC1". */
  story?: string;
  input: Record<string, unknown>;
  expected: unknown;
}

export interface NetworkFixtureFile {
  file: string;
  rule: NetworkRule;
  network: "shopee" | "accesstrade";
  source: string;
  cases: NetworkCase[];
}

export const NETWORK_FIXTURES_DIR = fileURLToPath(new URL("../fixtures/networks", import.meta.url));

export function loadNetworkFixtures(dir: string = NETWORK_FIXTURES_DIR): NetworkFixtureFile[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ file, ...(JSON.parse(readFileSync(join(dir, file), "utf8")) as Omit<NetworkFixtureFile, "file">) }));
}
