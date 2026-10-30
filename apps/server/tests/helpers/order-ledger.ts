/**
 * A migrated ledger with two customers, an erased one, the guest account, five link requests and a campaign,
 * and builders for normalized report rows, for the reconciliation apply tests (Stories 3.3, 3.4).
 */
import { join } from "node:path";
import { instantFromMs, parseInstant, toMs, type Clock } from "@cashback/core";

import { sourced, type NetworkStatus, type SourcedRow } from "../../src/modules/linking/index";
import { applyReportRow, type ApplyDeps } from "../../src/modules/orders/index";
import { openLedger, type Ledger } from "../../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../../src/platform/db/migrations";
import { applyDepsFor } from "../../src/reconcile/apply-deps";
import { TEST_CLOCK, tempDir } from "./live-fixture";

const opened: Ledger[] = [];

/** Closes every ledger `freshLedger` opened; call from `afterEach`. */
export function closeLedgers(): void {
  for (const ledger of opened.splice(0)) ledger.close();
}

export function freshLedger(path = join(tempDir("cashback-apply-"), "ledger.sqlite")): Ledger {
  const ledger = openLedger(path);
  runMigrations(ledger, readMigrations(MIGRATIONS_DIR), TEST_CLOCK);
  ledger.sqlite.exec(`
    INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('C1', 'DP00001', 'USER', 'ACTIVE'), ('C2', 'DP00002', 'USER', 'ACTIVE'), ('HOUSE', NULL, 'HOUSE', 'ACTIVE'), ('CE', NULL, 'USER', 'ERASED');
    INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, origin) VALUES
      ('REQ1', 'C1', 'shopee', 'shopee', 'DELIVERED', 'https://shopee.vn/p/1', 'REQUEST'),
      ('REQT', 'C1', 'accesstrade', 'tiktok', 'DELIVERED', 'https://tiktok.com/p/1', 'REQUEST'),
      ('REQH', 'HOUSE', 'shopee', 'shopee', 'DELIVERED', 'https://shopee.vn/p/2', 'REQUEST'),
      ('REQ2', 'C2', 'shopee', 'shopee', 'DELIVERED', 'https://shopee.vn/p/3', 'REQUEST'),
      ('REQE', 'CE', 'accesstrade', 'lazada', 'DELIVERED', 'https://lazada.vn/p/1', 'REQUEST');
    INSERT INTO campaigns (campaign_id, name, slots, bonus, origin) VALUES ('CAMP1', 'October', 10, 20000, 'STAFF');`);
  opened.push(ledger);
  return ledger;
}

/** A clock the test moves forward by hand. */
export function movingClock(start: string): Clock & { advance(ms: number): void } {
  let at = toMs(parseInstant(start));
  return { now: () => instantFromMs(at), advance: (ms) => void (at += ms) };
}

export const HOUR = 3_600_000;

export interface ItemSpec {
  status: NetworkStatus;
  parts: number[];
  value?: number | null;
}

export function reportRow(orderId: string, orderStatus: NetworkStatus | null, items: ItemSpec[], options: { subIds?: string[]; network?: "shopee" | "accesstrade" } = {}): SourcedRow {
  return sourced(
    {
      network: options.network ?? "shopee",
      orderId,
      rawOrderStatus: orderStatus,
      orderStatus,
      items: items.map((it, i) => ({ itemId: `I${i + 1}`, rawStatus: it.status, status: it.status, commissionParts: it.parts, value: it.value === undefined ? 100000 : it.value })),
      subIds: options.subIds ?? ["C1", "REQ1", "", "", ""],
      problems: [],
    },
    parseInstant("2026-10-20T03:00:00.000Z"),
  );
}

export const awaiting = (orderId: string, parts = [20000], options?: Parameters<typeof reportRow>[3]) => reportRow(orderId, "AWAITING", [{ status: "AWAITING", parts }], options);
export const approved = (orderId: string, parts = [20000], options?: Parameters<typeof reportRow>[3]) => reportRow(orderId, "APPROVED", [{ status: "APPROVED", parts }], options);
export const cancelled = (orderId: string, options?: Parameters<typeof reportRow>[3]) => reportRow(orderId, "CANCELLED", [{ status: "CANCELLED", parts: [0] }], options);

export type Override = (deps: ApplyDeps) => Partial<ApplyDeps>;

export function apply(ledger: Ledger, row: SourcedRow, clock: Clock = TEST_CLOCK, override?: Override) {
  return ledger.tx((db) => {
    const deps = applyDepsFor(db, clock, { production: true });
    return applyReportRow(db, row, { ...deps, ...override?.(deps) });
  });
}

