-- Reconciliation runs (AD-4 owner: orders; AD-8, AD-13, AD-27, D43; Stories 3.7 and 3.8).
-- One row per network per run: the hourly 7-day read (HOURLY) or one day slice of the nightly
-- sweep (NIGHTLY). It is business data, so it stays though job outcomes are log lines (AD-13).
-- Insert-only: a run is written once, when it ends, with both its start and end, and is written
-- for a failed run too. A run whose read failed (page cap, fetch error) applied nothing: a
-- partial read is never applied (D43, R6). A saved file re-read unchanged for over 24 hours is
-- SOURCE_STALE: nothing is applied and no order's last-seen time moves, so R5 aging still sees it.

CREATE TABLE reconciliation_runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('HOURLY', 'NIGHTLY')),
  network TEXT NOT NULL CHECK (network IN ('shopee', 'accesstrade')),
  -- What was read (file name or endpoint); never a secret. NULL when the read failed.
  source TEXT,
  -- A file source's checksum and modification time; NULL for an API read.
  source_sha256 TEXT,
  source_modified_at TEXT,
  -- The purchase-time window read, half-open [window_from, window_to).
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  -- From a monotonic clock, so a wall-clock step never makes it negative.
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  -- 1 when the wall clock stepped back during the run; finished_at is then held at started_at.
  clock_stepped INTEGER NOT NULL DEFAULT 0 CHECK (clock_stepped IN (0, 1)),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED', 'SOURCE_STALE')),
  -- The source error code (report_page_cap, report_fetch_failed, ...), row_apply_failed or source_stale.
  error_code TEXT,
  rows_read INTEGER NOT NULL DEFAULT 0 CHECK (rows_read >= 0),
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied >= 0),
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  deferred INTEGER NOT NULL DEFAULT 0 CHECK (deferred >= 0),
  unrecorded INTEGER NOT NULL DEFAULT 0 CHECK (unrecorded >= 0),
  frozen INTEGER NOT NULL DEFAULT 0 CHECK (frozen >= 0),
  cases_opened INTEGER NOT NULL DEFAULT 0 CHECK (cases_opened >= 0),
  failed_rows INTEGER NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  CHECK ((outcome = 'SUCCEEDED') = (error_code IS NULL)),
  CHECK (window_from < window_to AND started_at <= finished_at)
);
CREATE INDEX reconciliation_runs_latest ON reconciliation_runs (kind, network, run_id);
CREATE TRIGGER IF NOT EXISTS reconciliation_runs_no_update BEFORE UPDATE ON reconciliation_runs BEGIN SELECT RAISE(ABORT, 'insert_only: reconciliation_runs'); END;
CREATE TRIGGER IF NOT EXISTS reconciliation_runs_no_delete BEFORE DELETE ON reconciliation_runs BEGIN SELECT RAISE(ABORT, 'insert_only: reconciliation_runs'); END;
