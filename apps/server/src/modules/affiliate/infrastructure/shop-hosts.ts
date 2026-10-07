/**
 * THE one list of shop domains. Providers read from here; they never keep
 * their own copy. Two copies once drifted and `shp.ee` links were treated as
 * plain chat for an afternoon.
 */
export const SHOP_HOSTS: Record<string, string[]> = {
  shopee: ["shopee.vn", "shp.ee"],
  tiktok: ["tiktok.com"],
  lazada: ["lazada.vn", "lazada.sg", "lazada.com.my"],
  shopeefood: ["shopeefood.vn"],
};

/** True when the hostname is the domain itself or a subdomain of it. */
export function belongsTo(hostname: string, platform: string): boolean {
  const domains = SHOP_HOSTS[platform] ?? [];
  const host = (hostname ?? "").toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
