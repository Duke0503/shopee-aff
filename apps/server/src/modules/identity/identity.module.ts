import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { AdminGuard } from "./http/admin.guard";
import { AuthController } from "./http/auth.controller";
import { CustomersController } from "./http/customers.controller";
import { MeController } from "./http/me.controller";
import { SessionGuard } from "./http/session.guard";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController, MeController, CustomersController],
  providers: [SessionGuard, AdminGuard],
})
export class IdentityModule {}
