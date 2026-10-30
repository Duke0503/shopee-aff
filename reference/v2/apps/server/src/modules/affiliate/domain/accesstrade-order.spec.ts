import { describe, expect, it } from "vitest";

import { normalizeTransactions, type AccessTradeTransaction } from "./accesstrade-order";

const line = (over: Partial<Record<string, unknown>>): AccessTradeTransaction => ({
  transaction_id: "T1",
  merchant: "TikTok Shop",
  status: 1,
  is_confirmed: 1,
  product_price: 100_000,
  product_quantity: 1,
  commission: 10_000,
  ...over,
});

describe("normalizeTransactions", () => {
  it("sums the lines of one order into a single approved order", () => {
    const orders = normalizeTransactions([
      line({}),
      line({ commission: 5_000, is_confirmed: 1, _extra: { sub_params: { sub1: "8461", sub2: "R1" } } }),
    ]);

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      orderId: "T1",
      platform: "tiktok",
      subId1: "8461",
      subId2: "R1",
      orderValueVnd: 200_000,
      estimatedCommissionVnd: 15_000,
      approvedCommissionVnd: 15_000,
      status: "approved",
    });
  });

  it("counts only the live lines toward approval", () => {
    const orders = normalizeTransactions([
      line({ status: 1, is_confirmed: 1, commission: 10_000 }),
      line({ status: 2, is_confirmed: 0, commission: 99_999 }),
    ]);

    expect(orders[0]).toMatchObject({ status: "approved", approvedCommissionVnd: 10_000, estimatedCommissionVnd: 109_999 });
  });

  it("is rejected when every line is rejected", () => {
    const orders = normalizeTransactions([line({ status: 2 }), line({ status: 2, transaction_value: 0 })]);
    expect(orders[0]).toMatchObject({ status: "rejected", approvedCommissionVnd: null });
  });

  it("stays awaiting until every live line is confirmed", () => {
    const orders = normalizeTransactions([line({ status: 1, is_confirmed: 0, commission: 8_000 })]);
    expect(orders[0]).toMatchObject({ status: "awaiting_approval", approvedCommissionVnd: null, estimatedCommissionVnd: 8_000 });
  });

  it("maps the merchant to a platform and keeps a rejection reason", () => {
    const orders = normalizeTransactions([
      line({ merchant: "Lazada Vietnam", transaction_id: "T2", reason_rejected: null }),
    ]);
    expect(orders[0]?.platform).toBe("lazada");
  });

  it("falls back to transaction_value, then commission, when there is no price", () => {
    const voucher = normalizeTransactions([line({ product_price: 0, transaction_value: 0, commission: 12_345 })]);
    expect(voucher[0]?.orderValueVnd).toBe(12_345);

    const redeemed = normalizeTransactions([line({ transaction_id: "T3", product_price: 0, transaction_value: 50_000 })]);
    expect(redeemed[0]?.orderValueVnd).toBe(50_000);
  });

  it("ignores lines with no transaction id", () => {
    expect(normalizeTransactions([line({ transaction_id: undefined, order_id: undefined })])).toEqual([]);
  });
});
