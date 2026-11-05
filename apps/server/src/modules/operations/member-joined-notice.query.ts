/**
 * The text of the Telegram notice to the DP Business group when someone joins the Zalo group (D64),
 * in the live format (src/cashback/core/telegram_alerts.py `notify_new_member_joined`), with the
 * words from packages/labels/vi/member-notices.json. A rank not known or a total of zero leaves its
 * line out. Every value from outside is escaped for Telegram's HTML mode, and line breaks in a name
 * become spaces, so a joiner's display name cannot add lines that look like the notice's own.
 */
import { formatVnAlertStamp, type Instant } from "@cashback/core";
import LABELS from "@cashback/labels/vi/member-notices.json" with { type: "json" };

export interface JoinedMember {
  readonly name: string;
  readonly userId: string;
  readonly groupName: string;
  readonly memberCount: number | null;
  readonly totalCustomers: number;
  readonly at: Instant;
}

const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const oneLine = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();

export function memberJoinedText(m: JoinedMember): string {
  return [
    LABELS.header,
    fill(LABELS.line_name, { name: escapeHtml(oneLine(m.name)) }),
    ...(m.memberCount === null ? [] : [fill(LABELS.line_rank, { rank: String(m.memberCount), group: escapeHtml(m.groupName) })]),
    ...(m.totalCustomers > 0 ? [fill(LABELS.line_total, { total: String(m.totalCustomers) })] : []),
    fill(LABELS.line_uid, { uid: escapeHtml(m.userId) }),
    fill(LABELS.line_time, { time: formatVnAlertStamp(m.at) }),
  ].join("\n");
}
