import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../shared/database/database.module";
import { HealthController } from "../../shared/health.controller";
import { AssistantController } from "./http/assistant.controller";

/**
 * The INTERNAL listener's whole app (port 8902): assistant-only routes, every
 * request carrying the assistant token. The public app never mounts this, so
 * these routes cannot be reached from outside (ADR-16).
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AssistantController, HealthController],
})
export class AssistantModule {}
