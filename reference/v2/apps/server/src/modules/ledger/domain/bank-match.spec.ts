import { describe, expect, it } from "vitest";
import { findBank, plain, type BankInfo } from "./bank-match";

const catalogue: BankInfo[] = [
  { code: "VCB", shortName: "Vietcombank", bin: "970436", name: "Ngân hàng TMCP Ngoại Thương Việt Nam" },
  { code: "TCB", shortName: "Techcombank", bin: "970407", name: "Ngân hàng TMCP Kỹ Thương Việt Nam" },
  { code: "MB", shortName: "MB Bank", bin: "970422", name: "Ngân hàng TMCP Quân Đội" },
];

describe("plain", () => {
  it("lowercases, strips diacritics and punctuation", () => {
    expect(plain("Ngân hàng  TMCP")).toBe("nganhangtmcp");
  });
});

describe("findBank", () => {
  it("matches an exact spelling or short name", () => {
    expect(findBank("Vietcombank", catalogue)?.bin).toBe("970436");
    expect(findBank("vcb", catalogue)?.bin).toBe("970436");
    expect(findBank("MB Bank", catalogue)?.bin).toBe("970422");
  });

  it("matches the distinctive part of a full name", () => {
    expect(findBank("Ngan hang TMCP Ngoai Thuong Viet Nam", catalogue)?.bin).toBe("970436");
  });

  it("returns null when nothing matches, or the answer is ambiguous", () => {
    expect(findBank("some credit union", catalogue)).toBeNull();
    expect(findBank("", catalogue)).toBeNull();
    // "ngan hang" appears in every bank's full name: ambiguous -> null.
    expect(findBank("ngan hang", catalogue)).toBeNull();
  });
});
