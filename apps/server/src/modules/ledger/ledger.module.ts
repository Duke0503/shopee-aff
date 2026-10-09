import { Module } from "@nestjs/common";

import { NotificationsModule } from "../../notifications";
import { DatabaseModule } from "../../shared/database/database.module";
import { AdminGuard, SessionGuard, StaffGuard } from "../identity";
import { MyBalanceController } from "./http/my-balance.controller";
import { PaymentsController } from "./http/payments.controller";
import { PayoutsController } from "./http/payouts.controller";
import { TransfersController } from "./http/transfers.controller";

@Module({
  imports: [DatabaseModule, NotificationsModule],
  controllers: [PayoutsController, TransfersController, MyBalanceController, PaymentsController],
  providers: [AdminGuard, SessionGuard, StaffGuard],
})
export class LedgerModule {}
