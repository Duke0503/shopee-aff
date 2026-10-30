import { createHash } from "node:crypto";

import { render, type Messages } from "./messages";

/**
 * Owner alerts: the text the backend sends to the two Telegram groups (dev for
 * bugs and recoveries, business for news about the shop). The assistant reports
 * its own crashes here — see `internal/alerts/telegram`. Wording lives in
 * `resources/messages.vi.json` like all the rest, so re-wording an alert never
 * needs a deploy.
 */

export type AlertSeverity = "CRITICAL" | "HIGH" | "WARNING";
export type AlertChannel = "dev" | "business";

export interface AlertMessage {
  channel: AlertChannel;
  text: string;
  /** The anti-spam key. An empty key is never paused. */
  fingerprint: string;
  severity: AlertSeverity;
}

const SEVERITIES: AlertSeverity[] = ["CRITICAL", "HIGH", "WARNING"];

const HEADER_KEY: Record<AlertSeverity, string> = {
  CRITICAL: "telegram_bug_critical",
  HIGH: "telegram_bug_high",
  WARNING: "telegram_bug_warning",
};

/** Where the link generator lands when the caller sends no address of its own. */
const CAPTCHA_URL = "affiliate.shopee.vn/verify/...";
const SESSION_URL = "passport.shopee.vn / login";

/** The ugly part no one owns, so the alert says who to look at instead. */
const DEFAULT_SOURCE = "Backend Service";

/** `HH:MM:SS - DD/MM/YYYY`, the stamp the owner already reads. */
export function alertTime(nowIso: string): string {
  const [date = "", time = ""] = nowIso.split("T");
  const [year = "", month = "", day = ""] = date.split("-");
  return `${time} - ${day}/${month}/${year}`;
}

/** Escape what Telegram's HTML mode would otherwise read as markup. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normaliseSeverity(value: string): AlertSeverity {
  const upper = value.toUpperCase() as AlertSeverity;
  return SEVERITIES.includes(upper) ? upper : "HIGH";
}

export interface BugAlertInput {
  title: string;
  details: string;
  severity: string;
  source?: string;
  errorTrace?: string;
  actionNeeded?: string;
  /** Defaults to a hash of the severity, source, title and first 80 characters. */
  fingerprint?: string;
}

/** One bug report to the dev group. Ports `telegram_alerts.report_bug`. */
export function bugAlert(messages: Messages, input: BugAlertInput, nowIso: string): AlertMessage {
  const severity = normaliseSeverity(input.severity);
  const source = input.source ?? "";
  const fingerprint =
    input.fingerprint?.trim() ||
    createHash("md5")
      .update(`${severity}:${source}:${input.title}:${input.details.slice(0, 80)}`, "utf8")
      .digest("hex");

  const lines = [
    render(messages, HEADER_KEY[severity], { title: escapeHtml(input.title) }),
    render(messages, "telegram_bug_source", { source: escapeHtml(source || DEFAULT_SOURCE) }),
    render(messages, "telegram_bug_time", { time: alertTime(nowIso) }),
    render(messages, "telegram_bug_details", { details: escapeHtml(input.details) }),
  ];
  if (input.errorTrace) {
    lines.push(
      render(messages, "telegram_bug_trace", { trace: escapeHtml(input.errorTrace.slice(0, 1200)) }),
    );
  }
  if (input.actionNeeded) {
    lines.push(render(messages, "telegram_bug_action", { action: escapeHtml(input.actionNeeded) }));
  }

  return { channel: "dev", text: lines.join("\n"), fingerprint, severity };
}

export interface RecoveryInput {
  title: string;
  details: string;
}

/** "It is working again", to the dev group. Ports `telegram_alerts.send_recovery`. */
export function recoveryAlert(messages: Messages, input: RecoveryInput, nowIso: string): AlertMessage {
  return {
    channel: "dev",
    text: render(messages, "telegram_recovered", {
      title: escapeHtml(input.title),
      time: alertTime(nowIso),
      details: escapeHtml(input.details),
    }),
    fingerprint: "",
    severity: "WARNING",
  };
}

/** Shopee asked for a captcha, so nobody can create links until someone solves it. */
export function captchaAlert(messages: Messages, input: { currentUrl: string }, nowIso: string): AlertMessage {
  return bugAlert(
    messages,
    {
      title: render(messages, "telegram_captcha_title"),
      details: render(messages, "telegram_captcha_details", { url: input.currentUrl || CAPTCHA_URL }),
      severity: "CRITICAL",
      source: "shopee.link_generator",
      actionNeeded: render(messages, "telegram_captcha_action"),
      fingerprint: "shopee_captcha",
    },
    nowIso,
  );
}

/** Shopee signed us out, which stops link creation just as surely. */
export function sessionAlert(messages: Messages, input: { currentUrl: string }, nowIso: string): AlertMessage {
  return bugAlert(
    messages,
    {
      title: render(messages, "telegram_session_title"),
      details: render(messages, "telegram_session_details", { url: input.currentUrl || SESSION_URL }),
      severity: "CRITICAL",
      source: "shopee.link_generator",
      actionNeeded: render(messages, "telegram_session_action"),
      fingerprint: "shopee_session",
    },
    nowIso,
  );
}

/** The Chrome bridge is gone, so Shopee pages cannot be driven at all. */
export function bridgeAlert(messages: Messages, nowIso: string): AlertMessage {
  return bugAlert(
    messages,
    {
      title: render(messages, "telegram_bridge_title"),
      details: render(messages, "telegram_bridge_details"),
      severity: "CRITICAL",
      source: "shopee.browser_bridge",
      actionNeeded: render(messages, "telegram_bridge_action"),
      fingerprint: "shopee_bridge",
    },
    nowIso,
  );
}

export interface ZaloConflictInput {
  reconnectCount?: string;
  reason?: string;
}

/** Two Zalo workers fighting over one session — the account can get locked. */
export function zaloConflictAlert(messages: Messages, input: ZaloConflictInput, nowIso: string): AlertMessage {
  const count = input.reconnectCount?.trim() || "3";
  const reason = input.reason?.trim() || render(messages, "telegram_conflict_reason_default");
  return bugAlert(
    messages,
    {
      title: render(messages, "telegram_conflict_title"),
      details: render(messages, "telegram_conflict_details", { count, reason }),
      severity: "CRITICAL",
      source: "zalo_assistant/assistant_worker.js",
      actionNeeded: render(messages, "telegram_conflict_action"),
      fingerprint: "zalo_conflict",
    },
    nowIso,
  );
}

export interface MemberJoinedInput {
  displayName: string;
  memberRank: number;
  groupName: string;
  totalCustomers: number;
  zaloUid: string;
}

/** Someone joined the Zalo group: the business group likes to see this. */
export function memberJoinedAlert(messages: Messages, input: MemberJoinedInput, nowIso: string): AlertMessage {
  const lines = [
    render(messages, "telegram_member_header"),
    render(messages, "telegram_member_name", { name: escapeHtml(input.displayName) }),
    render(messages, "telegram_member_rank", {
      rank: input.memberRank,
      group: escapeHtml(input.groupName),
    }),
  ];
  if (input.totalCustomers > 0) {
    lines.push(render(messages, "telegram_member_total", { total: input.totalCustomers }));
  }
  if (input.zaloUid) {
    lines.push(render(messages, "telegram_member_uid", { uid: escapeHtml(input.zaloUid) }));
  }
  lines.push(render(messages, "telegram_member_time", { time: alertTime(nowIso) }));

  return { channel: "business", text: lines.join("\n"), fingerprint: "", severity: "WARNING" };
}
