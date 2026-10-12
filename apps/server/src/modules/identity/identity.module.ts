import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { AdminGuard } from "./http/admin.guard";
import { AuthController } from "./http/auth.controller";
import { MeController } from "./http/me.controller";
import { SessionGuard } from "./http/session.guard";
import { StaffGuard } from "./http/staff.guard";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController, MeController],
  providers: [SessionGuard, AdminGuard, StaffGuard],
})
export class IdentityModule {}
