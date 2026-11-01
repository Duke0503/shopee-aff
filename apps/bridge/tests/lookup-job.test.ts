/**
 * Story 5.6: a product lookup in the affiliate browser reads the storefront page and page 1 of the
 * offer search only, and answers the page texts, never an amount. A fake page stands in for both
 * pages; nothing here opens a browser or the network.
 */
import { bridgeLookupJobSchema, bridgeLookupValueSchema, type BridgeLookupJob } from "@cashback/contracts";
import { describe, expect, it } from "vitest";

import type { PageDriver } from "../src/bridge-tab";
import { keywordOf, PAGE_POLL_MS, PAGE_WAIT_MS, runLookupJob } from "../src/lookup-job";
import { readOfferResults, readStorefront, type OfferLook, type StorefrontLook } from "../src/page-scripts";
import { OFFER_SEARCH_URL, productPageUrl } from "../src/shopee-page";
import { recordingWait } from "./fakes";

const TICKET = "a".repeat(32);
const job = (url: string): BridgeLookupJob => ({ ticket: TICKET, kind: "lookup", url, timeoutMs: 90_000 });
const PRODUCT = "https://shopee.vn/product/11001/22001";
const NAME = "Noi com dien 1.8L chong dinh lop men gom cao cap bao hanh 12 thang";

interface FakeLookupPage extends PageDriver {
  opened: string[];
  looks: { store: number; offer: number };
}

function lookupPage(store: Partial<StorefrontLook>, offers: OfferLook[], href?: (url: string) => string, stores: Partial<StorefrontLook>[] = []): FakeLookupPage {
  let at = "";
  const opened: string[] = [];
  const looks = { store: 0, offer: 0 };
  const base = { passwordBox: false };
  return {
    opened,
    looks,
    prepare: async () => undefined,
    href: async () => at,
    open: async (url) => {
      opened.push(url);
      at = href ? href(url) : url;
    },
    run: async <A, R>(func: (arg: A) => R): Promise<R> => {
      if (func === (readStorefront as unknown)) {
        const step = stores[looks.store] ?? {};
        looks.store++;
        return { href: at, ...base, name: NAME, image: "https://down-vn.img.susercontent.com/file/abc", priceText: "\u20ab450.000", ...store, ...step } as R;
      }
      if (func === (readOfferResults as unknown)) {
        const look = offers[Math.min(looks.offer, offers.length - 1)] ?? { state: "waiting" };
        looks.offer++;
        return { href: at, ...base, ...look } as R;
      }
      throw new Error("unknown page script");
    },
  };
}

const FOUND: OfferLook = { state: "found", commissionTexts: ["Hoa h\u1ed3ng 2,6%"], xtraTexts: [], priceText: "\u20ab449.000" };
const resolveNothing = async (): Promise<string | null> => null;

describe("Story 5.6 AC1: a lookup reads page 1 only", () => {
  it("AC1: the lookup job contract has no page parameter, and a lookup opens one offer search without a page or offset", async () => {
    expect(bridgeLookupJobSchema.safeParse({ ...job(PRODUCT), page: 2 }).success).toBe(false);
    expect(bridgeLookupJobSchema.safeParse(job(PRODUCT)).success).toBe(true);
    const page = lookupPage({}, [{ state: "waiting" }, FOUND]);
    await runLookupJob(job(PRODUCT), page, recordingWait(), resolveNothing);
    const searches = page.opened.filter((u) => u.startsWith(OFFER_SEARCH_URL));
    expect(searches).toHaveLength(1);
    const search = new URL(searches[0] ?? "");
    expect([...search.searchParams.keys()]).toEqual(["keyword"]);
    expect(search.searchParams.get("keyword")).toBe(keywordOf(NAME));
    expect(page.opened).toEqual([productPageUrl("11001", "22001"), searches[0]]);
  });

  it("AC1: the item missing from page 1 answers the storefront facts without rates, and pages no further", async () => {
    const page = lookupPage({}, [{ state: "absent" }]);
    const answer = await runLookupJob(job(PRODUCT), page, recordingWait(), resolveNothing);
    expect(answer).toEqual({ outcome: "value", value: { found: true, shopId: "11001", itemId: "22001", name: NAME, imageUrl: "https://down-vn.img.susercontent.com/file/abc", priceText: "\u20ab450.000", rates: null } });
    expect(page.opened.filter((u) => u.startsWith(OFFER_SEARCH_URL))).toHaveLength(1);
  });
});

describe("Story 5.6: the lookup answers page texts the server reads", () => {
  it("answers the rate texts of the item's card, valid under the bridge contract", async () => {
    const answer = await runLookupJob(job(PRODUCT), lookupPage({}, [FOUND]), recordingWait(), resolveNothing);
    expect(answer).toEqual({ outcome: "value", value: { found: true, shopId: "11001", itemId: "22001", name: NAME, imageUrl: "https://down-vn.img.susercontent.com/file/abc", priceText: "\u20ab450.000", rates: { commissionTexts: ["Hoa h\u1ed3ng 2,6%"], xtraTexts: [] } } });
    expect(answer.outcome === "value" && bridgeLookupValueSchema.safeParse(answer.value).success).toBe(true);
  });

  it("takes the card's price when the storefront shows none", async () => {
    const answer = await runLookupJob(job(PRODUCT), lookupPage({ priceText: null }, [FOUND]), recordingWait(), resolveNothing);
    expect(answer.outcome === "value" && answer.value.found && answer.value.priceText).toBe("\u20ab449.000");
  });

  it("resolves a short link in this browser first; a link naming no product answers not found and opens no page", async () => {
    const page = lookupPage({}, [FOUND]);
    const resolve = async (url: string): Promise<string | null> => (url === "https://s.shopee.vn/AbC123" ? "https://shopee.vn/Noi-com-i.11001.22001?utm_source=x" : null);
    const answer = await runLookupJob(job("https://s.shopee.vn/AbC123"), page, recordingWait(), resolve);
    expect(answer.outcome === "value" && answer.value.found && answer.value.itemId).toBe("22001");
    const none = lookupPage({}, [FOUND]);
    expect(await runLookupJob(job("https://s.shopee.vn/Gone"), none, recordingWait(), resolve)).toEqual({ outcome: "value", value: { found: false } });
    expect(none.opened).toEqual([]);
  });

  it("answers captcha or login_redirect when Shopee parks the tab, and page_not_ready when the product never shows a name", async () => {
    const captcha = lookupPage({}, [FOUND], () => "https://shopee.vn/verify/traffic/error");
    expect(await runLookupJob(job(PRODUCT), captcha, recordingWait(), resolveNothing)).toEqual({ outcome: "failed", reason: "captcha" });
    const login = lookupPage({}, [FOUND], () => "https://shopee.vn/buyer/login?next=x");
    expect(await runLookupJob(job(PRODUCT), login, recordingWait(), resolveNothing)).toEqual({ outcome: "failed", reason: "login_redirect" });
    const blank = lookupPage({ name: null }, [FOUND]);
    const wait = recordingWait();
    expect(await runLookupJob(job(PRODUCT), blank, wait, resolveNothing)).toEqual({ outcome: "failed", reason: "page_not_ready" });
    expect(blank.opened.some((u) => u.startsWith(OFFER_SEARCH_URL))).toBe(false);
    expect(wait.total()).toBeGreaterThan(0);
  });

  it("refuses a job whose link is not on Shopee without opening a page", async () => {
    const page = lookupPage({}, [FOUND]);
    expect(await runLookupJob(job("https://evil.example/product/1/2"), page, recordingWait(), resolveNothing)).toEqual({ outcome: "failed", reason: "bad_job" });
    expect(page.opened).toEqual([]);
  });
});

describe("Story 5.6 review item 7: the storefront is looked at again until the price has rendered", () => {
  it("item 7: a name that shows before the price is looked at again from the worker until the price is there", async () => {
    const page = lookupPage({}, [FOUND], undefined, [{ priceText: null }, { priceText: null }]);
    const wait = recordingWait();
    const answer = await runLookupJob(job(PRODUCT), page, wait, resolveNothing);
    expect(page.looks.store).toBe(3);
    expect(answer.outcome === "value" && answer.value.found && answer.value.priceText).toBe("\u20ab450.000");
    expect(wait.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("item 7: a price that never renders ends at the bounded wait and sends no price, never a guess", async () => {
    const page = lookupPage({ priceText: null }, [{ ...FOUND, priceText: null } as OfferLook]);
    const wait = recordingWait();
    const answer = await runLookupJob(job(PRODUCT), page, wait, resolveNothing);
    expect(answer.outcome === "value" && answer.value.found && answer.value.priceText).toBeNull();
    expect(wait.total()).toBeLessThanOrEqual(PAGE_WAIT_MS + PAGE_POLL_MS);
  });
});
