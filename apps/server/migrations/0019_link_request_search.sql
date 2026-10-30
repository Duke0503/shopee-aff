-- Searching an order by its product (AD-4 owner: linking; AD-12, D56; Story 4.13). The Orders list
-- searches stored search_text columns only (list-defects root cause 7), and a product name is
-- Vietnamese text that only packages/core/text folds, so the link request keeps the folded text of
-- its product snapshot, written by every command that writes the snapshot (the cutover import
-- today; link creation in Epic 5 must do the same).
ALTER TABLE link_requests ADD COLUMN search_text TEXT NOT NULL DEFAULT '';
