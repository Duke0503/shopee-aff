import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { AdminGuard } from "../identity/http/admin.guard";
import { SessionGuard } from "../identity/http/session.guard";
import { MyBalanceController } from "./http/my-balance.controller";
import { PayoutsController } from "./http/payouts.controller";
import { TransfersController } from "./http/transfers.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [PayoutsController, TransfersController, MyBalanceController],
  providers: [AdminGuard, SessionGuard],
})
export class LedgerModule {}
