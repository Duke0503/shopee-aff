-- The staff role an audit entry was written under (AD-17, FR-24, Story 4.2 review item 9): a staff
-- entry records whether an admin or an employee acted; every other actor kind has none. Entries
-- written before this migration keep NULL. audit_entries stays insert-only: its update and delete
-- triggers from 0005 cover the new column too.
ALTER TABLE audit_entries ADD COLUMN actor_role TEXT CHECK (actor_role IS NULL OR (actor_kind = 'staff' AND actor_role IN ('ADMIN', 'EMPLOYEE')));
