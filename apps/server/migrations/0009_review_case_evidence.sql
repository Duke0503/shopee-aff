-- Review case evidence (AD-4 owner: orders; AD-7, AD-8, D31, D43, D58; Story 3.5).
-- A case stays one per (network, subject, reason) while OPEN; a later run that sees the same
-- reason again refreshes its evidence instead of opening a second case. `fingerprint` is the
-- report row's fingerprint that last fed the case (NULL for a case no row opened, such as an
-- order not seen in the report for 14 days); `refreshed_at` is when that evidence last changed.
-- A case never changes money: it carries the row and the rules' candidates for staff (Story 3.9).

ALTER TABLE review_cases ADD COLUMN fingerprint TEXT CHECK (fingerprint IS NULL OR fingerprint != '');
ALTER TABLE review_cases ADD COLUMN refreshed_at TEXT;
