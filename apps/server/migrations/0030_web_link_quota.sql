-- The website's link quota per client (AD-4 owner: linking; AD-14, FR-2; Story 7.6 review).
-- `web_access` says how a website request was made: SESSION (a signed-in customer), CODE (a
-- signed-out visitor typing a customer code) or GUEST (no code, the HOUSE link). `web_client_key`
-- is the HMAC of the caller's address (platform/http/client-key.ts), never the address. A guest or
-- a typed code is counted per client, so one script cannot use up anyone else's links; only a
-- signed-in customer's own requests count against that customer's day. Chat requests leave both
-- empty. The index serves the hourly and daily counts.
ALTER TABLE link_requests ADD COLUMN web_access TEXT CHECK (web_access IN ('SESSION', 'CODE', 'GUEST'));
ALTER TABLE link_requests ADD COLUMN web_client_key TEXT CHECK (web_client_key IS NULL OR (length(web_client_key) = 32 AND web_client_key NOT GLOB '*[^0-9a-f]*'));
CREATE INDEX link_requests_web ON link_requests (channel, created_at);
