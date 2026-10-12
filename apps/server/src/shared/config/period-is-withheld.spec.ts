import { afterEach, describe, expect, it } from "vitest";

import { periodIsWithheld } from "./period-is-withheld";

const ORIGINAL = process.env.PAYOUT_PERIOD_WITHHELD;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PAYOUT_PERIOD_WITHHELD;
  else process.env.PAYOUT_PERIOD_WITHHELD = ORIGINAL;
});

describe("periodIsWithheld", () => {
  it("is false when the environment says nothing, as Python defaults", () => {
    delete process.env.PAYOUT_PERIOD_WITHHELD;
    expect(periodIsWithheld()).toBe(false);
  });

  it("accepts the same truthy words as Python, whatever the case", () => {
    for (const value of ["1", "true", "yes", "TRUE", " yes "]) {
      process.env.PAYOUT_PERIOD_WITHHELD = value;
      expect(periodIsWithheld()).toBe(true);
    }
  });

  it("treats anything else as not withheld", () => {
    for (const value of ["", "0", "false", "no", "on"]) {
      process.env.PAYOUT_PERIOD_WITHHELD = value;
      expect(periodIsWithheld()).toBe(false);
    }
  });
});
