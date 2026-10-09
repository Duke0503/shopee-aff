import type { BridgeClient } from "../../../browser-bridge/bridge.client";
import type { AccessTradePort } from "./accesstrade.client";
import type { BaseAffiliateProvider } from "./base.provider";
import { LazadaProvider } from "./lazada.provider";
import { ShopeeProvider } from "./shopee.provider";
import { ShopeeFoodProvider } from "./shopeefood.provider";
import { TikTokProvider } from "./tiktok.provider";

/** Picks the provider that recognises a product URL. */
export class ProviderRegistry {
  private readonly providers: BaseAffiliateProvider[];

  constructor(providers: BaseAffiliateProvider[]) {
    this.providers = providers;
  }

  forUrl(url: string): BaseAffiliateProvider | null {
    return this.providers.find((provider) => provider.canHandle(url)) ?? null;
  }
}

/** The Nest injection token for the registry. */
export const PROVIDER_REGISTRY = Symbol("PROVIDER_REGISTRY");

export interface ProviderDeps {
  accessTrade: AccessTradePort;
  /** The loopback bridge, or null while the extension queue is not wired. */
  bridge: BridgeClient | null;
}

/**
 * Builds the registry in priority order. ShopeeFood is registered BEFORE
 * Shopee: `food.shopee.vn` is a subdomain of `shopee.vn`, so Shopee's host
 * check would otherwise claim it.
 */
export function createProviderRegistry(deps: ProviderDeps): ProviderRegistry {
  const providers: BaseAffiliateProvider[] = [];
  if (deps.bridge) providers.push(new ShopeeFoodProvider(deps.bridge), new ShopeeProvider(deps.bridge));
  providers.push(new TikTokProvider(deps.accessTrade), new LazadaProvider(deps.accessTrade));
  return new ProviderRegistry(providers);
}
