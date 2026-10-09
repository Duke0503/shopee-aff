import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { AdminGuard, StaffGuard } from "../identity";
import { AdminReadController } from "./http/admin-read.controller";

/**
 * The staff read surface. It owns no table: it only reads what Identity, Orders
 * and Ledger already wrote, so there is still exactly one writer per column.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AdminReadController],
  providers: [AdminGuard, StaffGuard],
})
export class AdminModule {}
