-- Representative live rows for the cutover import tests (Stories 2.1 to 2.5), applied on top of
-- live-schema.sql. Every person, id, phone and bank number here is fake.
-- Time values use the three forms the live writers produce (see apps/server/src/cutover/time-table.ts):
--   ISO +07:00 from repository.py now(), ISO +00:00 from accounts.py _stamp(), naive UTC from datetime('now').
-- Edge cases: a merged customer with an old Zalo id and a retired code as aliases, HOUSE, staff
-- without codes, an erased-like row with no personal fields and an unparseable created_at, bank
-- accounts with missing fields, codes with gaps (DP00002 retired, DP00004/6/8 never seen), an alias
-- whose customer row is gone, and a naive value in a column whose writers never wrote one.
-- Live connections enforce foreign keys (repository.py:225), but a copy can hold rows written
-- before that, so the fixture writes a gone customer and a missing request with them off.

PRAGMA foreign_keys = OFF;

INSERT INTO customers (customer_id, zalo_user_id, private_chat_id, display_name, bank_name, bank_account, account_holder, consent_at, status, created_at, password_hash, password_set_at, failed_logins, locked_until, role, last_login_at, login_count, customer_code) VALUES
  ('1000000000000000001', '1000000000000000001', 'chat-a', 'Nguyễn Văn An', 'VCB', '0011 2233 4455', 'nguyen van an', '2026-09-01T10:00:00+07:00', 'active', '2026-08-01T09:00:00+07:00', 'pbkdf2_sha256$fake$hash-a', '2026-09-02T03:00:00+00:00', 0, NULL, 'user', '2026-10-01T01:02:03+00:00', 4, 'DP00001'),
  ('1000000000000000002', '1000000000000000002', 'chat-b', 'Trần Thị Bình', 'TPB', '1234-5678-90', 'TRẦN THỊ BÌNH', '2026-09-25T08:30:00+07:00', 'active', '2026-09-24 08:15:00', NULL, NULL, 0, NULL, 'user', NULL, 0, 'DP00003'),
  ('1000000000000000003', '1000000000000000003', NULL, 'Lê Hoàng Cường', NULL, '9988776655', NULL, NULL, 'active', '2026-10-02T04:00:00+00:00', NULL, NULL, 0, NULL, 'user', NULL, 0, 'DP00412'),
  ('1000000000000000004', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'disabled', 'không rõ', NULL, NULL, 0, NULL, 'user', NULL, 0, 'DP00007'),
  ('1000000000000000005', '1000000000000000005', 'chat-e', 'Phạm Minh Đức', 'MB', NULL, 'PHAM MINH DUC', NULL, 'active', '2026-10-05T20:00:00+07:00', 'pbkdf2_sha256$fake$hash-e', '2026-10-06T01:00:00+00:00', 5, '2026-10-30T05:15:00+00:00', 'user', '2026-10-29T23:59:59+00:00', 9, 'DP00005'),
  ('1000000000000000009', '1000000000000000009', NULL, 'Võ Thị Giang', NULL, NULL, NULL, NULL, 'active', '2026-10-10 02:00:00', NULL, NULL, 0, NULL, 'user', '2026-10-01 05:00:00', 1, 'DP00010'),
  ('HOUSE', NULL, NULL, 'Web guests (house)', NULL, NULL, NULL, NULL, 'active', '2026-09-20T11:00:00+07:00', NULL, NULL, 0, NULL, 'house', NULL, 0, NULL),
  ('admin', NULL, NULL, 'Quản trị', NULL, NULL, NULL, NULL, 'active', '2026-08-01T00:00:00+00:00', 'pbkdf2_sha256$fake$hash-admin', '2026-08-01T00:00:00+00:00', 0, NULL, 'admin', '2026-10-30T01:00:00+00:00', 50, NULL),
  ('nv01', NULL, NULL, 'Nhân viên một', NULL, NULL, NULL, NULL, 'disabled', '2026-08-02T00:00:00+00:00', 'pbkdf2_sha256$fake$hash-nv01', '2026-08-02T00:00:00+00:00', 0, NULL, 'employee', NULL, 0, NULL);

-- Merge of 2026-09-24 (merge.py:124-126): the old Zalo id and the retired code DP00002 point to the survivor.
INSERT INTO customer_aliases (alias, customer_id, created_at, note) VALUES
  ('9000000000000000002', '1000000000000000002', '2026-09-24T15:20:00+07:00', 'merged: Zalo account change'),
  ('DP00002', '1000000000000000002', '2026-09-24T15:20:00+07:00', 'merged: Zalo account change'),
  ('DP00009', 'ghost', '2026-09-24T15:21:00+07:00', 'merged: Zalo account change');

UPDATE customer_code_counter SET last = 412 WHERE id = 1;

-- Products (Story 2.5, D56). Rates are live percent floats; 3.333 has no whole basis point.
INSERT INTO products_cache (item_id, shop_id, name, price, price_formatted, shopee_rate, seller_rate, shopee_part, seller_part, total_commission, is_capped, cashback, rate_percent, affiliate_url, canonical_url, request_count, first_seen_at, updated_at, image_url) VALUES
  ('22001', '11001', 'Áo thun cotton nam', 159000, '159.000đ', 3.5, 2.0, 5565, 3180, 8745, 0, 6228, '80%', 'https://s.shopee.vn/AAA111', 'https://shopee.vn/product/11001/22001', 3, '2026-09-11T13:00:05+07:00', '2026-09-14T08:00:05+07:00', 'https://cf.shopee.vn/file/img-a'),
  ('22002', '11002', 'Tai nghe không dây', 499000, '499.000đ', 9.5, 0.0, 40000, 0, 40000, 1, 28485, '80%', 'https://s.shopee.vn/BBB222', 'https://shopee.vn/product/11002/22002', 1, '2026-09-12T10:00:05+07:00', '2026-09-12T10:00:05+07:00', NULL),
  ('22003', '11003', 'Bình nước giữ nhiệt', 210000, '210.000đ', 2.25, 3.333, 4725, 6999, 11724, 0, 8350, '80%', NULL, NULL, 1, '2026-10-29T09:00:05+07:00', '2026-10-29T09:00:05+07:00', 'https://cf.shopee.vn/file/img-c');

-- Link requests (Story 2.5). Request ids are a date plus five digits, as live. Edge cases: a stored
-- estimate (the snapshot source), a link not yet handed over (ISSUED, unsent), a request still
-- waiting for its link (QUEUED), a guest (HOUSE) request with a share code, a failed request the
-- customer was told about, an expired request that never got a link, an expired one handed over
-- with an unreadable estimate, a request whose customer is gone, and a TikTok request made under
-- the merged customer's old Zalo id with a malformed share code.
INSERT INTO link_requests (request_id, customer_id, created_at, source_url, affiliate_url, estimated_commission, channel, status, notified_at, platform, estimate_source, estimate_detail, attempts, share_code) VALUES
  ('26091100001', '1000000000000000001', '2026-09-11T13:00:00+07:00', 'https://shopee.vn/Ao-thun-cotton-i.11001.22001', 'https://s.shopee.vn/AAA111', 8745, 'direct', 'converted', '2026-09-11T13:00:20+07:00', 'shopee', 'bridge',
   '{"commission": 8745, "price": 159000, "total_rate": 5.5, "shopee_rate": 3.5, "seller_rate": 2.0, "shopee_part": 5565, "seller_part": 3180, "is_capped": false, "name": "Áo thun cotton nam", "source": "bridge", "image_url": "https://cf.shopee.vn/file/img-a-est", "item_id": "22001"}', 1, 'Ab3dE5gH'),
  ('26091200002', '1000000000000000002', '2026-09-12T10:00:00+07:00', 'https://shopee.vn/product/11002/22002', 'https://s.shopee.vn/BBB222', NULL, 'direct', 'pending', NULL, 'shopee', NULL, NULL, 1, 'Zx9Yw8Vu'),
  ('26102900003', '1000000000000000003', '2026-10-29T09:00:00+07:00', 'https://shopee.vn/Binh-nuoc-i.11003.22003', NULL, NULL, 'web', 'pending', NULL, 'shopee', NULL, NULL, 1, NULL),
  ('26091400004', 'HOUSE', '2026-09-14T08:00:00+07:00', 'https://shopee.vn/product/11001/22001', 'https://s.shopee.vn/CCC333', NULL, 'web', 'converted', NULL, 'shopee', NULL, NULL, 1, 'HoUsE123'),
  ('26091500005', '1000000000000000005', '2026-09-15T08:00:00+07:00', 'https://shopee.vn/x-i.11009.22009', NULL, NULL, 'direct', 'failed', '2026-09-15T08:30:00+07:00', 'shopee', NULL, NULL, 3, NULL),
  ('26081600006', '1000000000000000009', '2026-08-16T08:00:00+07:00', 'https://shopee.vn/product/11009/22009', NULL, NULL, 'direct', 'expired', NULL, 'shopee', NULL, NULL, 2, NULL),
  ('26081700007', '1000000000000000001', '2026-08-17T08:00:00+07:00', 'https://shopee.vn/product/11001/22001', 'https://s.shopee.vn/DDD444', NULL, 'direct', 'expired', '2026-08-17T08:00:30+07:00', 'shopee', 'bridge', 'not json{', 1, NULL),
  ('26091800008', 'ghost', '2026-09-18T08:00:00+07:00', 'https://shopee.vn/product/11002/22002', 'https://s.shopee.vn/EEE555', NULL, 'direct', 'pending', NULL, 'shopee', NULL, NULL, 1, 'GhOsT001'),
  ('26091900009', '9000000000000000002', '2026-09-19T09:59:00+07:00', 'https://vt.tiktok.com/ZS1234/', 'https://go.isclix.com/deep/abc', NULL, 'direct', 'pending', '2026-09-19T10:00:00+07:00', 'tiktok', NULL, NULL, 1, 'bad-code');

-- Orders (Story 2.3). Amounts are whole dong as live stored them. Edge cases: a paid order whose
-- stored cashback (6232) differs from the FR-13 split (6228) and whose paid_at is naive UTC from
-- dashboard.py; an approved order under the old Zalo id told only "recorded"; an awaiting order
-- whose recorded_at was synthesized from its SN prefix, on a request that does not exist; a guest
-- (HOUSE) order with a stored cashback; a rejected order; a status no rule knows; a paid TikTok
-- order paid in advance with no cashback stored; an order of a gone customer on an unknown
-- platform; a paid order with an unreadable paid_at told only "approved"; a paid order told "paid".
INSERT INTO orders (order_id, customer_id, request_id, order_value, estimated_commission, approved_commission, cashback_amount, status, rejection_reason, recorded_at, approved_at, paid_at, updated_at, platform, notified_status, settlement_status, payout_batch_id, settled_at) VALUES
  ('260911AAAA0001', '1000000000000000001', '26091100001', 159000, 8745, 8745, 6232, 'paid', NULL, '2026-09-11T13:11:31+07:00', '2026-10-01T10:00:00+07:00', '2026-10-05 03:00:00', '2026-10-05 03:00:00', 'shopee', 'paid', 'settled', 'B202610', '2026-10-20T09:00:00+07:00'),
  ('260912BBBB0002', '9000000000000000002', '26091200002', 400000, 20000, 20000, 14243, 'approved', NULL, '2026-09-12T10:30:00+07:00', '2026-10-02T09:00:00+07:00', NULL, '2026-10-02T09:00:00+07:00', 'shopee', 'awaiting_approval', 'unsettled', NULL, NULL),
  ('260913CCCC0003', '1000000000000000003', 'nope0000001', 100000, 5000, NULL, NULL, 'awaiting_approval', NULL, '2026-09-13T00:00:00+07:00', NULL, NULL, '2026-09-13T08:00:00+07:00', 'shopee', NULL, 'unsettled', NULL, NULL),
  ('260914DDDD0004', 'HOUSE', '26091400004', 240000, 12000, 12000, 3000, 'approved', NULL, '2026-09-14T08:10:00+07:00', '2026-09-20T10:00:00+07:00', NULL, '2026-09-20T10:00:00+07:00', 'shopee', NULL, 'unsettled', NULL, NULL),
  ('260915EEEE0005', '1000000000000000005', NULL, 99000, 3000, NULL, NULL, 'rejected', 'Đơn bị huỷ', '2026-09-15T09:00:00+07:00', NULL, NULL, '2026-09-25T09:00:00+07:00', 'shopee', 'rejected', 'unsettled', NULL, NULL),
  ('260916FFFF0006', '1000000000000000001', NULL, 50000, 1500, NULL, NULL, 'weird_status', NULL, '2026-09-16T09:00:00+07:00', NULL, NULL, '2026-09-16T09:00:00+07:00', 'shopee', NULL, 'unsettled', NULL, NULL),
  ('TT0000000000000007', '1000000000000000001', NULL, 300000, 15000, NULL, NULL, 'paid', NULL, '2026-09-17T09:00:00+07:00', NULL, '2026-10-06T09:00:00+07:00', '2026-10-06T09:00:00+07:00', 'tiktok', 'paid', 'unsettled', NULL, NULL),
  ('260918HHHH0008', 'ghost', NULL, 70000, 2000, NULL, NULL, 'awaiting_approval', NULL, '2026-09-18T09:00:00+07:00', NULL, NULL, '2026-09-18T09:00:00+07:00', 'grab', NULL, 'unsettled', NULL, NULL),
  ('260919IIII0009', '1000000000000000002', NULL, 280000, 14045, 14045, 10000, 'paid', NULL, '2026-09-19T09:00:00+07:00', '2026-10-03T09:00:00+07:00', 'không rõ', '2026-10-07T09:00:00+07:00', 'shopee', 'approved', 'unsettled', NULL, NULL),
  ('261001JJJJ0010', '1000000000000000009', NULL, 200000, 9829, 9829, 7000, 'paid', NULL, '2026-10-01T09:00:00+07:00', '2026-10-04T09:00:00+07:00', '2026-10-08T09:00:00+07:00', '2026-10-08T09:00:00+07:00', 'shopee', 'paid', 'unsettled', NULL, NULL);

-- Live order history (repository.py:853-863); the import keeps it in the live copy and writes one
-- cutover row per order instead (Story 2.3 AC4).
INSERT INTO state_history (order_id, from_status, to_status, changed_at, note) VALUES
  ('260911AAAA0001', NULL, 'awaiting_approval', '2026-09-11T13:15:00+07:00', 'recorded by Shopee'),
  ('260911AAAA0001', 'awaiting_approval', 'approved', '2026-10-01T10:00:00+07:00', 'approved commission 8745 VND -> cashback 6232 VND'),
  ('260911AAAA0001', 'approved', 'paid', '2026-10-05T10:00:00+07:00', 'transferred');

-- Campaigns and awards (Story 2.4). Windows are staff-typed Vietnam time from a datetime-local
-- input (CampaignsView.tsx:510). Edge cases: a campaign staff stopped; a paid award told "held";
-- a held award on the FROZEN order (suspended, D55); a lost slot told "void"; a confirmed award
-- under the merged customer's old Zalo id never told; an award of a gone customer; a guest award.
INSERT INTO campaigns (campaign_id, name, starts_at, ends_at, slots, bonus_vnd, min_order_value, platforms, excluded_customers, per_customer, status, created_at) VALUES
  ('trungthu2026', 'Trung thu 2026', '2026-09-15T00:00', '2026-10-01T00:00', 20, 20000, 0, 'shopee,shopeefood,tiktok', '', 0, 'active', '2026-09-14T10:00:00+07:00'),
  ('flash2026', 'Flash sale', '2026-10-20 00:00', '2026-10-27 00:00', 5, 10000, 100000, 'shopee', 'nv01', 1, 'stopped', '2026-10-19T10:00:00+07:00');

INSERT INTO campaign_awards (id, campaign_id, customer_id, order_id, amount, status, created_at, confirmed_at, paid_at, voided_at, notified_status) VALUES
  (1, 'trungthu2026', '1000000000000000002', '260919IIII0009', 20000, 'paid', '2026-09-19T09:05:00+07:00', '2026-10-03T09:05:00+07:00', '2026-10-07 02:00:00', NULL, 'held'),
  (2, 'trungthu2026', '1000000000000000001', '260916FFFF0006', 20000, 'held', '2026-09-16T09:05:00+07:00', NULL, NULL, NULL, 'held'),
  (3, 'trungthu2026', '1000000000000000009', '261001JJJJ0010', 20000, 'void', '2026-10-01T09:05:00+07:00', NULL, NULL, '2026-10-02T09:00:00+07:00', 'void'),
  (4, 'trungthu2026', '9000000000000000002', '260912BBBB0002', 20000, 'confirmed', '2026-09-12T10:35:00+07:00', '2026-10-02T09:05:00+07:00', NULL, NULL, NULL),
  (5, 'trungthu2026', 'ghost', '260918HHHH0008', 20000, 'held', '2026-09-18T09:05:00+07:00', NULL, NULL, NULL, NULL),
  (6, 'trungthu2026', 'HOUSE', '260914DDDD0004', 20000, 'held', '2026-09-14T08:15:00+07:00', NULL, NULL, NULL, NULL);

-- Payment transfers (Story 2.4), as the two live admin screens wrote them (dashboard.py:2565,
-- 2878): created_at naive UTC, bill tokens of 32 URL-safe characters. Edge cases: a transfer
-- naming an order that does not exist; one under the merged customer's old Zalo id paying an
-- order with its campaign bonus, never told; one from the confirm screen that named no order.
INSERT INTO payment_transfers (id, customer_id, amount, transfer_code, note, proof_image, order_ids, notify_mode, notified_at, target_group, created_at, created_by, bill_token) VALUES
  (1, '1000000000000000001', 6232, 'DP00001', 'Chuyển khoản tháng 10', 'https://drive.google.com/file/d/fakeproof1/view', '260911AAAA0001,NOPE00000001', 'both', '2026-10-05 03:00:05', 'main', '2026-10-05 03:00:05', 'admin', 'Rk3vQ9xZtYw2mN8pL4sH6dF1gJ0aBcDe'),
  (2, '9000000000000000002', 30000, NULL, NULL, NULL, '260919IIII0009', NULL, NULL, NULL, '2026-10-07 02:00:00', 'nv01', 'Zq8wE7rT6yU5iO4p-3sD2fG1hJ0kL9m_'),
  (3, '1000000000000000009', 7000, 'DP00010', NULL, NULL, '', 'none', '2026-10-08 02:00:00', 'test', '2026-10-08 02:00:00', 'admin', 'Mn0bV9cX8zL7kJ6hG5fD4sA3qW2eR1tY');
