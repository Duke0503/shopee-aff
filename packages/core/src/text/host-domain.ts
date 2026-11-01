/**
 * The one host-name rule for "is this link on that domain" (FR-1, AD-14, INV-1): a host is on a
 * domain when it is the domain or any subdomain of it, compared without case. `shopee.vn.evil.com`
 * and `notshopee.vn` are not on `shopee.vn`. Shared by the Shopee product reading here, the
 * server's returned-link check and network reading, and the bridge extension, so the allow-lists
 * cannot drift apart.
 */

export function hostOnDomain(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase();
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Every domain Shopee hands out links on. */
export const SHOPEE_LINK_DOMAINS = ["shopee.vn", "shope.ee", "shp.ee"] as const;
/** Shopee's short-link hosts. */
export const SHOPEE_SHORT_LINK_DOMAINS = ["s.shopee.vn", "shope.ee", "shp.ee"] as const;
