import { Module } from "@nestjs/common";

import { IdentityModule } from "./modules/identity/identity.module";
import { LedgerModule } from "./modules/ledger/ledger.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { HealthController } from "./shared/health.controller";

/**
 * Root module. Each business area plugs in here as it moves: Identity,
 * Orders, Ledger. Affiliate follows in Phase 3.
 */
@Module({
  imports: [IdentityModule, OrdersModule, LedgerModule],
  controllers: [HealthController],
})
export class AppModule {}
