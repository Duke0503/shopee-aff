import { Module } from "@nestjs/common";

import { NotificationsModule } from "../../notifications";
import { SiteController } from "./http/site.controller";

/**
 * Website text and settings: the labels every screen reads and the figures the
 * public pages quote. It owns no table, so there is still one writer per
 * column; it only reads the message file and the environment.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [SiteController],
})
export class SiteModule {}
