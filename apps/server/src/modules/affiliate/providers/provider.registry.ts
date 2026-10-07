import type { BaseAffiliateProvider } from "./base.provider";

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
