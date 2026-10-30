import { describe, expect, it } from "vitest";
import { EMPTY_BANK_DETAILS, eraseBankDetails, hasBankDetails, saveBankDetails } from "./bank-details";

describe("bank details", () => {
  it("records consent when saved", () => {
    const saved = saveBankDetails("VCB", "123", "LE VAN C", "2026-10-07T10:00:00");
    expect(saved.consentAt).toBe("2026-10-07T10:00:00");
    expect(hasBankDetails(saved)).toBe(true);
  });

  it("erases all four fields together", () => {
    expect(eraseBankDetails()).toEqual(EMPTY_BANK_DETAILS);
  });

  it("only a missing account number blocks a payout", () => {
    expect(hasBankDetails({ bankAccount: null })).toBe(false);
    expect(hasBankDetails({ bankAccount: "123" })).toBe(true);
  });
});
