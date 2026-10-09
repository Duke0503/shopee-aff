import { Module } from "@nestjs/common";

import { HttpBridgeClient } from "../../browser-bridge/bridge.client";
import { DatabaseModule } from "../../shared/database/database.module";
import { ConvertController } from "./http/convert.controller";
import { DealsController } from "./http/deals.controller";
import { ShareController } from "./http/share.controller";
import { accessTradeConfigFromEnv, HttpAccessTrade } from "./providers/accesstrade.client";
import { createProviderRegistry, PROVIDER_REGISTRY } from "./providers/provider.registry";

/** The extension bridge is optional: without it, Shopee links stay pending. */
function bridgeFromEnv(): HttpBridgeClient | null {
  const baseUrl = (process.env.BRIDGE_URL ?? "").trim();
  if (baseUrl === "") return null;
  return new HttpBridgeClient(baseUrl, (process.env.BRIDGE_TOKEN ?? "").trim());
}

@Module({
  imports: [DatabaseModule],
  controllers: [ShareController, ConvertController, DealsController],
  providers: [
    {
      provide: PROVIDER_REGISTRY,
      useFactory: () =>
        createProviderRegistry({
          accessTrade: new HttpAccessTrade(accessTradeConfigFromEnv()),
          bridge: bridgeFromEnv(),
        }),
    },
  ],
})
export class AffiliateModule {}
