-- Visits to a share link (AD-4 owner: linking; AD-14, FR-6; Story 5.8). One row each time a person
-- opens `/s/<code>`: the live `link_clicks` evidence for "I clicked your link" and the
-- click-to-order rate. A preview bot and a HEAD request are not recorded. A row holds the code, its
-- request, the time and the kind of browser only (`browser`: a real browser; `in_app`: an app's own
-- browser, such as Zalo's; `buy`: a tap on the live page's buy button, imported from the live
-- system only); never an address, a full user agent or anything else about the person
-- (SECURITY_MODEL.md, NFR-6). The cutover imports the live rows.
CREATE TABLE link_clicks (
  click_id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_code TEXT NOT NULL REFERENCES share_codes (code),
  request_id TEXT NOT NULL REFERENCES link_requests (request_id),
  clicked_at TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (agent IN ('browser', 'in_app', 'buy'))
);
CREATE INDEX link_clicks_request_id ON link_clicks (request_id);
