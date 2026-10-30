import { describe, expect, it } from "vitest";

import { loadTransitionFixtures } from "../src/transition-fixtures";

const file = loadTransitionFixtures();

describe("transition fixtures (Story 2.6)", () => {
  it("covers the acceptance criteria of Story 2.6 that are golden, and D41's two void outcomes", () => {
    const stories = file.cases.map((c) => c.story);
    for (const story of ["2.6 AC1", "2.6 AC2", "2.6 AC3", "2.6 AC4", "D38", "D41", "D5"]) expect(stories).toContain(story);
    expect(file.cases.filter((c) => c.story === "D41").map((c) => c.expected.next).sort()).toEqual(["APPROVED", "REVERSED"]);
  });

  it("case names are unique and every case says what it expects", () => {
    expect(new Set(file.cases.map((c) => c.name)).size).toBe(file.cases.length);
    for (const c of file.cases) expect(c.expected.effects.length).toBeGreaterThan(0);
  });
});
