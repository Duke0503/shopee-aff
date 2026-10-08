import { RequestId } from "@mmo/contracts";
import { describe, expect, it } from "vitest";
import { newRequestId } from "./request-id";

describe("newRequestId", () => {
  it("matches the R + 11 digits shape", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(RequestId.safeParse(newRequestId()).success).toBe(true);
    }
  });

  it("encodes the date", () => {
    expect(newRequestId(new Date(2026, 9, 6)).startsWith("R261006")).toBe(true);
  });

  it("does not repeat", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
