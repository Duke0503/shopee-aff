import type { FastifyInstance } from "fastify";
import { healthResponseSchema, type HealthResponse } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

export function registerHealthRoutes(app: FastifyInstance, clock: Clock): void {
  app.get("/api/health", async (): Promise<HealthResponse> => {
    return healthResponseSchema.parse({ status: "ok", service: "cashback-server", checkedAt: clock.now() });
  });
}
