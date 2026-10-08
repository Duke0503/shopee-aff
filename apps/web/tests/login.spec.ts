import { describe, expect, it } from "vitest";

import { LoginPage } from "../src/login.page";

describe("LoginPage", () => {
  it("is a component", () => {
    expect(typeof LoginPage).toBe("function");
  });
});
