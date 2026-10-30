-- The Orders list's search over the order id (AD-4 owner: orders; AD-12, FR-26, FR-37; Story 4.13).
-- Staff search an order by its id, and the list contract searches stored search_text columns only
-- (list-defects root cause 7). An order id is network text of ASCII letters and digits, so its
-- folded search text (packages/core/text: lowercase, no diacritics, no spaces) is lower(order_id);
-- a generated column keeps it next to the id without any writer having to remember it. It is
-- virtual: never written, so it changes nothing for the paid-order triggers, and Drizzle does not
-- declare it (pragma table_info does not list generated columns). The customer's own search_text
-- is joined read-only by orders.list.ts.
ALTER TABLE orders ADD COLUMN search_text TEXT GENERATED ALWAYS AS (lower(order_id)) VIRTUAL;
