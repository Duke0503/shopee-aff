-- Erasing a customer's personal data (AD-4 owner: identity; AD-17, AD-23, D13, D26, FR-35, NFR-6;
-- Story 4.16). The record stays under its permanent customer id with status ERASED, so its orders,
-- payouts, ledger entries and audit entries keep pointing at it, and its old links still attribute
-- to it (cashback 0, no message). `erased_at` is when the personal data was removed, shown on the
-- customer page; it is set once and never changes, and an erased record never becomes live again.
ALTER TABLE customers ADD COLUMN erased_at TEXT;
CREATE TRIGGER customers_erased_stays_erased BEFORE UPDATE OF status, erased_at ON customers
WHEN OLD.status = 'ERASED' AND (NEW.status IS NOT 'ERASED' OR NEW.erased_at IS NOT OLD.erased_at)
BEGIN SELECT RAISE(ABORT, 'an erased customer stays erased'); END;
-- A merged record lives on only as an alias of its survivor (Story 4.19): it never becomes live again.
CREATE TRIGGER customers_merged_stays_merged BEFORE UPDATE OF status ON customers
WHEN OLD.status = 'MERGED' AND NEW.status IN ('ACTIVE', 'DISABLED')
BEGIN SELECT RAISE(ABORT, 'a merged customer stays merged'); END;
