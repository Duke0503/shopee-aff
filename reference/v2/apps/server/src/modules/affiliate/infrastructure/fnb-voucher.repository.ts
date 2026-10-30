import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { fnbVouchers } from "../../../shared/database/schema";

/**
 * The in-store vouchers of the two coffee chains. Wording lives in a data
 * file (`resources/fnb-vouchers.json`), never in this code, so the catalogue
 * changes without a deploy and no Vietnamese text sits in a `.ts` file.
 */

export interface SeedVoucher {
  brand: string;
  title: string;
  description?: string;
  voucher_type?: string;
  code?: string;
  discount_text?: string;
  min_order?: number;
  is_hot?: number;
}

const DEFAULT_VOUCHERS_PATH = fileURLToPath(
  new URL("../../../../../../resources/fnb-vouchers.json", import.meta.url),
);

export function fnbVouchersPath(env: NodeJS.ProcessEnv = process.env): string {
  return (env.FNB_VOUCHERS_PATH ?? "").trim() || DEFAULT_VOUCHERS_PATH;
}

/** A missing or broken catalogue leaves the list empty rather than 500. */
export function loadSeedVouchers(path: string = fnbVouchersPath()): SeedVoucher[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as SeedVoucher[]) : [];
  } catch {
    return [];
  }
}

export function countVouchers(db: Db): number {
  return db.select({ total: sql<number>`count(*)` }).from(fnbVouchers).get()?.total ?? 0;
}

/**
 * Puts the seed catalogue in when the table is empty, and does nothing at all
 * once a single voucher exists — the owner's own rows are never touched.
 * Today's Python does the same on the first read of the list.
 */
export function seedVouchersIfEmpty(db: Db, seed: SeedVoucher[] = loadSeedVouchers()): number {
  if (seed.length === 0 || countVouchers(db) > 0) return 0;
  const now = new Date().toISOString();
  db.insert(fnbVouchers)
    .values(
      seed.map((voucher) => ({
        brand: voucher.brand.trim().toLowerCase(),
        title: voucher.title.trim(),
        description: voucher.description ?? "",
        voucherType: (voucher.voucher_type ?? "counter").trim().toLowerCase(),
        code: voucher.code ?? "",
        discountText: voucher.discount_text ?? "",
        minOrder: voucher.min_order ?? 0,
        isHot: voucher.is_hot ?? 0,
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
  return seed.length;
}

/** Active vouchers, hottest first — the order the list route returns them in. */
export function listVouchers(db: Db, filter: { brand?: string; voucherType?: string } = {}) {
  const conditions = [eq(fnbVouchers.isActive, 1)];
  const brand = (filter.brand ?? "").trim().toLowerCase();
  const voucherType = (filter.voucherType ?? "").trim().toLowerCase();
  if (brand !== "") conditions.push(eq(fnbVouchers.brand, brand));
  if (voucherType !== "") conditions.push(eq(fnbVouchers.voucherType, voucherType));
  return db
    .select()
    .from(fnbVouchers)
    .where(and(...conditions))
    .orderBy(desc(fnbVouchers.isHot), asc(fnbVouchers.id))
    .all();
}

/** The handful worth broadcasting today, brand by brand. */
export function listHotVouchers(db: Db) {
  return db
    .select()
    .from(fnbVouchers)
    .where(and(eq(fnbVouchers.isActive, 1), eq(fnbVouchers.isHot, 1)))
    .orderBy(asc(fnbVouchers.brand), asc(fnbVouchers.id))
    .all();
}
