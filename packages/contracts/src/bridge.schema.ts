import { z } from "zod";

/** The fixed set of actions the Chrome extension knows how to run. */
export const BridgeAction = z.enum([
  "click",
  "type",
  "send_keys",
  "execute_script",
  "navigate",
  "navigate_execute",
  "get_tabs",
  "switch_tab",
  "reload",
  "screenshot",
  "fetch_bg",
  "network_capture",
  "upload_file",
  "request",
  "close_tab",
  "quit",
]);
export type BridgeAction = z.infer<typeof BridgeAction>;

/** A job handed to the extension from the server, and the result it returns. */
export const BridgeJob = z.object({
  id: z.string().min(1),
  action: BridgeAction,
  params: z.record(z.unknown()).default({}),
});
export type BridgeJob = z.infer<typeof BridgeJob>;

export const BridgeResult = z.object({
  id: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type BridgeResult = z.infer<typeof BridgeResult>;
