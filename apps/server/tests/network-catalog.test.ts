import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NETWORK_MONEY_RULES, shopeeCommission, splitCommission, type AffiliateNetwork } from "@cashback/money";
import { describe, expect, it } from "vitest";

import {
  ACCESSTRADE_STATUS_MAP,
  mapAccessTradeLine,
  mapStatus,
  NETWORK_CATALOG,
  networkDefinition,
  readShopeeConversion,
  SHOPEE_STATUS_MAP,
  type StatusMap,
} from "../src/modules/linking/index";
import { reportSignal, type ReportObservation } from "../src/modules/orders/index";

const NETWORKS = Object.keys(NETWORK_CATALOG) as AffiliateNetwork[];
const MAPS: [string, StatusMap][] = [
  ["shopee", SHOPEE_STATUS_MAP],
  ["accesstrade", ACCESSTRADE_STATUS_MAP],
];

/** Raw values no map lists, including names that exist on Object.prototype. */
const UNLISTED: unknown[] = [
  "", " ", "unknown", "UNKNOWN", "awaiting", "AWAITING", "cancel", "cancelled_by_buyer", "returned", "refunded", "partially_validated",
  "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "3", "-1", "1.0", "01", 3, -1, 1.5, NaN, Infinity,
  null, undefined, true, false, {}, [], ["pending"], { pending: true },
];

describe("Story 1.11 AC4: a raw status not in a map is UNKNOWN, with no default branch", () => {
  for (const [network, map] of MAPS) {
    it(`AC4: ${network}: every unlisted value maps to UNKNOWN`, () => {
      for (const raw of UNLISTED) {
        if (typeof raw === "string" && Object.hasOwn(map, raw.trim().toLowerCase())) continue;
        expect(mapStatus(map, raw), String(raw)).toBe("UNKNOWN");
      }
    });

    it(`AC4: ${network}: the map lists only AWAITING, APPROVED or CANCELLED, and is frozen without a prototype`, () => {
      expect(new Set(Object.values(map))).toEqual(new Set(Object.values(map).filter((v) => ["AWAITING", "APPROVED", "CANCELLED"].includes(v))));
      expect(Object.isFrozen(map)).toBe(true);
      expect(Object.getPrototypeOf(map)).toBeNull();
    });

    it(`AC4: ${network}: a listed value maps exactly to its entry, so nothing but the map decides`, () => {
      for (const [raw, status] of Object.entries(map)) {
        expect(mapStatus(map, raw)).toBe(status);
        expect(mapStatus(map, `  ${raw.toUpperCase()} `)).toBe(status);
        expect(mapStatus(map, `${raw}x`)).toBe("UNKNOWN");
      }
    });
  }

  it("AC4: the mapping source has no fallback branch: one own-key lookup, else UNKNOWN", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/modules/linking/domain/network-status.ts", import.meta.url)), "utf8");
    const body = /export function mapStatus[\s\S]*?\n}/.exec(source)?.[0] ?? "";
    expect(body).toMatch(/Object\.hasOwn\(map, key\) \? \(map\[key\] as KnownNetworkStatus\) : "UNKNOWN"/);
    expect(body).not.toMatch(/\bswitch\b|\bdefault\b|\?\?|\|\|/);
  });

  it("AC4: an AccessTrade line with an unlisted code is UNKNOWN whatever is_confirmed says", () => {
    for (const raw of UNLISTED) {
      if (raw === 0 || raw === 1 || raw === 2) continue;
      expect(mapAccessTradeLine(raw, 1), String(raw)).toBe("UNKNOWN");
    }
  });

  it("AC4: an unknown status freezes the order through the report signal", () => {
    const [row] = readShopeeConversion({ orders: [{ order_sn: "X1", order_status: "PAID", items: [{ display_item_status: "partially_validated", item_commission: 100_000 }] }] });
    expect(reportSignal(row as ReportObservation)).toEqual({ kind: "FREEZE", reason: "unknown_status" });
  });
});

describe("Story 1.11 AC5: other modules read network rules through the linking index, and the split uses them", () => {
  it("AC5: the catalog covers Shopee and AccessTrade only; Lazada is absent (D17)", () => {
    expect(NETWORKS.sort()).toEqual(["accesstrade", "shopee"]);
  });

  it("AC5: the catalog's fee rate and tax rule are the ones the money split applies", () => {
    for (const network of NETWORKS) {
      const rules = networkDefinition(network);
      expect(rules.feeBps).toBe(NETWORK_MONEY_RULES[network].feeBps);
      expect(rules.taxRule.kind === "always").toBe(NETWORK_MONEY_RULES[network].alwaysWithheld);
    }
  });

  it("AC5: a split computed from the catalog's values matches splitCommission for each network", () => {
    const commission = 123_457;
    for (const network of NETWORKS) {
      const rules = networkDefinition(network);
      const withheld = rules.taxRule.kind === "always" || rules.taxRule.withheldByDefault;
      const split = splitCommission({ approvedCommission: commission, network, withheld });
      const c = BigInt(commission);
      const expectedFee = Number((2n * c * rules.feeBps + 10_000n) / 20_000n);
      const expectedTax = withheld ? Number((2n * c * 1_000n + 10_000n) / 20_000n) : 0;
      expect({ network, fee: split.fee, tax: split.tax }).toEqual({ network, fee: expectedFee, tax: expectedTax });
    }
  });

  it("AC5: Shopee's tax rule is per period, withheld by default (D54); AccessTrade always withholds", () => {
    expect(NETWORK_CATALOG.shopee.taxRule).toEqual({ kind: "per_period", withheldByDefault: true });
    expect(NETWORK_CATALOG.accesstrade.taxRule).toEqual({ kind: "always" });
  });

  it("AC5: Shopee's cap rule is the cap the money package applies; AccessTrade has none", () => {
    const cap = NETWORK_CATALOG.shopee.capRule;
    expect(cap.kind).toBe("network_part");
    const capDong = cap.kind === "network_part" ? cap.capDong : 0;
    expect(shopeeCommission(10_000_000, 1_000, 0).shopeePart).toBe(capDong);
    expect(NETWORK_CATALOG.accesstrade.capRule).toEqual({ kind: "none" });
  });

  it("AC5: amount scale, sub_id format and status map are published per network", () => {
    expect(NETWORK_CATALOG.shopee.amountScale).toBe(100_000);
    expect(NETWORK_CATALOG.accesstrade.amountScale).toBe(1);
    expect(NETWORK_CATALOG.shopee.statusMap).toBe(SHOPEE_STATUS_MAP);
    expect(NETWORK_CATALOG.accesstrade.statusMap).toBe(ACCESSTRADE_STATUS_MAP);
    for (const network of NETWORKS) {
      const format = NETWORK_CATALOG[network].subIdFormat;
      expect(format.count).toBe(5);
      expect(format.pattern.test("C0003")).toBe(true);
      expect(format.pattern.test("C-0003")).toBe(false);
    }
  });
});

describe("report signal precedence (D31, status-flows.md §1)", () => {
  const item = (status: ReportObservation["items"][number]["status"], commissionParts: number[] = [1000]) => ({ status, commissionParts });
  const obs = (orderStatus: ReportObservation["orderStatus"], items: ReportObservation["items"], orderId = "O1"): ReportObservation => ({ orderId, orderStatus, items });

  it("a missing order id freezes before anything else", () => {
    expect(reportSignal(obs("CANCELLED", [item("CANCELLED")], " "))).toEqual({ kind: "FREEZE", reason: "missing_order_id" });
  });
  it("the order-level cancel wins over every item status", () => {
    expect(reportSignal(obs("CANCELLED", [item("APPROVED"), item("UNKNOWN")]))).toEqual({ kind: "CANCEL", reason: "order_cancelled" });
  });
  it("an item cancel only drops that item; all items cancelled is a cancel", () => {
    expect(reportSignal(obs("AWAITING", [item("CANCELLED"), item("APPROVED")]))).toEqual({ kind: "APPROVED", liveItems: [1] });
    expect(reportSignal(obs("AWAITING", [item("CANCELLED"), item("CANCELLED")]))).toEqual({ kind: "CANCEL", reason: "all_items_cancelled" });
  });
  it("a cancelled item's commission does not keep the order alive, and a cancelled item's 0 does not cancel it", () => {
    expect(reportSignal(obs(null, [item("CANCELLED", [5000]), item("AWAITING", [0, 0])]))).toEqual({ kind: "CANCEL", reason: "commission_zero" });
    expect(reportSignal(obs(null, [item("CANCELLED", [0]), item("AWAITING", [10])]))).toEqual({ kind: "AWAITING", liveItems: [1] });
  });
  it("an order with no items, or no reported commission, freezes rather than cancels", () => {
    expect(reportSignal(obs("AWAITING", []))).toEqual({ kind: "FREEZE", reason: "no_items" });
    expect(reportSignal(obs("AWAITING", [item("AWAITING", [])]))).toEqual({ kind: "FREEZE", reason: "missing_commission" });
  });
  it("approved needs every live item approved", () => {
    expect(reportSignal(obs(null, [item("APPROVED"), item("AWAITING")]))).toEqual({ kind: "AWAITING", liveItems: [0, 1] });
    expect(reportSignal(obs(null, [item("APPROVED"), item("APPROVED")]))).toEqual({ kind: "APPROVED", liveItems: [0, 1] });
  });
});
