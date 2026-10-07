import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { AdminGuard } from "../identity/http/admin.guard";
import { PayoutsController } from "./http/payouts.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [PayoutsController],
  providers: [AdminGuard],
})
export class LedgerModule {}
