import { describe, expect, it } from "vitest";

import { loadAttributionFixtures } from "../src/attribution-fixtures";

const file = loadAttributionFixtures();

describe("attribution fixtures (Story 2.7)", () => {
  it("covers every acceptance criterion of Story 2.7", () => {
    const stories = new Set(file.cases.map((c) => c.story));
    for (const ac of ["2.7 AC1", "2.7 AC2", "2.7 AC3", "2.7 AC4", "2.7 AC5"]) expect(stories).toContain(ac);
  });

  it("case names are unique; aliases, guests and erased rows point at known customers", () => {
    expect(new Set(file.cases.map((c) => c.name)).size).toBe(file.cases.length);
    const { customers, aliases, guests, erased } = file.directory;
    for (const id of [...Object.values(aliases), ...guests, ...erased]) expect(customers).toContain(id);
  });

  it("covers D58: an unresolved sub_id1 is a review case, an empty sub_id1 may use the sub_id2 owner", () => {
    const d58 = file.cases.filter((c) => c.story === "D58").map((c) => c.expected);
    expect(d58).toContainEqual(expect.objectContaining({ kind: "review", reason: "unattributed_sub_id1" }));
    expect(d58).toContainEqual(expect.objectContaining({ kind: "customer", source: "sub_id2" }));
  });
});
