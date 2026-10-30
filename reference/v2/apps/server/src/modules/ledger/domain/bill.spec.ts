import { describe, expect, it } from "vitest";

import {
  billReference,
  billTime,
  createBillToken,
  isLegacyBillNumber,
  proofFileName,
} from "./bill";

describe("createBillToken", () => {
  it("is long, url safe and different every time", () => {
    const first = createBillToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first).not.toBe(createBillToken());
  });
});

describe("billReference", () => {
  it("keeps the reference the owner typed", () => {
    expect(billReference("FT123", 7)).toBe("FT123");
  });

  it("falls back to a padded number when none was typed", () => {
    expect(billReference(null, 7)).toBe("DP00007");
    expect(billReference("   ", 123456)).toBe("DP123456");
  });
});

describe("billTime", () => {
  it("reads as a receipt date", () => {
    expect(billTime("2026-10-12T08:30:05")).toBe("12/10/2026 08:30");
  });

  it("gives back what it cannot parse", () => {
    expect(billTime("nonsense")).toBe("nonsense");
  });
});

describe("isLegacyBillNumber", () => {
  it("tells an old numbered link from a token", () => {
    expect(isLegacyBillNumber("123")).toBe(true);
    expect(isLegacyBillNumber("12a")).toBe(false);
    expect(isLegacyBillNumber("")).toBe(false);
  });
});

describe("proofFileName", () => {
  it("takes the name out of one of our own proof urls", () => {
    expect(proofFileName("https://hoantiendp.com/uploads/proofs/proof_1.jpg")).toBe("proof_1.jpg");
    expect(proofFileName("/uploads/proofs/proof_1.jpg?v=2")).toBe("proof_1.jpg");
  });

  it("refuses a foreign proof, an empty one, or one that walks out of the folder", () => {
    expect(proofFileName("https://drive.google.com/file/d/abc/view")).toBe("");
    expect(proofFileName(null)).toBe("");
    expect(proofFileName("/uploads/proofs/")).toBe("");
    expect(proofFileName("/uploads/proofs/../../secrets.txt")).toBe("");
    expect(proofFileName("/uploads/proofs/..%2Fetc%2Fpasswd")).toBe("");
  });
});
