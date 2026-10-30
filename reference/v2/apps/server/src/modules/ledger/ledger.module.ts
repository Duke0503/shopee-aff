import { Module } from "@nestjs/common";

import { NotificationsModule } from "../../notifications";
import { DatabaseModule } from "../../shared/database/database.module";
import { AdminGuard, SessionGuard, StaffGuard } from "../identity";
import { BillController } from "./http/bill.controller";
import { MyBalanceController } from "./http/my-balance.controller";
import { PaymentsController } from "./http/payments.controller";
import { PayoutsController } from "./http/payouts.controller";
import { ProofController } from "./http/proof.controller";
import { TransfersController } from "./http/transfers.controller";

@Module({
  imports: [DatabaseModule, NotificationsModule],
  controllers: [
    PayoutsController,
    TransfersController,
    MyBalanceController,
    PaymentsController,
    BillController,
    ProofController,
  ],
  providers: [AdminGuard, SessionGuard, StaffGuard],
})
export class LedgerModule {}
