/**
 * What the later import steps need to know about identity once it is read: which customer ids
 * exist, which one is the guest account, and where each alias leads. A live order or link
 * request names a customer by its live id; the import keeps that id when it is a customer and
 * follows an alias when it is not (merge.py:80-85 moved rows, so this is the rare leftover).
 */
import type { IdentityImport } from "../modules/identity/index";

export interface CutoverContext {
  readonly customerIds: ReadonlySet<string>;
  readonly houseIds: ReadonlySet<string>;
  readonly aliases: ReadonlyMap<string, string>;
}

export function contextOf(identity: IdentityImport): CutoverContext {
  return {
    customerIds: new Set(identity.customers.map((c) => c.customerId)),
    houseIds: new Set(identity.customers.filter((c) => c.role === "HOUSE").map((c) => c.customerId)),
    aliases: new Map(identity.aliases.map((a) => [a.alias, a.customerId])),
  };
}

export type OwnerOf = { customerId: string; via: "id" | "alias" } | null;

export function ownerOf(context: CutoverContext, liveCustomerId: string | null): OwnerOf {
  if (liveCustomerId === null || liveCustomerId === "") return null;
  if (context.customerIds.has(liveCustomerId)) return { customerId: liveCustomerId, via: "id" };
  const target = context.aliases.get(liveCustomerId);
  return target !== undefined && context.customerIds.has(target) ? { customerId: target, via: "alias" } : null;
}

/** The affiliate network behind a live platform: Shopee's own program, or AccessTrade (accesstrade_reconciler.py:195-203). */
const NETWORK_OF_PLATFORM: Readonly<Record<string, "shopee" | "accesstrade">> = {
  shopee: "shopee",
  shopeefood: "shopee",
  tiktok: "accesstrade",
  lazada: "accesstrade",
  highlands: "accesstrade",
  thecoffeehouse: "accesstrade",
};

export function networkOfPlatform(platform: string): "shopee" | "accesstrade" | null {
  return Object.hasOwn(NETWORK_OF_PLATFORM, platform) ? (NETWORK_OF_PLATFORM[platform] ?? null) : null;
}
