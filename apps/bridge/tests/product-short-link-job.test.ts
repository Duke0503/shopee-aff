/**
 * fix(linking) 2026-11-04: a Shopee product short link (`s.shopee.vn/...`, `vn.shp.ee/...`) names
 * no product, so the server could not ask the third party for its price and the reply went out
 * without one. The link job follows it in this browser while the link is made, and the product it
 * resolves to goes back as `sourceTarget` in canonical form. The browser request is a fake.
 */
import type { BridgeLinkJob } from "@cashback/contracts";
import { describe, expect, it } from "vitest";

import { runLinkJob } from "../src/link-job";
import { shortLinkResolver, type FollowLink } from "../src/short-link";
import { fakePage, recordingWait } from "./fakes";

const SHORT = "https://vn.shp.ee/SHq2FShF";
const JOB: BridgeLinkJob = { ticket: "0".repeat(32), kind: "link", sourceUrl: SHORT, subId1: "DEV1000000000000000001", subId2: "DEV26110400001", timeoutMs: 90_000 };
const MADE = "https://s.shopee.vn/AKbrmzxJCt";
const RETURNED = `https://shopee.vn/product/1524779718/47256657613?utm_content=${JOB.subId1}-${JOB.subId2}---`;

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

describe("fix(linking): a product short link learns its product in the browser", () => {
  it("the short link is submitted as pasted, and the product it resolves to goes back canonical as sourceTarget", async () => {
    const page = fakePage({ answer: { afterLooks: 1, link: MADE } });
    const follow = following({ [SHORT]: "https://shopee.vn/opaanlp/1524779718/47256657613?__mobile__=1&gads_t_sig=x", [MADE]: RETURNED });
    const answer = await runLinkJob(JOB, page, recordingWait(), shortLinkResolver(follow));
    expect(page.filled.map((f) => f.url)).toEqual([SHORT]);
    expect(follow.asked).toEqual([SHORT, MADE]);
    expect(answer).toEqual({ outcome: "link", url: MADE, resolvedUrl: RETURNED, sourceTarget: "https://shopee.vn/product/1524779718/47256657613" });
  });

  it("a short link that resolves to no product, or not at all, leaves the link without a target", async () => {
    for (const end of [new TypeError("Failed to fetch"), "https://shopee.vn/search?keyword=x", "https://evil.example/a/1524779718/47256657613"]) {
      const page = fakePage({ answer: { afterLooks: 1, link: MADE } });
      const answer = await runLinkJob(JOB, page, recordingWait(), shortLinkResolver(following({ [SHORT]: end, [MADE]: RETURNED })));
      expect(answer).toEqual({ outcome: "link", url: MADE, resolvedUrl: RETURNED });
    }
  });

  it("a full product link is not followed", async () => {
    const page = fakePage({ answer: { afterLooks: 1, link: MADE } });
    const follow = following({ [MADE]: RETURNED });
    const answer = await runLinkJob({ ...JOB, sourceUrl: "https://shopee.vn/product/1524779718/47256657613" }, page, recordingWait(), shortLinkResolver(follow));
    expect(follow.asked).toEqual([MADE]);
    expect(answer).toEqual({ outcome: "link", url: MADE, resolvedUrl: RETURNED });
  });
});
