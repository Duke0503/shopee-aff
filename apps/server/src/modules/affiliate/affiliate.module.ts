import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { ConvertController } from "./http/convert.controller";
import { DealsController } from "./http/deals.controller";
import { ShareController } from "./http/share.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [ShareController, ConvertController, DealsController],
})
export class AffiliateModule {}
