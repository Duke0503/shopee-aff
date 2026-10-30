/**
 * Story 4.7: the VietQR payload is built in-house (NAPAS EMVCo) for one bank BIN, one account, one
 * amount and one transfer content, and a written bank name maps to a BIN only when exactly one
 * VietQR bank matches it (M-7).
 */
import { describe, expect, it } from "vitest";

import { distinctiveBankText, findVietQrBank, VIETQR_BANKS, type VietQrBank } from "../src/modules/identity/index";
import { crc16Ccitt, vietQrPayload, VietQrError } from "../src/modules/payouts/index";
import { tlv } from "./helpers/emv-tlv";

const INPUT = { bankBin: "970436", accountNumber: "0071000123456", amount: 79216, content: "DP00012 K7Q2M9XA" };

describe("VietQR payload (Story 4.7)", () => {
  it("CRC-16/CCITT-FALSE gives the standard check value", () => {
    expect(crc16Ccitt("123456789")).toBe("29B1");
  });

  it("carries the NAPAS account, exactly the amount and the transfer content, and a valid CRC", () => {
    const payload = vietQrPayload(INPUT);
    const fields = Object.fromEntries(tlv(payload));
    expect(fields).toMatchObject({ "00": "01", "01": "12", "53": "704", "54": "79216", "58": "VN" });
    expect(Object.fromEntries(tlv(fields["38"] ?? ""))).toEqual({ "00": "A000000727", "01": "00069704360113" + "0071000123456", "02": "QRIBFTTA" });
    expect(Object.fromEntries(tlv(fields["62"] ?? ""))).toEqual({ "08": "DP00012 K7Q2M9XA" });
    expect(payload.slice(-8, -4)).toBe("6304");
    expect(payload.slice(-4)).toBe(crc16Ccitt(payload.slice(0, -4)));
  });

  it("is the same text for the same input (golden)", () => {
    expect(vietQrPayload(INPUT)).toBe("00020101021238570010A00000072701270006970436011300710001234560208QRIBFTTA530370454057921658" + "02VN62200816DP00012 K7Q2M9XA6304" + crc16Ccitt("00020101021238570010A00000072701270006970436011300710001234560208QRIBFTTA53037045405792165802VN62200816DP00012 K7Q2M9XA6304"));
  });

  it("refuses a zero amount, a bad BIN, a bad account number and content a bank would cut or reject", () => {
    expect(() => vietQrPayload({ ...INPUT, amount: 0 })).toThrow(VietQrError);
    expect(() => vietQrPayload({ ...INPUT, amount: 1.5 })).toThrow(VietQrError);
    expect(() => vietQrPayload({ ...INPUT, bankBin: "97043" })).toThrow(VietQrError);
    expect(() => vietQrPayload({ ...INPUT, accountNumber: "12" })).toThrow(VietQrError);
    expect(() => vietQrPayload({ ...INPUT, content: "DP00012-K7Q2" })).toThrow(VietQrError);
    expect(() => vietQrPayload({ ...INPUT, content: "X".repeat(26) })).toThrow(VietQrError);
  });
});

describe("VietQR bank match (FR-10, M-7)", () => {
  it("maps a short name, a code or a BIN to its one bank", () => {
    expect(findVietQrBank("Vietcombank")?.bin).toBe("970436");
    expect(findVietQrBank("vcb")?.bin).toBe("970436");
    expect(findVietQrBank(" MB Bank ")?.code).toBe("MB");
    expect(findVietQrBank("970418")?.code).toBe("BIDV");
  });

  it("review 9: boilerplate words are dropped whole, never inside a name", () => {
    expect(distinctiveBankText("Thinh Vuong")).toBe("thinhvuong");
    expect(findVietQrBank("Thinh Vuong")?.code).toBe("VPB");
    expect(findVietQrBank("Ngan hang TMCP Ngoai thuong")?.code).toBe("VCB");
    expect(findVietQrBank("VCB")?.code).toBe("VCB");
    expect(findVietQrBank("Techcombank")?.code).toBe("TCB");
    for (const bank of VIETQR_BANKS) expect(findVietQrBank(bank.name)?.bin, bank.name).toBe(bank.bin);
  });

  it("returns null for an unknown, blank or ambiguous name, so no QR is made", () => {
    expect(findVietQrBank("Ngan hang cua toi")).toBeNull();
    expect(findVietQrBank("")).toBeNull();
    expect(findVietQrBank(null)).toBeNull();
    const first = VIETQR_BANKS[0] as VietQrBank;
    const twins: VietQrBank[] = [first, { ...first, bin: "999999", code: "XX" }];
    expect(findVietQrBank(first.shortName, twins)).toBeNull();
  });
});
