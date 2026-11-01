/**
 * The assistant health check (AD-13, AD-15, AD-27, FR-30, FR-36, D9; Story 6.11), every minute:
 * once the assistant is down (no connected heartbeat for 5 minutes, assistant-heartbeat.command.ts)
 * it is marked down and one critical `assistant_down` alert goes to the owner; while it stays down
 * nothing more is raised. When a connected beat is back the next check clears the down state and
 * raises nothing. Nothing here touches Zalo: the loss is seen only through the beats the
 * assistant's session reports. Customers keep the website meanwhile, and notifications wait on the
 * server (the assistant pulls none while its session is down) until the 7-day limit drops them.
 */
import type { Clock } from "@cashback/core";

import type { Logger } from "../../platform/log/logger";
import type { AlertPort } from "../../platform/ports/alert.port";
import type { AssistantHeartbeats, AssistantState } from "./assistant-heartbeat.command";

export const ASSISTANT_DOWN_ALERT = { kind: "assistant_down", severity: "critical" } as const;

export interface AssistantHealthDeps {
  readonly heartbeats: AssistantHeartbeats;
  readonly clock: Clock;
  readonly alerts: AlertPort;
  readonly logger?: Pick<Logger, "info" | "warn">;
}

export type AssistantHealthStep = "went_down" | "still_down" | "came_back" | AssistantState;

export function runAssistantHealthCheck(deps: AssistantHealthDeps): AssistantHealthStep {
  const now = deps.clock.now();
  const { state, at } = deps.heartbeats.liveness(now);
  const wasDown = deps.heartbeats.downSince() !== null;
  if (state === "down") {
    if (wasDown) return "still_down";
    deps.heartbeats.markDown(now);
    deps.alerts.alert(ASSISTANT_DOWN_ALERT.kind, ASSISTANT_DOWN_ALERT.severity);
    deps.logger?.warn({ lastConnectedAt: at }, "operations.assistant.down");
    return "went_down";
  }
  if (state === "up" && wasDown) {
    deps.heartbeats.markUp();
    deps.logger?.info({ lastConnectedAt: at }, "operations.assistant.back");
    return "came_back";
  }
  return state;
}
