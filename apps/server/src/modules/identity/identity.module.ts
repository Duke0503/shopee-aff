import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { AuthController } from "./http/auth.controller";
import { MeController } from "./http/me.controller";
import { SessionGuard } from "./http/session.guard";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController, MeController],
  providers: [SessionGuard],
})
export class IdentityModule {}
