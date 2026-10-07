import { describe, expect, it } from "vitest";
import { assertValidSubId, isValidSubId, toSubId } from "./sub-id";

describe("sub_id validation (letters and digits only)", () => {
  it("accepts letters and digits", () => {
    expect(isValidSubId("R26100612345")).toBe(true);
    expect(isValidSubId("8461752093318820417")).toBe(true);
    expect(isValidSubId("aZ3k9QpL")).toBe(true);
  });

  it("rejects anything a dash or underscore would break", () => {
    expect(isValidSubId("R-261006-12345")).toBe(false);
    expect(isValidSubId("R_261006")).toBe(false);
    expect(isValidSubId("R 261006")).toBe(false);
    expect(isValidSubId("KhánhLy")).toBe(false);
    expect(isValidSubId("")).toBe(false);
  });

  it("throws with a readable message", () => {
    expect(() => assertValidSubId("bad-id")).toThrow(/only a-z, A-Z and 0-9/);
    expect(toSubId("OK123")).toBe("OK123");
  });
});
