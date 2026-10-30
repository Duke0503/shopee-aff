-- The review queue's search (AD-4 owner: orders; AD-12, FR-14, FR-37; Story 4.15). Staff find a
-- case by the order id or the subject it carries (an order id, `#<fingerprint>` for a row without
-- one, or `payout:<id>` for a network payout). The list contract searches stored search_text
-- columns only (list-defects root cause 7); both values are ASCII network text, so their folded
-- search text (packages/core/text: lowercase, no diacritics, no spaces, fields joined by `|`) is
-- their lowercase form. A generated column keeps it beside them without any writer having to
-- remember it; virtual, so Drizzle does not declare it, as for orders.search_text (0016).
ALTER TABLE review_cases ADD COLUMN search_text TEXT GENERATED ALWAYS AS (lower(subject) || '|' || lower(coalesce(order_id, ''))) VIRTUAL;
