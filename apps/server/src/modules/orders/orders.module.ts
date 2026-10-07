import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { AdminGuard } from "../identity/http/admin.guard";
import { OrdersController } from "./http/orders.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [OrdersController],
  providers: [AdminGuard],
})
export class OrdersModule {}
