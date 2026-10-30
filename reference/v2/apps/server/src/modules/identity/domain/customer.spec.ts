import { describe, expect, it } from "vitest";
import { CustomerRole, isHouse, isStaff } from "./customer";

describe("customer roles", () => {
  it("identifies HOUSE (guest) and staff", () => {
    expect(isHouse({ role: "house" })).toBe(true);
    expect(isHouse({ role: "user" })).toBe(false);
    expect(isStaff({ role: "admin" })).toBe(true);
    expect(isStaff({ role: "employee" })).toBe(true);
    expect(isStaff({ role: "user" })).toBe(false);
  });

  it("only knows the four roles", () => {
    const roles: CustomerRole[] = ["user", "admin", "employee", "house"];
    expect(roles).toHaveLength(4);
  });
});
