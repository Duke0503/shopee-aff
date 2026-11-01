/**
 * Story 5.10: GET /api/admin/link-requests, every link request on the list contract for any staff
 * role (FR-7, FR-25, FR-37, AD-12). The Overview's "failed links" tile and this list count the
 * same set; the "requested" column sorts by the request's own time; a guest request shows as the
 * guest account. Screen side: apps/admin/tests/link-requests.test.tsx.
 */
import { deskLinkRequestsResponseSchema, overviewSchema, type DeskLinkRequestRow } from "@cashback/contracts";
import { afterEach, describe, expect, it } from "vitest";

import type { Ledger } from "../src/platform/db/ledger";
import { close, type Servers } from "../src/platform/http/servers";
import { deskGet, staffCookie } from "./helpers/desk-http";
import { closeLedgers } from "./helpers/order-ledger";
import { CLOCK, payoutLedger } from "./helpers/payout-ledger";
import { deskServers } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

/** 2026-10-30 in Vietnam is [2026-10-29T17:00Z, 2026-10-30T17:00Z); the clock is 12:00Z on it. */
function seeded(): Ledger {
  const ledger = payoutLedger();
  ledger.sqlite.exec("DELETE FROM link_requests");
  const add = ledger.sqlite.prepare("INSERT INTO link_requests (request_id, customer_id, network, platform, channel, status, source_url, attempts, created_at, delivered_at, origin) VALUES (?, ?, 'shopee', 'shopee', ?, ?, 'https://shopee.vn/p', ?, ?, ?, 'REQUEST')");
  add.run("26103000001", "C1", "zalo", "FAILED", 3, "2026-10-30T02:00:00.000Z", null);
  add.run("26103000002", "C2", "web", "FAILED", 3, "2026-10-29T18:00:00.000Z", null);
  add.run("26102900003", "C1", "zalo", "FAILED", 3, "2026-10-29T10:00:00.000Z", null);
  add.run("26103000004", "HOUSE", "web", "DELIVERED", 1, "2026-10-30T05:00:00.000Z", "2026-10-30T05:01:00.000Z");
  add.run("26102800005", "C2", "zalo", "QUEUED", 0, "2026-10-28T09:00:00.000Z", null);
  // Delivered last, requested first: an update-time sort would put it on top.
  add.run("26102000006", "C1", "zalo", "DELIVERED", 1, "2026-10-20T09:00:00.000Z", "2026-10-30T11:00:00.000Z");
  return ledger;
}

async function get(ledger: Ledger, url: string) {
  servers ??= deskServers(ledger, CLOCK);
  const res = await deskGet(servers, url, staffCookie(ledger, "tuan", CLOCK), CLOCK);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as unknown;
}

const ids = (rows: readonly DeskLinkRequestRow[]) => rows.map((r) => r.requestId);

describe("Story 5.10 acceptance criteria (server)", () => {
  it("AC1: the Overview's failed-links count equals this list filtered to FAILED for today, its facet and its rows", async () => {
    const ledger = seeded();
    const overview = overviewSchema.parse(await get(ledger, "/api/admin/overview"));
    const list = deskLinkRequestsResponseSchema.parse(await get(ledger, "/api/admin/link-requests?filter[status]=FAILED&filter[createdAt]=2026-10-30..2026-10-30"));
    expect(overview.todo.failedLinksToday).toBe(2);
    expect(list.total).toBe(overview.todo.failedLinksToday);
    expect(ids(list.rows).sort()).toEqual(["26103000001", "26103000002"]);
    expect(list.facets["status"]?.find((f) => f.value === "FAILED")).toEqual({ value: "FAILED", count: 2 });
  });

  it("AC2: the requested column sorts by the request time it shows, not by when the request last changed", async () => {
    const ledger = seeded();
    const desc = deskLinkRequestsResponseSchema.parse(await get(ledger, "/api/admin/link-requests?sort=createdAt:desc"));
    expect(ids(desc.rows)).toEqual(["26103000004", "26103000001", "26103000002", "26102900003", "26102800005", "26102000006"]);
    const asc = deskLinkRequestsResponseSchema.parse(await get(ledger, "/api/admin/link-requests?sort=createdAt:asc"));
    expect(ids(asc.rows)[0]).toBe("26102000006");
    expect(ids(deskLinkRequestsResponseSchema.parse(await get(ledger, "/api/admin/link-requests")).rows)).toEqual(ids(desc.rows));
  });

  it("AC4: a guest request is listed as the guest account, with no customer code", async () => {
    const ledger = seeded();
    const list = deskLinkRequestsResponseSchema.parse(await get(ledger, "/api/admin/link-requests?filter[channel]=web"));
    expect(list.rows.map((r) => [r.requestId, r.customerCode, r.guest])).toEqual([
      ["26103000004", null, true],
      ["26103000002", "DP00002", false],
    ]);
  });

  it("filters by state and channel with counts from the same filtered set, and shows delivery and failed attempts as stored", async () => {
    const ledger = seeded();
    const list = deskLinkRequestsResponseSchema.parse(await get(ledger, "/api/admin/link-requests?filter[channel]=zalo"));
    expect(list.total).toBe(4);
    expect(list.facets["channel"]).toEqual([{ value: "zalo", count: 4 }]);
    expect(list.facets["status"]).toEqual(expect.arrayContaining([{ value: "FAILED", count: 2 }, { value: "QUEUED", count: 1 }, { value: "DELIVERED", count: 1 }]));
    expect(list.rows.find((r) => r.requestId === "26102000006")).toMatchObject({ deliveredAt: "2026-10-30T11:00:00.000Z", attempts: 1, channel: "zalo", status: "DELIVERED" });
    const refused = await (servers as Servers).publicApp.inject({ method: "GET", url: "/api/admin/link-requests" });
    expect(refused.statusCode).not.toBe(200);
  });
});
