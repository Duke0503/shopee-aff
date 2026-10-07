import { Module } from "@nestjs/common";

import { IdentityModule } from "./modules/identity/identity.module";
import { LedgerModule } from "./modules/ledger/ledger.module";
import { HealthController } from "./shared/health.controller";

/**
 * Root module. Identity first, then Ledger (payouts) — the business modules
 * plug in here as each area moves.
 */
@Module({
  imports: [IdentityModule, LedgerModule],
  controllers: [HealthController],
})
export class AppModule {}
