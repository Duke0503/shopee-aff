import { describe, expect, it } from "vitest";

import { shortDate, shortDateTime } from "../src/shared/lib/dates";

describe("shortDate", () => {
  it("writes a server timestamp day-first", () => {
    expect(shortDate("2026-10-05T09:00:00")).toBe("05/10/2026");
  });

  it("has nothing to show for a moment that never happened", () => {
    expect(shortDate(null)).toBe("");
    expect(shortDate("not a date")).toBe("");
  });
});

describe("shortDateTime", () => {
  it("keeps the hour and minute", () => {
    expect(shortDateTime("2026-10-05T09:07:00")).toBe("05/10/2026 09:07");
  });

  it("has nothing to show for a moment that never happened", () => {
    expect(shortDateTime(null)).toBe("");
  });
});
