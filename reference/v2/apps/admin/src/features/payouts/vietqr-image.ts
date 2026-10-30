import type { ApiVietQr } from "@mmo/contracts";

/**
 * The VietQR image the owner scans, drawn by VietQR's own service. The browser
 * only assembles the URL: the amount and the memo are the server's figures, and
 * the bank BIN is the one the server matched — nothing is recalculated here.
 */
export function vietQrImageUrl(qr: ApiVietQr, accountName: string | null): string {
  const params = new URLSearchParams({
    amount: String(qr.amountVnd),
    addInfo: qr.note,
    accountName: accountName ?? "",
  });
  return `https://img.vietqr.io/image/${qr.bankBin}-${qr.accountNumber}-compact2.png?${params}`;
}
