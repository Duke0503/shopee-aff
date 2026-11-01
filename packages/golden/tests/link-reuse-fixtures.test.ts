import { describe, expect, it } from "vitest";

import { loadLinkReuseFixtures } from "../src/link-reuse-fixtures";

const file = loadLinkReuseFixtures();

describe("link reuse fixtures (Story 5.2)", () => {
  it("covers every acceptance criterion of Story 5.2 and starts with the 2026-09-25 production case", () => {
    const stories = new Set(file.cases.map((c) => c.story));
    for (const ac of ["5.2 AC1", "5.2 AC2", "5.2 AC3", "5.2 AC4", "5.2 AC5"]) expect(stories).toContain(ac);
    expect(file.cases[0]?.name).toMatch(/^2026-09-25/);
    expect(file.cases[0]?.expected).toEqual({ reused: false, customerId: "1000000000000000002" });
  });

  it("case names are unique; every request and alias names a known customer; a reused answer names an existing request", () => {
    expect(new Set(file.cases.map((c) => c.name)).size).toBe(file.cases.length);
    const ids = file.directory.customers.map((c) => c.id);
    for (const [alias, target] of Object.entries(file.directory.aliases)) expect(ids).toEqual(expect.arrayContaining([alias, target]));
    for (const c of file.cases) {
      for (const r of c.existing) expect(ids).toContain(r.customer);
      if (c.expected.reused) expect(c.existing.map((r) => r.requestId)).toContain(c.expected.requestId);
    }
  });
});
