import { BadRequestException, Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";

import {
  ALERT_COOLDOWN,
  type AlertCooldown,
  type AlertMessage,
  bridgeAlert,
  bugAlert,
  captchaAlert,
  DELIVERY_PORT,
  type DeliveryPort,
  MESSAGES,
  type Messages,
  memberJoinedAlert,
  recoveryAlert,
  render,
  sessionAlert,
  zaloConflictAlert,
} from "../../../notifications";
import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { AssistantTokenGuard } from "../../../shared/guards/assistant-token.guard";
import { countCustomers, nowLocalIso } from "../../identity";

/** The Zalo conflict fingerprint, shared by the alert and its recovery. */
const CONFLICT_KEY = "zalo_conflict";

interface AlertBody {
  alert_type?: unknown;
  title?: unknown;
  details?: unknown;
  severity?: unknown;
  source?: unknown;
  error_trace?: unknown;
  action_needed?: unknown;
  fingerprint?: unknown;
  force?: unknown;
  key?: unknown;
  reconnect_count?: unknown;
  reason?: unknown;
  current_url?: unknown;
  display_name?: unknown;
  member_rank?: unknown;
  group_name?: unknown;
  zalo_uid?: unknown;
}

const text = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
};

const truthy = (value: unknown): boolean => value === true || value === "true" || value === 1 || value === "1";

/**
 * What the assistant and the browser bridge report to the owner's Telegram.
 * Internal listener only, token required (ADR-16), because these messages are
 * about our own plumbing and must never be reachable from outside.
 *
 * An alert that repeats is paused by severity (CRITICAL 5 minutes, HIGH 15,
 * WARNING 30); `force` overrides the pause. A "recovered" alert only goes out
 * when the matching failure was still open, so a quiet system stays quiet.
 */
@Controller("internal/alerts")
@UseGuards(AssistantTokenGuard)
export class AssistantAlertsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MESSAGES) private readonly messages: Messages,
    @Inject(DELIVERY_PORT) private readonly delivery: DeliveryPort,
    @Inject(ALERT_COOLDOWN) private readonly cooldown: AlertCooldown,
  ) {}

  @Post("telegram")
  async telegram(@Body() body: AlertBody) {
    const type = text(body?.alert_type) || "custom";
    const now = nowLocalIso();

    if (type === "zalo_recovered") return this.recover(now);

    const alert = this.frame(type, body, now);
    if (!alert) throw new BadRequestException("unknown alert_type");

    const paused =
      alert.fingerprint !== "" &&
      !this.cooldown.allow(alert.fingerprint, alert.severity, truthy(body?.force), Date.now());
    if (paused) return { ok: true, suppressed: true };

    return { ok: true, sent: await this.delivery.sendTelegram(alert.text, alert.channel) };
  }

  /** The Zalo connection came back: tell the owner only if it was broken. */
  private async recover(now: string) {
    if (!this.cooldown.recover(CONFLICT_KEY)) return { ok: true, suppressed: true };

    const alert = recoveryAlert(
      this.messages,
      {
        title: render(this.messages, "telegram_conflict_recovered_title"),
        details: render(this.messages, "telegram_conflict_recovered_details"),
      },
      now,
    );
    return { ok: true, sent: await this.delivery.sendTelegram(alert.text, alert.channel) };
  }

  /** The alert types the assistant's own reports are made of. Null = unknown. */
  private frame(type: string, body: AlertBody, now: string): AlertMessage | null {
    switch (type) {
      case "bug_report":
        return bugAlert(
          this.messages,
          {
            title: text(body.title) || render(this.messages, "telegram_bug_default_title"),
            details: text(body.details),
            severity: text(body.severity) || "HIGH",
            source: text(body.source) || "External / Worker",
            errorTrace: text(body.error_trace),
            actionNeeded: text(body.action_needed),
            fingerprint: text(body.fingerprint),
          },
          now,
        );
      case "zalo_conflict":
        return zaloConflictAlert(
          this.messages,
          { reconnectCount: text(body.reconnect_count), reason: text(body.reason) },
          now,
        );
      case "shopee_captcha":
        return captchaAlert(this.messages, { currentUrl: text(body.current_url) }, now);
      case "shopee_session":
        return sessionAlert(this.messages, { currentUrl: text(body.current_url) }, now);
      case "shopee_bridge":
        return bridgeAlert(this.messages, now);
      case "member_joined":
        return memberJoinedAlert(
          this.messages,
          {
            displayName: text(body.display_name) || render(this.messages, "telegram_member_default_name"),
            memberRank: Number(text(body.member_rank)) || 0,
            groupName: text(body.group_name) || render(this.messages, "group_default_name"),
            totalCustomers: countCustomers(this.db),
            zaloUid: text(body.zalo_uid),
          },
          now,
        );
      case "custom":
        return bugAlert(
          this.messages,
          {
            title: text(body.title) || render(this.messages, "telegram_custom_default_title"),
            details: text(body.details),
            severity: text(body.severity) || "WARNING",
            source: text(body.source) || "External / Worker",
            actionNeeded: text(body.action_needed),
            fingerprint: text(body.key) || "generic_alert",
          },
          now,
        );
      default:
        return null;
    }
  }
}
