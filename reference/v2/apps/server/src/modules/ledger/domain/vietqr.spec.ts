import { describe, expect, it } from "vitest";
import type { BankInfo } from "./bank-match";
import { buildVietQr, type VietQrInput } from "./vietqr";

const catalogue: BankInfo[] = [
  { code: "VCB", shortName: "Vietcombank", bin: "970436", name: "Ngân hàng TMCP Ngoại Thương Việt Nam" },
  { code: "TCB", shortName: "Techcombank", bin: "970407" },
];

const input = (over: Partial<VietQrInput> = {}): VietQrInput => ({
  bankName: "Vietcombank",
  accountNumber: "123456789",
  amountVnd: 39_608,
  note: "DP00012 HD123",
  ...over,
});

describe("buildVietQr", () => {
  it("fills the QR fields for a known bank", () => {
    expect(buildVietQr(input(), catalogue)).toEqual({
      bankBin: "970436",
      accountNumber: "123456789",
      amountVnd: 39_608,
      note: "DP00012 HD123",
    });
  });

  it("makes NO QR when the bank cannot be matched", () => {
    expect(buildVietQr(input({ bankName: "some credit union" }), catalogue)).toBeNull();
  });

  it("makes NO QR when the match is ambiguous", () => {
    expect(buildVietQr(input({ bankName: "ngan hang" }), catalogue)).toBeNull();
  });
});
