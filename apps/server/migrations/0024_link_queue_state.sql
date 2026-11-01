-- The state of the affiliate browser's link queue (AD-4 owner: linking; AD-14, AD-27, D8; Story 5.5).
-- One row per queue; today only the Shopee queue served through the browser bridge. A captcha or a
-- page error holds the queue until `held_until`, uncounted, so the affiliate session is never
-- pushed further into captcha; a redirect of the custom-link page to the login page pauses it
-- until the owner resumes it by command (`paused_at` set). While the queue is held or paused no
-- Shopee bridge job is handed out; AccessTrade requests, which never reach the browser, go on.
-- `last_page_error_request` is the request whose submission last ended in a page error, cleared by
-- any other answer: a page error on a different request right after it is a session problem
-- (hold), the same request again is that request's problem (Story 5.5 review item 1).
CREATE TABLE link_queue_state (
  queue TEXT PRIMARY KEY NOT NULL CHECK (queue IN ('shopee')),
  paused_reason TEXT CHECK (paused_reason IS NULL OR paused_reason IN ('login_redirect')),
  paused_at TEXT,
  held_reason TEXT CHECK (held_reason IS NULL OR held_reason IN ('captcha', 'page_error')),
  held_until TEXT,
  last_page_error_request TEXT,
  CHECK ((paused_reason IS NULL) = (paused_at IS NULL)),
  CHECK ((held_reason IS NULL) = (held_until IS NULL))
);

-- A request's own page errors (Story 5.5 review item 1): how many in a row, for its uncounted
-- back-off, and when the first one happened; a request that keeps meeting page errors for 30
-- minutes is FAILED and its customer told.
ALTER TABLE link_requests ADD COLUMN page_errors INTEGER NOT NULL DEFAULT 0 CHECK (page_errors >= 0);
ALTER TABLE link_requests ADD COLUMN page_error_since TEXT;
