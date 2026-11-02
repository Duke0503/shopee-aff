/**
 * The health check (AD-27, FR-30, Story 8.3), every minute: it reads the one health model
 * (health-model.query.ts) and raises the alert of each part that has just gone down, or that stays
 * down for a new reason (a backup whose off-site copy failed now failing locally; a bridge held for
 * a captcha now signed out): while a part stays down for the same reason nothing more is raised,
 * and once it is back the next fall alerts again. The states it compares with are kept in memory, so after a restart a part already down
 * alerts once more. The assistant's down mark, which the website banner reads, is kept by the
 * assistant check of Story 6.11 inside the same run. A last beat that reports the Zalo session taken
 * by another login raises `assistant_session_conflict` once, without waiting for `assistant_down`:
 * the assistant has stopped reconnecting, and only the owner can tell which login must go.
 */
import type { Clock } from "@cashback/core";

import type { Logger } from "../../platform/log/logger";
import type { AlertPort } from "../../platform/ports/alert.port";
import { runAssistantHealthCheck } from "./assistant-health.job";
import type { AssistantHeartbeats } from "./assistant-heartbeat.command";
import type { HealthEntry } from "./health-model.query";

export interface HealthCheckDeps {
  /** The one health model, read in one snapshot. */
  readonly model: () => HealthEntry[];
  readonly alerts: AlertPort;
  readonly clock: Clock;
  readonly heartbeats?: AssistantHeartbeats;
  readonly logger?: Pick<Logger, "info" | "warn">;
}

export interface HealthCheck {
  /** One check: the model it read and the alerts it raised. */
  run(): { readonly model: readonly HealthEntry[]; readonly raised: readonly HealthEntry["alert"][] };
}

const NO_ALERTS: AlertPort = { alert: () => undefined };

export const ASSISTANT_SESSION_CONFLICT_ALERT = { kind: "assistant_session_conflict", severity: "critical" } as const;

export function healthCheck(deps: HealthCheckDeps): HealthCheck {
  /** Per part, the state and the alert kind of the last check. */
  const previous = new Map<string, string>();
  let conflicted = false;
  return {
    run() {
      // The assistant check keeps the down mark only; the alert comes from the model below.
      if (deps.heartbeats) runAssistantHealthCheck({ heartbeats: deps.heartbeats, clock: deps.clock, alerts: NO_ALERTS, ...(deps.logger ? { logger: deps.logger } : {}) });
      const model = deps.model();
      const raised: HealthEntry["alert"][] = [];
      const conflict = deps.heartbeats?.last()?.beat.sessionConflict === true;
      if (conflict && !conflicted) {
        deps.alerts.alert(ASSISTANT_SESSION_CONFLICT_ALERT.kind, ASSISTANT_SESSION_CONFLICT_ALERT.severity);
        deps.logger?.warn({ kind: ASSISTANT_SESSION_CONFLICT_ALERT.kind }, "operations.assistant.session_conflict");
        raised.push(ASSISTANT_SESSION_CONFLICT_ALERT);
      }
      conflicted = conflict;
      for (const entry of model) {
        const now = `${entry.state} ${entry.alert?.kind ?? ""}`;
        const before = previous.get(entry.component);
        previous.set(entry.component, now);
        if ((entry.state !== "down" && entry.state !== "due") || entry.alert === null || before === now) continue;
        deps.alerts.alert(entry.alert.kind, entry.alert.severity);
        deps.logger?.warn({ component: entry.component, kind: entry.alert.kind }, "operations.health.down");
        raised.push(entry.alert);
      }
      return { model, raised };
    },
  };
}
