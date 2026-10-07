import { Module } from "@nestjs/common";

import { IdentityModule } from "./modules/identity/identity.module";
import { HealthController } from "./shared/health.controller";

/**
 * Root module. Business modules plug in here. Identity (customers, auth,
 * sessions) is the first area to move, per the migration plan.
 */
@Module({
  imports: [IdentityModule],
  controllers: [HealthController],
})
export class AppModule {}
