/** Sprint 22 review item 9: the one host-on-domain rule shared by core, the server and the bridge. */
import { describe, expect, it } from "vitest";

import { hostOnDomain, SHOPEE_LINK_DOMAINS, SHOPEE_SHORT_LINK_DOMAINS } from "../src/index";

describe("hostOnDomain (review item 9)", () => {
  it("accepts the domain and its subdomains, in any case", () => {
    for (const host of ["shopee.vn", "s.shopee.vn", "AFFILIATE.Shopee.VN", "vn.shp.ee", "shope.ee"]) expect(hostOnDomain(host, SHOPEE_LINK_DOMAINS)).toBe(true);
    expect(hostOnDomain("s.shopee.vn", SHOPEE_SHORT_LINK_DOMAINS)).toBe(true);
  });

  it("refuses look-alikes and hosts that only end with the domain's letters", () => {
    for (const host of ["shopee.vn.evil.com", "notshopee.vn", "shopee.vnx", "evil-shopee.vn", ""]) expect(hostOnDomain(host, SHOPEE_LINK_DOMAINS)).toBe(false);
    expect(hostOnDomain("shopee.vn", SHOPEE_SHORT_LINK_DOMAINS)).toBe(false);
  });
});
