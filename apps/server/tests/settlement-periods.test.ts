/**
 * Story 4.18: staff mark a Shopee settlement period withheld or not from Settings (FR-13, D54,
 * AD-5, AD-17). A Shopee period is withheld by default; AccessTrade is always withheld and not
 * editable; the confirmation shows the server's count of orders a change reaches (approvals after
 * it only); an approval after the unmark carries no tax (Story 3.4's golden split) and the audit
 * entry names the staff member; a refused save answers the label file's error key.
 */
import { settlementPeriodImpactSchema, settlementPeriodSchema, settlementPeriodsResponseSchema } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { splitCommission } from "@cashback/money";
import labels from "@cashback/labels/vi/errors.json";
import { afterEach, describe, expect, it } from "vitest";

import type { Ledger } from "../src/platform/db/ledger";
import { close, type Servers } from "../src/platform/http/servers";
import { deskGet, deskPost, errorOf, staffCookie } from "./helpers/desk-http";
import { apply, approved, awaiting, closeLedgers } from "./helpers/order-ledger";
import { CLOCK, payoutLedger } from "./helpers/payout-ledger";
import { deskServers } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

function desk(ledger: Ledger): Servers {
  servers ??= deskServers(ledger, CLOCK);
  return servers;
}

async function periods(ledger: Ledger) {
  const res = await deskGet(desk(ledger), "/api/admin/settlement-periods", staffCookie(ledger, "tuan", CLOCK), CLOCK);
  expect(res.statusCode).toBe(200);
  return settlementPeriodsResponseSchema.parse(res.json());
}

describe("Story 4.18 acceptance criteria", () => {
  it("AC1: a Shopee period shows as withheld by default and editable; an AccessTrade period is always withheld and not editable", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.prepare("INSERT INTO settlement_periods (network, period_month, withheld, origin) VALUES ('shopee', '2026-09', 1, 'CUTOVER'), ('accesstrade', '2026-09', 1, 'CUTOVER')").run();
    const answer = await periods(ledger);
    expect(answer.currentMonth).toBe("2026-10");
    expect(answer.periods).toEqual([
      { network: "shopee", periodMonth: "2026-10", withheld: true, editable: true, origin: "DEFAULT", basedOn: null },
      { network: "shopee", periodMonth: "2026-09", withheld: true, editable: true, origin: "CUTOVER", basedOn: null },
      { network: "accesstrade", periodMonth: "2026-10", withheld: true, editable: false, origin: "DEFAULT", basedOn: null },
      { network: "accesstrade", periodMonth: "2026-09", withheld: true, editable: false, origin: "CUTOVER", basedOn: null },
    ]);
  });

  it("AC2: the impact is the server's count of waiting orders of the current month a different setting would reach; none for a past period, AccessTrade, the guest account or the setting already in force (review 9)", async () => {
    const ledger = payoutLedger();
    apply(ledger, awaiting("261030W0001"));
    apply(ledger, awaiting("261030W0002"));
    apply(ledger, approved("261030W0003"));
    ledger.sqlite.prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, origin) VALUES ('261030G0001', 'shopee', 'shopee', 'HOUSE', 'AWAITING_APPROVAL', 'REPORT'), ('261030N0001', 'shopee', 'shopee', NULL, 'AWAITING_APPROVAL', 'REPORT')").run();
    const cookie = staffCookie(ledger, "tuan", CLOCK);
    const impact = async (path: string, withheld: boolean) => settlementPeriodImpactSchema.parse((await deskGet(desk(ledger), `/api/admin/settlement-periods/${path}/impact?withheld=${withheld}`, cookie, CLOCK)).json());
    expect(await impact("shopee/2026-10", false)).toEqual({ network: "shopee", periodMonth: "2026-10", withheld: false, affected: 2 });
    expect((await impact("shopee/2026-10", true)).affected).toBe(0);
    expect((await impact("shopee/2026-09", false)).affected).toBe(0);
    expect((await impact("shopee/2026-11", false)).affected).toBe(0);
    expect((await impact("accesstrade/2026-10", false)).affected).toBe(0);
    expect((await deskGet(desk(ledger), "/api/admin/settlement-periods/shopee/2026-10/impact", cookie, CLOCK)).statusCode).toBe(400);
  });

  it("the latest network batch's withholding is the estimate an approval takes and the screen shows; a staff mark overrides it", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.prepare("INSERT INTO network_withholding (network, withheld, network_payout_id, observed_at, recorded_at) VALUES ('shopee', 0, '1034567', '2026-10-29T03:00:00.000Z', '2026-10-29T03:00:00.000Z')").run();
    const current = (await periods(ledger)).periods[0];
    expect(current).toEqual({ network: "shopee", periodMonth: "2026-10", withheld: false, editable: true, origin: "NETWORK", basedOn: "1034567" });
    const clock = fixedClock("2026-10-30T07:00:00.000Z");
    apply(ledger, approved("261030E0001"), clock);
    expect(ledger.sqlite.prepare("SELECT cashback_tax, cashback_withheld FROM orders WHERE order_id = '261030E0001'").get()).toEqual({ cashback_tax: 0, cashback_withheld: 0 });
    await deskPost(desk(ledger), "/api/admin/settlement-periods/shopee/2026-10", staffCookie(ledger, "minh", CLOCK), { withheld: true }, CLOCK);
    apply(ledger, approved("261030E0002"), clock);
    expect(ledger.sqlite.prepare("SELECT cashback_withheld FROM orders WHERE order_id = '261030E0002'").get()).toEqual({ cashback_withheld: 1 });
    expect((await periods(ledger)).periods[0]).toMatchObject({ withheld: true, origin: "STAFF", basedOn: null });
  });

  it("AC3: after the unmark, an order of that period approved later has no tax, an earlier approval keeps its amount, and the audit entry names the staff member", async () => {
    const ledger = payoutLedger();
    const clock = fixedClock("2026-10-30T07:00:00.000Z");
    apply(ledger, approved("261030B0001"), clock);
    apply(ledger, awaiting("261030A0001"), clock);
    const before = ledger.sqlite.prepare("SELECT cashback, cashback_tax FROM orders WHERE order_id = '261030B0001'").get();
    const res = await deskPost(desk(ledger), "/api/admin/settlement-periods/shopee/2026-10", staffCookie(ledger, "tuan", CLOCK), { withheld: false }, CLOCK);
    expect(res.statusCode).toBe(200);
    expect(settlementPeriodSchema.parse(res.json())).toEqual({ network: "shopee", periodMonth: "2026-10", withheld: false, editable: true, origin: "STAFF", basedOn: null });
    apply(ledger, approved("261030A0001"), clock);
    const after = ledger.sqlite.prepare("SELECT cashback, cashback_tax, cashback_withheld, settlement_period FROM orders WHERE order_id = '261030A0001'").get();
    expect(after).toEqual({ cashback: splitCommission({ approvedCommission: 20000, network: "shopee", withheld: false }).cashback, cashback_tax: 0, cashback_withheld: 0, settlement_period: "2026-10" });
    expect(ledger.sqlite.prepare("SELECT cashback, cashback_tax FROM orders WHERE order_id = '261030B0001'").get()).toEqual(before);
    expect(ledger.sqlite.prepare("SELECT actor_kind, actor_id, entity_id FROM audit_entries WHERE event = 'orders.settlement_period.marked'").all()).toEqual([{ actor_kind: "staff", actor_id: "tuan", entity_id: "shopee:2026-10" }]);
  });

  it("AC4: a refused save answers an error key the label file holds, and the stored setting stays", async () => {
    const ledger = payoutLedger();
    const cookie = staffCookie(ledger, "minh", CLOCK);
    const refused = await deskPost(desk(ledger), "/api/admin/settlement-periods/accesstrade/2026-10", cookie, { withheld: false }, CLOCK);
    expect(refused.statusCode).toBe(409);
    const key = errorOf(refused.body).messageKey;
    expect(key).toBe("error.settlement_period.always_withheld");
    expect(Object.keys(labels)).toContain(key);
    const bad = await deskPost(desk(ledger), "/api/admin/settlement-periods/shopee/2026-13", cookie, { withheld: false }, CLOCK);
    expect(bad.statusCode).toBe(400);
    expect((await deskPost(desk(ledger), "/api/admin/settlement-periods/shopee/2026-10", cookie, { withheld: "no" }, CLOCK)).statusCode).toBe(400);
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM settlement_periods").get()).toEqual({ n: 0 });
  });
});
