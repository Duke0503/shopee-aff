import type { Db } from "../../../shared/database/connection";
import { listHotVouchers, seedVouchersIfEmpty } from "../infrastructure/fnb-voucher.repository";

/** The few vouchers worth broadcasting today, as the daily announcement reads them. */
export interface FnbDealView {
  id: number;
  brand: string;
  title: string;
  description: string;
  code: string;
  discountText: string;
  affiliateUrl: string;
}

export function listFnbDeals(db: Db): { ok: true; deals: FnbDealView[] } {
  seedVouchersIfEmpty(db);
  const deals = listHotVouchers(db).map((row) => ({
    id: row.id,
    brand: row.brand,
    title: row.title,
    description: row.description ?? "",
    code: row.code ?? "",
    discountText: row.discountText ?? "",
    affiliateUrl: row.affiliateUrl ?? "",
  }));
  return { ok: true, deals };
}
