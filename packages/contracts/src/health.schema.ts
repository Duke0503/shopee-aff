import { z } from "zod";
import { INSTANT_PATTERN } from "@cashback/core";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("cashback-server"),
  checkedAt: z.string().regex(INSTANT_PATTERN),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
