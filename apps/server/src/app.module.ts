import { Module } from "@nestjs/common";

import { JobsModule } from "./jobs/jobs.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AffiliateModule } from "./modules/affiliate/affiliate.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { LedgerModule } from "./modules/ledger/ledger.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { HealthController } from "./shared/health.controller";

/**
 * Root module. Each business area plugs in here as it moves:
 * Identity, Affiliate, Orders, Ledger. Jobs sit on top and call the modules;
 * Admin reads across them.
 */
@Module({
  imports: [IdentityModule, AffiliateModule, OrdersModule, LedgerModule, AdminModule, JobsModule],
  controllers: [HealthController],
})
export class AppModule {}
