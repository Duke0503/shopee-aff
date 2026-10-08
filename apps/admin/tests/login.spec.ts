import { describe, expect, it } from "vitest";

import { AdminLoginPage } from "../src/login.page";

describe("AdminLoginPage", () => {
  it("is a component", () => {
    expect(typeof AdminLoginPage).toBe("function");
  });
});
