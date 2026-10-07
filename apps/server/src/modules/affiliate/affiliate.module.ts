import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { ShareController } from "./http/share.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [ShareController],
})
export class AffiliateModule {}
