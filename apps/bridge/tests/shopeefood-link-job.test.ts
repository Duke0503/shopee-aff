/**
 * Story 5.11 (D60, D8): a ShopeeFood link job submits the shop on the same custom link page with
 * the request's sub_ids. A short link or an unreadable invite is resolved in this browser first,
 * and the target goes back with the link so the server learns the shop. The browser request is a
 * fake, never the network.
 */
import type { BridgeLinkJob } from "@cashback/contracts";
import { describe, expect, it } from "vitest";

import { ANSWER_MARGIN_MS, BEFORE_SUBMIT_MS, FORM_WAITS_MS, resultWaitMs, runLinkJob } from "../src/link-job";
import { RESOLVE_TIMEOUT_MS, shopeeFoodResolver, shortLinkResolver, type FollowLink } from "../src/short-link";
import { fakePage, recordingWait } from "./fakes";

const SHOP = "https://shopeefood.vn/now-food/shop/1234567";
const JOB: BridgeLinkJob = { ticket: "0".repeat(32), kind: "link", sourceUrl: "https://shopeefood.vn/u/u1vZZ8Q", subId1: "DEV1000000000000000001", subId2: "DEV26110100001", timeoutMs: 90_000 };
const RETURNED = `https://shopeefood.vn/now-food/shop/1234567?utm_content=${JOB.subId1}-${JOB.subId2}---`;

function following(targets: Record<string, string | Error>): FollowLink & { asked: string[] } {
  const asked: string[] = [];
  const follow: FollowLink = async (url) => {
    asked.push(url);
    const target = targets[url] ?? new TypeError("Failed to fetch");
    if (target instanceof Error) throw target;
    return { finalUrl: target };
  };
  return Object.assign(follow, { asked });
}

describe("Story 5.11 AC1: a ShopeeFood link job on the custom link page", () => {
  it("AC1: a shop link is submitted as its canonical shop URL with sub_id1 = customer and sub_id2 = request id, and no resolution", async () => {
    const page = fakePage({ answer: { afterLooks: 1, link: "https://spf.shopee.vn/AbC123" } });
    const follow = following({ "https://spf.shopee.vn/AbC123": RETURNED });
    const answer = await runLinkJob({ ...JOB, sourceUrl: "https://shopee.vn/now-food/shop/1234567?ref=x" }, page, recordingWait(), shortLinkResolver(follow), shopeeFoodResolver(follow));
    expect(page.filled.map((f) => [f.url, f.subIds])).toEqual([[SHOP, [JOB.subId1, JOB.subId2]]]);
    expect(answer).toEqual({ outcome: "link", url: "https://spf.shopee.vn/AbC123", resolvedUrl: RETURNED });
    expect(follow.asked).toEqual(["https://spf.shopee.vn/AbC123"]);
  });
});

describe("Story 5.11 AC2: short links and invites are resolved in the real browser", () => {
  it("AC2: a /u/ short link is followed in this browser, the shop it resolves to is submitted, and the target goes back as sourceTarget", async () => {
    const page = fakePage({ answer: { afterLooks: 1, link: "https://spf.shopee.vn/AbC123" } });
    const follow = following({ [JOB.sourceUrl]: `${SHOP}?share=1`, "https://spf.shopee.vn/AbC123": RETURNED });
    const answer = await runLinkJob(JOB, page, recordingWait(), shortLinkResolver(follow), shopeeFoodResolver(follow));
    expect(follow.asked).toEqual([JOB.sourceUrl, "https://spf.shopee.vn/AbC123"]);
    expect(page.filled.map((f) => f.url)).toEqual([SHOP]);
    expect(answer).toEqual({ outcome: "link", url: "https://spf.shopee.vn/AbC123", resolvedUrl: RETURNED, sourceTarget: `${SHOP}?share=1` });
  });

  it("AC2: a short link the browser cannot resolve to a ShopeeFood page, or that resolves off Shopee, is source_unresolved and nothing is submitted", async () => {
    for (const end of [new TypeError("Failed to fetch"), "https://evil.example/now-food/shop/1", JOB.sourceUrl, "http://shopeefood.vn/now-food/shop/1"]) {
      const page = fakePage();
      expect(await runLinkJob(JOB, page, recordingWait(), shortLinkResolver(following({})), shopeeFoodResolver(following({ [JOB.sourceUrl]: end })))).toEqual({ outcome: "failed", reason: "source_unresolved" });
      expect(page.calls).toEqual([]);
    }
  });

  it("review 5: an http ShopeeFood short link is followed over https and its shop is submitted", async () => {
    const page = fakePage({ answer: { afterLooks: 1, link: "https://spf.shopee.vn/AbC123" } });
    const follow = following({ [JOB.sourceUrl]: SHOP, "https://spf.shopee.vn/AbC123": RETURNED });
    const answer = await runLinkJob({ ...JOB, sourceUrl: "http://shopeefood.vn/u/u1vZZ8Q" }, page, recordingWait(), shortLinkResolver(follow), shopeeFoodResolver(follow));
    expect(follow.asked[0]).toBe(JOB.sourceUrl);
    expect(page.filled.map((f) => f.url)).toEqual([SHOP]);
    expect(answer).toMatchObject({ outcome: "link", sourceTarget: SHOP });
  });
});

describe("Story 5.11 review 1: a job never outlives the server's deadline", () => {
  it("review 1: form waits, the pause, every resolution's own limit, the result wait and the margin fit in the job's timeout, a resolved source included", () => {
    for (const resolves of [false, true]) {
      const worst = FORM_WAITS_MS[0] + FORM_WAITS_MS[1] + BEFORE_SUBMIT_MS + RESOLVE_TIMEOUT_MS * (resolves ? 2 : 1) + resultWaitMs(JOB.timeoutMs, resolves) + ANSWER_MARGIN_MS;
      expect(worst).toBeLessThanOrEqual(JOB.timeoutMs);
      expect(resultWaitMs(JOB.timeoutMs, resolves)).toBeGreaterThan(10_000);
    }
    expect(resultWaitMs(30_000, true)).toBe(0);
  });

  it("review 1: a resolved ShopeeFood source leaves the result box a shorter watch than a plain link", async () => {
    const plain = fakePage({ answer: null });
    const plainWait = recordingWait();
    await runLinkJob({ ...JOB, sourceUrl: SHOP }, plain, plainWait, shortLinkResolver(following({})), shopeeFoodResolver(following({})));
    const food = fakePage({ answer: null });
    const foodWait = recordingWait();
    await runLinkJob(JOB, food, foodWait, shortLinkResolver(following({})), shopeeFoodResolver(following({ [JOB.sourceUrl]: SHOP })));
    expect(plainWait.total() - foodWait.total()).toBeGreaterThanOrEqual(RESOLVE_TIMEOUT_MS - 1_000);
    expect(foodWait.total()).toBeLessThanOrEqual(JOB.timeoutMs - ANSWER_MARGIN_MS - 2 * RESOLVE_TIMEOUT_MS);
  });
});
