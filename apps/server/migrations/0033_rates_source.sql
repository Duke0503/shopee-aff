-- Where a product's rates came from (AD-4 owner: linking; Story 5.6, owner decision 2026-11-02).
-- The third party (addlivetag) is asked first and the Shopee pages through the bridge second, as
-- the live system did since 17 Oct 2026 (its link_requests.estimate_source 'third_party' or
-- 'shopee'). `estimate_source` is the source of the request's snapshot rates, `rates_source` that
-- of the shared product facts; both stay empty while no rate is known, and for imported rows.
ALTER TABLE link_requests ADD COLUMN estimate_source TEXT CHECK (estimate_source IN ('third_party', 'shopee'));
ALTER TABLE product_offers ADD COLUMN rates_source TEXT CHECK (rates_source IN ('third_party', 'shopee'));
