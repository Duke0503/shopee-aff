/**
 * Story 5.4: a returned link is checked before it is attached (AD-14, D47, INV-1). The host is on
 * the allow-list (Shopee for the bridge, AccessTrade for the API), and a short link comes back
 * with its target as the real browser resolved it (the server never calls Shopee, D8), so its
 * sub_ids can be compared with the request's.
 */
import { afterEach, describe, expect, it } from "vitest";

import { checkReturnedLink, needsResolution, RESOLUTION_RETRY_MS } from "../src/modules/linking/index";
import type { Ledger } from "../src/platform/db/ledger";
import { alertRows, answeringBridge, C1, C2, linkLedger, linkRow, memoryLogger, movingClock, queueLink, runLinks } from "./helpers/link-ledger";

const ledgers: Ledger[] = [];
afterEach(() => {
  for (const l of ledgers.splice(0)) l.close();
});

const shareCodes = (ledger: Ledger) => (ledger.sqlite.prepare("SELECT count(*) AS n FROM share_codes").get() as { n: number }).n;
const SHORT = "https://s.shopee.vn/AbC123";

describe("Story 5.4: returned links are checked before they are attached", () => {
  it("AC1: a returned link on a host outside the allow-list is dropped, counted as a failure and logged without the URL's query", async () => {
    const ledger = linkLedger(ledgers);
    const requestId = queueLink(ledger, "DP00001");
    const { logger, lines } = memoryLogger();
    const bridge = answeringBridge((job) => ({ outcome: "link", url: `https://shopee.vn.evil.example/l/x?utm_content=${job.subId1}-${job.subId2}---&secret=q1` }));
    expect(await runLinks(ledger, bridge, { logger })).toEqual({ issued: 0, failed: 1, interrupted: false });
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "QUEUED", affiliate_url: null, attempts: 1 });
    expect(shareCodes(ledger)).toBe(0);
    const dropped = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l["msg"] === "linking.link.dropped");
    expect(dropped).toMatchObject({ requestId, reason: "link_host_not_allowed", link: "https://shopee.vn.evil.example/l/x" });
    expect(lines.join("\n")).not.toContain("utm_content");
    expect(lines.join("\n")).not.toContain("secret=q1");
  });

  it("AC2: a returned short link whose resolved target carries another request's sub_id2 is dropped and counted", async () => {
    const ledger = linkLedger(ledgers);
    const requestId = queueLink(ledger, "DP00001");
    const bridge = answeringBridge(() => ({ outcome: "link", url: SHORT, resolvedUrl: `https://shopee.vn/product/11001/22001?utm_content=${C1}-26110199999---` }));
    expect(await runLinks(ledger, bridge)).toEqual({ issued: 0, failed: 1, interrupted: false });
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "QUEUED", affiliate_url: null, attempts: 1 });
    const job = ledger.sqlite.prepare("SELECT status, failure FROM bridge_jobs").get();
    expect(job).toEqual({ status: "FAILED", failure: "link_sub_ids_mismatch" });
    // Another customer's sub_id1 and a target off Shopee are dropped the same way.
    expect(checkReturnedLink({ url: SHORT, resolvedUrl: `https://shopee.vn/?utm_content=${C2}-${requestId}`, subId1: C1, subId2: requestId, acceptFakeHost: false })).toEqual({ ok: false, reason: "sub_ids_mismatch" });
    expect(checkReturnedLink({ url: SHORT, resolvedUrl: `https://evil.example/?utm_content=${C1}-${requestId}`, subId1: C1, subId2: requestId, acceptFakeHost: false })).toEqual({ ok: false, reason: "host_not_allowed" });
    expect(checkReturnedLink({ url: SHORT, resolvedUrl: "https://shopee.vn/product/1/2", subId1: C1, subId2: requestId, acceptFakeHost: false })).toEqual({ ok: false, reason: "sub_ids_unverified" });
  });

  it("AC3: the short link is resolved by the bridge, outside the server and with no ledger transaction open", async () => {
    const ledger = linkLedger(ledgers);
    const requestId = queueLink(ledger, "DP00001");
    const open: boolean[] = [];
    const bridge = answeringBridge(() => {
      open.push(ledger.sqlite.inTransaction);
      return { outcome: "link", url: SHORT, resolvedUrl: `https://shopee.vn/product/11001/22001?utm_content=${C1}-${requestId}---` };
    });
    expect(await runLinks(ledger, bridge)).toEqual({ issued: 1, failed: 0, interrupted: false });
    expect(open).toEqual([false]);
  });

  it("AC4: a correct link passes both checks, is attached and the request becomes ISSUED", async () => {
    const ledger = linkLedger(ledgers);
    const requestId = queueLink(ledger, "DP00001");
    const resolvedUrl = `https://shopee.vn/universal-link/product/11001/22001?utm_source=an_1&utm_content=${C1}-${requestId}---`;
    expect(await runLinks(ledger, answeringBridge(() => ({ outcome: "link", url: SHORT, resolvedUrl })))).toEqual({ issued: 1, failed: 0, interrupted: false });
    // The affiliate URL kept is the short link the customer opens.
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "ISSUED", affiliate_url: SHORT });
    expect(shareCodes(ledger)).toBe(1);
  });
});

describe("Sprint 22 review: short links the bridge could not resolve", () => {
  it("review 2: a short link without its resolved target is an outage: not counted, backed off, never FAILED, one warning alert", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const requestId = queueLink(ledger, "DP00001");
    const bridge = answeringBridge(() => ({ outcome: "link", url: SHORT }));
    for (let n = 0; n < 6; n++) {
      expect(await runLinks(ledger, bridge, { clock })).toEqual({ issued: 0, failed: 0, interrupted: false });
      expect(linkRow(ledger, requestId)).toMatchObject({ status: "QUEUED", attempts: 0, affiliate_url: null });
      clock.advance(RESOLUTION_RETRY_MS);
    }
    expect(bridge.jobs).toHaveLength(6);
    expect(ledger.sqlite.prepare("SELECT DISTINCT failure FROM bridge_jobs").all()).toEqual([{ failure: "link_unresolved" }]);
    expect(alertRows(ledger)).toEqual([{ kind: "bridge_short_link_unresolved", severity: "warning", suppressed: 5 }]);
  });
});

describe("Story 5.4: what the check reads", () => {
  it("resolves only a short link that does not show its sub_ids, and reads sub_ids nested in a resolved Shopee link", () => {
    expect(needsResolution(SHORT)).toBe(true);
    expect(needsResolution("https://vn.shp.ee/abc")).toBe(true);
    expect(needsResolution(`${SHORT}?utm_content=a-b`)).toBe(false);
    expect(needsResolution("https://shopee.vn/product/1/2")).toBe(false);
    expect(needsResolution("http://s.shopee.vn/AbC")).toBe(false);
    const nested = `https://shopee.vn/universal-link?redir=${encodeURIComponent(`https://shopee.vn/product/1/2?utm_content=${C1}-R1---`)}`;
    expect(checkReturnedLink({ url: SHORT, resolvedUrl: nested, subId1: C1, subId2: "R1", acceptFakeHost: false })).toEqual({ ok: true });
  });

  it("allows AccessTrade hosts only for links the AccessTrade API made, and Shopee hosts only for bridge links", () => {
    const at = { subId1: C1, subId2: "R1", acceptFakeHost: false } as const;
    expect(checkReturnedLink({ ...at, url: "https://shorten.asia/AbCd", origin: "accesstrade" })).toEqual({ ok: true });
    expect(checkReturnedLink({ ...at, url: "https://go.isclix.com/deep_link/1", origin: "accesstrade" })).toEqual({ ok: true });
    expect(checkReturnedLink({ ...at, url: "https://shorten.asia/AbCd" })).toEqual({ ok: false, reason: "host_not_allowed" });
    expect(checkReturnedLink({ ...at, url: "https://s.shopee.vn/AbCd", origin: "accesstrade" })).toEqual({ ok: false, reason: "host_not_allowed" });
    expect(checkReturnedLink({ ...at, url: "https://shorten.asia.evil.example/x", origin: "accesstrade" })).toEqual({ ok: false, reason: "host_not_allowed" });
    expect(checkReturnedLink({ ...at, url: "http://shorten.asia/x", origin: "accesstrade" })).toEqual({ ok: false, reason: "not_a_link" });
    expect(checkReturnedLink({ ...at, url: "https://fake-bridge.invalid/at/R1", origin: "accesstrade" })).toEqual({ ok: false, reason: "host_not_allowed" });
  });
});
