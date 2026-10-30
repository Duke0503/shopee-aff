import { splitCommission } from "@cashback/money";
import { describe, expect, it } from "vitest";

import { loadReportApplyFixtures } from "../src/report-apply-fixtures";

const file = loadReportApplyFixtures();

describe("report apply fixtures (Stories 3.3, 3.4)", () => {
  it("covers the golden acceptance criteria of Stories 3.3 and 3.4", () => {
    const stories = new Set([...file.approvals, ...file.repeats].map((c) => c.story));
    for (const ac of ["3.3 AC2", "3.3 AC5", "3.4 AC1", "3.4 AC2", "3.4 AC3", "3.4 AC4", "3.4 AC5"]) expect(stories).toContain(ac);
  });

  it("case names are unique", () => {
    const names = [...file.approvals, ...file.repeats].map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every approval stores the money package's split of the approved commission, never of the estimate", () => {
    for (const c of file.approvals) {
      const withheld = c.network === "accesstrade" || c.periodMark !== false;
      const split = splitCommission({ approvedCommission: c.expected.approvedCommission, network: c.network, withheld, guest: c.guest });
      expect({ fee: split.fee, tax: split.tax, cashback: split.cashback, withheld }, c.name).toEqual({ fee: c.expected.fee, tax: c.expected.tax, cashback: c.expected.cashback, withheld: c.expected.withheld });
      expect(c.approvedParts.reduce((a, b) => a + b, 0), c.name).toBe(c.expected.approvedCommission);
    }
  });
});
