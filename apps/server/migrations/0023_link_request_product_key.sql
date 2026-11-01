-- The product a link request is for (AD-4 owner: linking; FR-5, D5, D6; Story 5.2), as
-- packages/core `readShopeeProduct` names it: `shopee:<shop>.<item>` for a link that names one
-- product, NULL for any other link (search, shop, short link, home page), which is never reused.
-- Every stored request, imported ones included, is keyed here with the same rule through the
-- ledger's SQL function `shopee_product_key`, so a repeat of a request made before this migration
-- still finds the customer's own link, and the guest account keeps one link per product.
ALTER TABLE link_requests ADD COLUMN product_key TEXT;
UPDATE link_requests SET product_key = shopee_product_key(source_url);
CREATE INDEX link_requests_reuse ON link_requests (product_key, customer_id);

-- How many times in a row the browser took this LINK job and went silent (Story 5.3 review
-- item 2): after two the submission counts as a failed attempt and backs off like any failure,
-- so a job that always silences the bridge never stays in front of everyone else.
ALTER TABLE bridge_jobs ADD COLUMN no_answers INTEGER NOT NULL DEFAULT 0 CHECK (no_answers >= 0);
