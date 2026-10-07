import { z } from "zod";

/** The shopping platforms we make tracking links for. */
export const Platform = z.enum(["shopee", "tiktok", "lazada", "shopeefood"]);
export type Platform = z.infer<typeof Platform>;
