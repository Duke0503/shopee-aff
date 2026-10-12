import { describe, expect, it } from "vitest";

import { AlertCooldown } from "./alert-cooldown";
import type { Messages } from "./messages";
import {
  alertTime,
  bridgeAlert,
  bugAlert,
  escapeHtml,
  memberJoinedAlert,
  recoveryAlert,
  zaloConflictAlert,
} from "./telegram-alerts";

const MESSAGES: Messages = {
  telegram_bug_critical: "CRITICAL {title}",
  telegram_bug_high: "HIGH {title}",
  telegram_bug_warning: "WARNING {title}",
  telegram_bug_source: "\nSRC {source}",
  telegram_bug_time: "TIME {time}",
  telegram_bug_details: "DETAILS\n{details}",
  telegram_bug_trace: "\nTRACE\n{trace}",
  telegram_bug_action: "\nACTION\n{action}",
  telegram_recovered: "RECOVERED {title} {time} {details}",
  telegram_bridge_title: "Bridge down",
  telegram_bridge_details: "The bridge is gone",
  telegram_bridge_action: "Open Chrome",
  telegram_conflict_title: "Zalo conflict",
  telegram_conflict_details: "count {count} because {reason}",
  telegram_conflict_reason_default: "two workers",
  telegram_conflict_action: "Close one",
  telegram_member_header: "MEMBER\n",
  telegram_member_name: "NAME {name}",
  telegram_member_rank: "RANK #{rank} {group}",
  telegram_member_total: "TOTAL {total}",
  telegram_member_uid: "UID {uid}",
  telegram_member_time: "TIME {time}",
};

const NOW = "2026-10-12T08:30:05";

describe("alertTime", () => {
  it("shows the stamp the owner already reads", () => {
    expect(alertTime(NOW)).toBe("08:30:05 - 12/10/2026");
  });
});

describe("escapeHtml", () => {
  it("escapes what Telegram would read as markup", () => {
    expect(escapeHtml("<b>a & b</b>")).toBe("&lt;b&gt;a &amp; b&lt;/b&gt;");
  });
});

describe("bugAlert", () => {
  it("builds the dev alert with the severity header and the extra blocks", () => {
    const alert = bugAlert(
      MESSAGES,
      { title: "Crashed", details: "boom", severity: "CRITICAL", source: "worker", errorTrace: "at x", actionNeeded: "restart" },
      NOW,
    );
    expect(alert.channel).toBe("dev");
    expect(alert.severity).toBe("CRITICAL");
    expect(alert.text).toBe(
      ["CRITICAL Crashed", "\nSRC worker", "TIME 08:30:05 - 12/10/2026", "DETAILS\nboom", "\nTRACE\nat x", "\nACTION\nrestart"].join(
        "\n",
      ),
    );
  });

  it("falls back to HIGH for a severity nobody knows", () => {
    expect(bugAlert(MESSAGES, { title: "T", details: "d", severity: "nonsense" }, NOW).severity).toBe("HIGH");
  });

  it("names an unknown source instead of leaving a blank", () => {
    const alert = bugAlert(MESSAGES, { title: "T", details: "d", severity: "HIGH" }, NOW);
    expect(alert.text).toContain("SRC Backend Service");
  });

  it("escapes the text and cuts a long trace", () => {
    const alert = bugAlert(
      MESSAGES,
      { title: "<i>T</i>", details: "<b>d</b>", severity: "HIGH", errorTrace: "x".repeat(2000) },
      NOW,
    );
    expect(alert.text).toContain("&lt;i&gt;T&lt;/i&gt;");
    expect(alert.text).toContain("DETAILS\n&lt;b&gt;d&lt;/b&gt;");
    expect(alert.text).toContain("x".repeat(1200));
    expect(alert.text).not.toContain("x".repeat(1201));
  });

  it("fingerprints by content, so the same bug and a different bug differ", () => {
    const first = bugAlert(MESSAGES, { title: "T", details: "d", severity: "HIGH", source: "s" }, NOW).fingerprint;
    const again = bugAlert(MESSAGES, { title: "T", details: "d", severity: "HIGH", source: "s" }, NOW).fingerprint;
    const other = bugAlert(MESSAGES, { title: "T", details: "d", severity: "CRITICAL", source: "s" }, NOW).fingerprint;
    expect(first).toBe(again);
    expect(other).not.toBe(first);
  });

  it("uses the fingerprint the caller gave", () => {
    expect(
      bugAlert(MESSAGES, { title: "T", details: "d", severity: "HIGH", fingerprint: "shopee_captcha" }, NOW).fingerprint,
    ).toBe("shopee_captcha");
  });
});

describe("presets", () => {
  it("gives the bridge its own fingerprint and critical severity", () => {
    const alert = bridgeAlert(MESSAGES, NOW);
    expect(alert).toMatchObject({ channel: "dev", severity: "CRITICAL", fingerprint: "shopee_bridge" });
    expect(alert.text).toContain("CRITICAL Bridge down");
    expect(alert.text).toContain("ACTION\nOpen Chrome");
  });

  it("defaults the Zalo reason and count when the caller sends neither", () => {
    const alert = zaloConflictAlert(MESSAGES, {}, NOW);
    expect(alert.fingerprint).toBe("zalo_conflict");
    expect(alert.text).toContain("count 3 because two workers");
  });

  it("keeps what the caller did send", () => {
    expect(zaloConflictAlert(MESSAGES, { reconnectCount: "5", reason: "session stolen" }, NOW).text).toContain(
      "count 5 because session stolen",
    );
  });

  it("never pauses a recovery", () => {
    expect(recoveryAlert(MESSAGES, { title: "Back", details: "again" }, NOW)).toMatchObject({
      channel: "dev",
      fingerprint: "",
    });
  });
});

describe("memberJoinedAlert", () => {
  it("lists name, rank, totals and the uid, with a blank line after the header", () => {
    const alert = memberJoinedAlert(
      MESSAGES,
      { displayName: "Lan", memberRank: 7, groupName: "Nhom", totalCustomers: 12, zaloUid: "Z9" },
      NOW,
    );
    expect(alert.channel).toBe("business");
    expect(alert.text).toBe(
      ["MEMBER\n", "NAME Lan", "RANK #7 Nhom", "TOTAL 12", "UID Z9", "TIME 08:30:05 - 12/10/2026"].join("\n"),
    );
  });

  it("leaves out the total and the uid when they are empty", () => {
    const alert = memberJoinedAlert(
      MESSAGES,
      { displayName: "Lan", memberRank: 0, groupName: "Nhom", totalCustomers: 0, zaloUid: "" },
      NOW,
    );
    expect(alert.text).not.toContain("TOTAL");
    expect(alert.text).not.toContain("UID");
  });
});

describe("AlertCooldown", () => {
  it("pauses the same fingerprint for the severity's window", () => {
    const cooldown = new AlertCooldown();
    expect(cooldown.allow("k", "CRITICAL", false, 0)).toBe(true);
    expect(cooldown.allow("k", "CRITICAL", false, 299_000)).toBe(false);
    expect(cooldown.allow("k", "CRITICAL", false, 300_000)).toBe(true);
  });

  it("uses a longer window for a lower severity and ten minutes for an unknown one", () => {
    const cooldown = new AlertCooldown();
    cooldown.allow("high", "HIGH", false, 0);
    expect(cooldown.allow("high", "HIGH", false, 899_000)).toBe(false);
    expect(cooldown.allow("high", "HIGH", false, 900_000)).toBe(true);

    cooldown.allow("weird", "SOMETHING", false, 0);
    expect(cooldown.allow("weird", "SOMETHING", false, 599_000)).toBe(false);
    expect(cooldown.allow("weird", "SOMETHING", false, 600_000)).toBe(true);
  });

  it("lets force through but still counts it as sent", () => {
    const cooldown = new AlertCooldown();
    cooldown.allow("k", "CRITICAL", false, 0);
    expect(cooldown.allow("k", "CRITICAL", true, 1_000)).toBe(true);
    expect(cooldown.allow("k", "CRITICAL", false, 2_000)).toBe(false);
  });

  it("only recovers an alert that was still open, once", () => {
    const cooldown = new AlertCooldown();
    expect(cooldown.recover("k")).toBe(false);

    cooldown.allow("k", "CRITICAL", false, 0);
    expect(cooldown.recover("k")).toBe(true);
    expect(cooldown.recover("k")).toBe(false);

    // Cleared, so the next alert is not paused by the one before the recovery.
    expect(cooldown.allow("k", "CRITICAL", false, 1_000)).toBe(true);
  });
});
