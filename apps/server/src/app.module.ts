import { Module } from "@nestjs/common";

import { HealthController } from "./shared/health.controller";

/**
 * Root module. Business modules (identity, affiliate, orders, ledger) plug in
 * here in later phases. For now only the health route exists.
 */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
