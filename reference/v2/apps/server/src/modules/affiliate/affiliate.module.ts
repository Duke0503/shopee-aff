import { Module } from "@nestjs/common";

import { HttpBridgeClient } from "../../browser-bridge/bridge.client";
import { NotificationsModule } from "../../notifications";
import { DatabaseModule } from "../../shared/database/database.module";
import { CacheController } from "./http/cache.controller";
import { ConvertController } from "./http/convert.controller";
import { DealsController } from "./http/deals.controller";
import { FnbController } from "./http/fnb.controller";
import { ShareController } from "./http/share.controller";
import { TikTokController } from "./http/tiktok.controller";
import {
  ACCESSTRADE_CLIENT,
  accessTradeConfigFromEnv,
  HttpAccessTrade,
} from "./providers/accesstrade.client";
import { createProviderRegistry, PROVIDER_REGISTRY } from "./providers/provider.registry";

/** The extension bridge is optional: without it, Shopee links stay pending. */
function bridgeFromEnv(): HttpBridgeClient | null {
  const baseUrl = (process.env.BRIDGE_URL ?? "").trim();
  if (baseUrl === "") return null;
  return new HttpBridgeClient(baseUrl, (process.env.BRIDGE_TOKEN ?? "").trim());
}

@Module({
  imports: [DatabaseModule, NotificationsModule],
  controllers: [
    ShareController,
    ConvertController,
    DealsController,
    FnbController,
    TikTokController,
    CacheController,
  ],
  providers: [
    {
      provide: ACCESSTRADE_CLIENT,
      useFactory: () => new HttpAccessTrade(accessTradeConfigFromEnv()),
    },
    {
      provide: PROVIDER_REGISTRY,
      useFactory: (accessTrade: HttpAccessTrade) =>
        createProviderRegistry({ accessTrade, bridge: bridgeFromEnv() }),
      inject: [ACCESSTRADE_CLIENT],
    },
  ],
})
export class AffiliateModule {}
