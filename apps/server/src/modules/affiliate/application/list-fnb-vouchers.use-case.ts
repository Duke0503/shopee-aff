import { formatVnd, type Messages } from "../../../notifications";
import type { Db } from "../../../shared/database/connection";
import { listVouchers, seedVouchersIfEmpty } from "../infrastructure/fnb-voucher.repository";

/**
 * The voucher list the bot and the web read. The key names are the ones the
 * assistant already speaks, so a cutover does not change a message.
 */
export interface FnbVoucherView {
  id: number;
  brand: string;
  title: string;
  description: string;
  voucherType: string;
  code: string;
  barcodeUrl: string;
  affiliateUrl: string;
  discountText: string;
  minOrder: number;
  minOrderFormatted: string;
  startDate: string;
  endDate: string;
  isHot: boolean;
}

export interface FnbVoucherQuery {
  brand?: string;
  type?: string;
}

export function listFnbVouchers(
  db: Db,
  messages: Messages,
  query: FnbVoucherQuery = {},
): { ok: true; vouchers: FnbVoucherView[] } {
  seedVouchersIfEmpty(db);
  const vouchers = listVouchers(db, { brand: query.brand, voucherType: query.type }).map((row) => ({
    id: row.id,
    brand: row.brand,
    title: row.title,
    description: row.description ?? "",
    voucherType: row.voucherType,
    code: row.code ?? "",
    barcodeUrl: row.barcodeUrl ?? "",
    affiliateUrl: row.affiliateUrl ?? "",
    discountText: row.discountText ?? "",
    minOrder: row.minOrder ?? 0,
    minOrderFormatted: formatVnd(messages, row.minOrder ?? 0),
    startDate: row.startDate ?? "",
    endDate: row.endDate ?? "",
    isHot: row.isHot === 1,
  }));
  return { ok: true, vouchers };
}
