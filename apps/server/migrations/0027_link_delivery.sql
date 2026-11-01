-- How a made link is handed over once (AD-4 owner: linking; AD-14, AD-16, FR-4; Story 6.5).
-- `delivery_claimed_until`: the chat reply claimed the link and has until then to confirm it was
-- sent; a claim not confirmed in time lapses and the delivery check sends the link by
-- notification. `delivery_attempt`: which notification key the link goes under; it grows only when
-- an earlier notification could not deliver it (recorded while quiet, or dropped), so a link is
-- never lost under a key that will not be sent.
ALTER TABLE link_requests ADD COLUMN delivery_claimed_until TEXT;
ALTER TABLE link_requests ADD COLUMN delivery_attempt INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempt >= 0);
CREATE INDEX link_requests_issued ON link_requests (created_at) WHERE status = 'ISSUED';
