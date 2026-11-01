-- The affiliate browser's one work list (AD-4 owner: linking; AD-14, D7, D47; Story 5.1).
-- A LINK job is one Shopee custom-link submission for one link request, so for one customer:
-- sub_id1 is that customer's id (with the `DEV` prefix in dev, AD-25) and sub_id2 is the request
-- id, both letters and digits only. The table refuses any other pairing, so no job can carry a
-- second customer or another request's sub_id2 (INV-1). LOOKUP and REPORT_PAGE jobs come with
-- Stories 5.6 and 5.9. At most one open LINK job per request.
CREATE TABLE bridge_jobs (
  job_id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('LINK', 'LOOKUP', 'REPORT_PAGE')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'DONE', 'FAILED')),
  request_id TEXT REFERENCES link_requests (request_id),
  customer_id TEXT,
  sub_id1 TEXT,
  sub_id2 TEXT,
  source_url TEXT,
  result_url TEXT,
  failure TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  CHECK (
    kind <> 'LINK' OR (
      request_id IS NOT NULL AND customer_id IS NOT NULL AND source_url IS NOT NULL
      AND sub_id1 <> '' AND sub_id1 NOT GLOB '*[^A-Za-z0-9]*'
      AND sub_id2 <> '' AND sub_id2 NOT GLOB '*[^A-Za-z0-9]*'
      AND sub_id2 = request_id
      AND (sub_id1 = customer_id OR sub_id1 = 'DEV' || customer_id)
    )
  ),
  CHECK ((status = 'PENDING') = (finished_at IS NULL))
);
CREATE UNIQUE INDEX bridge_jobs_one_open_link ON bridge_jobs (request_id) WHERE kind = 'LINK' AND status = 'PENDING';
CREATE INDEX bridge_jobs_pending ON bridge_jobs (status, kind, job_id);

-- When a QUEUED request whose submission failed may be handed to the bridge again (Story 5.1 review
-- item 1): a failing request backs off with a growing delay so it never holds up the requests
-- behind it. NULL means now.
ALTER TABLE link_requests ADD COLUMN next_attempt_at TEXT;
CREATE INDEX link_requests_queue ON link_requests (status, next_attempt_at);
