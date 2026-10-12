import { describe, expect, it } from "vitest";

import { vietQrImageUrl } from "../src/features/payouts/vietqr-image";

const QR = { bankBin: "970436", accountNumber: "123", amountVnd: 14_506, note: "DP1" };

describe("vietQrImageUrl", () => {
  it("hands VietQR the server's own figures", () => {
    expect(vietQrImageUrl(QR, "AN")).toBe(
      "https://img.vietqr.io/image/970436-123-compact2.png?amount=14506&addInfo=DP1&accountName=AN",
    );
  });

  it("still builds a URL when the holder name is unknown", () => {
    expect(vietQrImageUrl(QR, null)).toBe(
      "https://img.vietqr.io/image/970436-123-compact2.png?amount=14506&addInfo=DP1&accountName=",
    );
  });
});
