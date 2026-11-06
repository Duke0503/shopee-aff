-- The daily link report of the DP Business group (AD-4 owner: operations; D66). One row per reported
-- Vietnam day, so one report per day however often the job runs or the server restarts.
--   report_date  the day the report covers, `YYYY-MM-DD`
--   parts        JSON array of the rendered messages, written once on the first attempt, so a retry
--                resumes the same text. It holds customer names, so it is cleared (NULL) when the
--                report is sent, and when a later day replaces an unsent report.
--   parts_sent   how many messages the bot API accepted; a retry resumes at the next one
--   sent_at      when the last message was accepted; NULL on a report not sent in full
-- Nothing is backfilled: no row is written for an earlier day.
CREATE TABLE daily_link_reports (
  report_date TEXT PRIMARY KEY NOT NULL CHECK (report_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  parts TEXT,
  parts_sent INTEGER NOT NULL DEFAULT 0 CHECK (parts_sent >= 0),
  sent_at TEXT
);
