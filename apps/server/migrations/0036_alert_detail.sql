-- What an owner alert can say beyond its kind (AD-27 as changed by D65).
--   detail     JSON `{ "source": <step or reason>, "requestId"?: <id> }`: which step found the
--              captcha, or why a request is stuck. It holds ids only: the customer's name and the
--              product are read at send time, so an erased customer's name never waits here.
--   dedup_key  `link_request_stuck:<requestId>` on the alert a stuck request raises: one message per
--              request, whatever the kind's cooldown says, never repeated. NULL on every other alert;
--              a unique index allows any number of NULLs.
ALTER TABLE alerts ADD COLUMN detail TEXT;
ALTER TABLE alerts ADD COLUMN dedup_key TEXT;
CREATE UNIQUE INDEX alerts_dedup_key ON alerts (dedup_key);
-- The delivery check reads when a Zalo request's link job finished, every 5 seconds (D65).
CREATE INDEX bridge_jobs_request_kind_status ON bridge_jobs (request_id, kind, status);
