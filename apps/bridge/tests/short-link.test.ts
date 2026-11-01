/**
 * Story 5.4 review item 3: the bridge resolves a returned short link in the real browser and
 * answers both the short link and its target; the server never calls Shopee. The browser request
 * is a fake here, never the network.
 */
import type { BridgeLinkJob } from "@cashback/contracts";
import { describe, expect, it } from "vitest";

import { runLinkJob } from "../src/link-job";
import { isShortLink, shortLinkResolver, type FollowLink } from "../src/short-link";
import { fakePage, recordingWait } from "./fakes";

const JOB: BridgeLinkJob = { ticket: "0".repeat(32), kind: "link", sourceUrl: "https://shopee.vn/Ao-i.11001.22001", subId1: "DEV1000000000000000001", subId2: "DEV26110100001", timeoutMs: 90_000 };
const TARGET = `https://shopee.vn/product/11001/22001?utm_source=an_1&utm_content=${JOB.subId1}-${JOB.subId2}---`;

function following(finalUrl: string | Error): FollowLink & { asked: string[] } {
  const asked: string[] = [];
  const follow: FollowLink = async (url) => {
    asked.push(url);
    if (finalUrl instanceof Error) throw finalUrl;
    return { finalUrl };
  };
  return Object.assign(follow, { asked });
}

describe("Story 5.4 review 3: the short link is resolved in the real browser", () => {
  it("answers the short link and its resolved target together", async () => {
    const follow = following(TARGET);
    const answer = await runLinkJob(JOB, fakePage(), recordingWait(), shortLinkResolver(follow));
    expect(answer).toEqual({ outcome: "link", url: "https://s.shopee.vn/New1", resolvedUrl: TARGET });
    expect(follow.asked).toEqual(["https://s.shopee.vn/New1"]);
  });

  it("answers the short link alone when the browser cannot resolve it, so the server retries it uncounted", async () => {
    for (const end of [new TypeError("Failed to fetch"), "https://s.shopee.vn/New1", "https://evil.example/x", "http://shopee.vn/p"]) {
      expect(await runLinkJob(JOB, fakePage(), recordingWait(), shortLinkResolver(following(end)))).toEqual({ outcome: "link", url: "https://s.shopee.vn/New1" });
    }
  });

  it("follows only short links that do not show their sub_ids", async () => {
    expect(isShortLink("https://s.shopee.vn/AbC")).toBe(true);
    expect(isShortLink("https://vn.shp.ee/AbC")).toBe(true);
    expect(isShortLink("https://s.shopee.vn/AbC?utm_content=a-b")).toBe(false);
    expect(isShortLink("https://shopee.vn/product/1/2")).toBe(false);
    const follow = following(TARGET);
    expect(await shortLinkResolver(follow)("https://shopee.vn/product/1/2")).toBeNull();
    expect(follow.asked).toEqual([]);
  });
});
