import { describe, expect, it } from "vitest";
import { WEB_ROUTES, routeFromPath } from "../src/routes";

describe("routeFromPath", () => {
  it("reads a known route from the path", () => {
    expect(routeFromPath("/deals")).toBe("deals");
    expect(routeFromPath("/balance")).toBe("balance");
  });

  it("falls back to home for the root or an unknown path", () => {
    expect(routeFromPath("/")).toBe("home");
    expect(routeFromPath("/nope")).toBe("home");
  });

  it("lists every screen once", () => {
    expect(new Set(WEB_ROUTES).size).toBe(WEB_ROUTES.length);
  });
});
