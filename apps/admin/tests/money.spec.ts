import { describe, expect, it } from "vitest";

import bundled from "../../../resources/dashboard.vi.json";
import type { Labels } from "../src/shared/lib/labels";
import { vnd, vndOrDash } from "../src/shared/lib/money";

const labels = bundled as Labels;

describe("vnd", () => {
  it("writes đồng the way readers write it, a dot every three digits", () => {
    expect(vnd(0, labels)).toBe("0đ");
    expect(vnd(12_000, labels)).toBe("12.000đ");
    expect(vnd(1_234_567, labels)).toBe("1.234.567đ");
  });

  it("keeps whole đồng: no decimals ever reach the screen", () => {
    expect(vnd(999.6, labels)).toBe("1.000đ");
  });
});

describe("vndOrDash", () => {
  it("shows the dash when the server sent no figure", () => {
    expect(vndOrDash(null, labels)).toBe("—");
    expect(vndOrDash(12_345, labels)).toBe("12.345đ");
  });
});
