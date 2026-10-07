import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { AuthController } from "./http/auth.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
})
export class IdentityModule {}
