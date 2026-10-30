import { describe, expect, it } from "vitest";

import { loadNetworkFixtures, NETWORK_RULES, PROVENANCES } from "../src/network-fixtures";

const files = loadNetworkFixtures();
const cases = files.flatMap((file) => file.cases.map((c) => ({ file: file.file, ...c })));

/** Shapes of personal data that must never be in a fixture, real or synthetic. */
const PERSONAL = [/\b0\d{9}\b/, /\b\d{12,19}\b(?![0-9])/, /@[a-z0-9-]+\.[a-z]/i];

describe("network fixtures (Story 1.11)", () => {
  it("has a status map and a report fixture for each network", () => {
    expect(files.map((f) => `${f.network}:${f.rule}`).sort()).toEqual([
      "accesstrade:accesstradeLine",
      "accesstrade:accesstradeTransactions",
      "shopee:shopeeConversion",
      "shopee:statusMap",
    ]);
  });

  it("every file names a known rule and its source", () => {
    for (const file of files) {
      expect(NETWORK_RULES).toContain(file.rule);
      expect(file.source.length).toBeGreaterThan(0);
    }
  });

  it("every case is tagged with its provenance", () => {
    for (const c of cases) expect(PROVENANCES, `${c.file}: ${c.name}`).toContain(c.provenance);
  });

  it("case names are unique within a file", () => {
    for (const file of files) {
      const names = file.cases.map((c) => c.name);
      expect(new Set(names).size, file.file).toBe(names.length);
    }
  });

  it("no fixture carries a phone number, a bank or card number, or an e-mail address", () => {
    for (const c of cases) {
      const text = JSON.stringify(c.input).replace(/"(actual_amount|item_price|item_commission|capped_brand_commission|estimated_total_commission|checkout_id)":\s*"?\d+"?/g, "");
      for (const pattern of PERSONAL) expect(text, `${c.file}: ${c.name}`).not.toMatch(pattern);
    }
  });
});
