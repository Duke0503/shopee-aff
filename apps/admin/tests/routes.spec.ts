import { describe, expect, it } from "vitest";
import { ADMIN_ROUTES, routeFromPath } from "../src/routes";

describe("routeFromPath", () => {
  it("reads a known route from the path", () => {
    expect(routeFromPath("/orders")).toBe("orders");
    expect(routeFromPath("/transfers")).toBe("transfers");
  });

  it("falls back to payouts for the root or an unknown path", () => {
    expect(routeFromPath("/")).toBe("payouts");
    expect(routeFromPath("/nope")).toBe("payouts");
  });

  it("lists every screen once", () => {
    expect(new Set(ADMIN_ROUTES).size).toBe(ADMIN_ROUTES.length);
  });
});
