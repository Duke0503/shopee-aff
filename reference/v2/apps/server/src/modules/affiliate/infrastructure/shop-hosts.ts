/**
 * THE one list of shop domains. Providers read from here; they never keep
 * their own copy. Two copies once drifted and `shp.ee` links were treated as
 * plain chat for an afternoon.
 */
export const SHOP_HOSTS: Record<string, string[]> = {
  // ShopeeFood first: `food.shopee.vn` is a subdomain of `shopee.vn`, so
  // Shopee's check would claim it if it came first.
  shopeefood: ["shopeefood.vn", "food.shopee.vn"],
  shopee: ["shopee.vn", "shp.ee"],
  tiktok: ["tiktok.com"],
  lazada: ["lazada.vn", "lazada.sg", "lazada.com.my"],
};

/** True when the hostname is the domain itself or a subdomain of it. */
export function belongsTo(hostname: string, platform: string): boolean {
  const domains = SHOP_HOSTS[platform] ?? [];
  const host = (hostname ?? "").toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The platform that recognises a URL, or null when none does. */
export function platformForUrl(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const platform of Object.keys(SHOP_HOSTS)) {
    if (belongsTo(host, platform)) return platform;
  }
  return null;
}
