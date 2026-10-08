import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { AdminGuard } from "../identity/http/admin.guard";
import { SessionGuard } from "../identity/http/session.guard";
import { CampaignsController } from "./http/campaigns.controller";
import { MyOrdersController } from "./http/my-orders.controller";
import { OrdersController } from "./http/orders.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [OrdersController, MyOrdersController, CampaignsController],
  providers: [AdminGuard, SessionGuard],
})
export class OrdersModule {}
