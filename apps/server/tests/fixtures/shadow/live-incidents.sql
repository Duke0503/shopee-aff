-- Live orders for the shadow run (Story 2.9), beside live-rows.sql. Each is one way the live
-- reconciliation and the new one disagree; the report files in this folder carry the network side.
INSERT INTO orders (order_id, customer_id, request_id, order_value, estimated_commission, approved_commission, cashback_amount, status, rejection_reason, recorded_at, approved_at, paid_at, updated_at, platform, notified_status, settlement_status, payout_batch_id, settled_at) VALUES
  ('261002KKKK0011', '1000000000000000001', NULL, 100000, 10000, 10000, 7128, 'approved', NULL, '2026-10-02T10:00:00+07:00', '2026-10-12T10:00:00+07:00', NULL, '2026-10-12T10:00:00+07:00', 'shopee', 'approved', 'unsettled', NULL, NULL),
  ('261003LLLL0012', '1000000000000000003', NULL, 100000, 5000, NULL, NULL, 'awaiting_approval', NULL, '2026-10-03T10:00:00+07:00', NULL, NULL, '2026-10-03T10:00:00+07:00', 'shopee', NULL, 'unsettled', NULL, NULL),
  ('261004MMMM0013', '1000000000000000005', NULL, 200000, 20000, 20000, 14256, 'approved', NULL, '2026-10-04T10:00:00+07:00', '2026-10-14T10:00:00+07:00', NULL, '2026-10-14T10:00:00+07:00', 'shopee', 'approved', 'unsettled', NULL, NULL),
  ('261005NNNN0014', '1000000000000000009', NULL, 200000, 6000, NULL, NULL, 'rejected', 'cancelled', '2026-10-05T10:00:00+07:00', NULL, NULL, '2026-10-06T10:00:00+07:00', 'shopee', 'rejected', 'unsettled', NULL, NULL),
  ('260601OOOO0015', '1000000000000000002', NULL, 80000, 4000, NULL, NULL, 'awaiting_approval', NULL, '2026-06-01T10:00:00+07:00', NULL, NULL, '2026-06-01T10:00:00+07:00', 'shopee', NULL, 'unsettled', NULL, NULL),
  ('261006PPPP0016', '1000000000000000001', NULL, 120000, 6000, NULL, NULL, 'awaiting_approval', NULL, '2026-10-06T10:00:00+07:00', NULL, NULL, '2026-10-06T10:00:00+07:00', 'shopee', NULL, 'unsettled', NULL, NULL),
  ('TT0000000000000017', '1000000000000000001', NULL, 300000, 15000, 15000, 10500, 'approved', NULL, '2026-10-08T10:00:00+07:00', '2026-10-15T10:00:00+07:00', NULL, '2026-10-15T10:00:00+07:00', 'tiktok', 'approved', 'unsettled', NULL, NULL),
  ('261020SSSS0022', '1000000000000000005', NULL, 90000, 4500, NULL, NULL, 'awaiting_approval', NULL, '2026-10-20T10:00:00+07:00', NULL, NULL, '2026-10-20T10:00:00+07:00', 'shopee', NULL, 'unsettled', NULL, NULL);

-- A held award on an awaiting order the report approves: HELD is never payable (bonus_owed reads confirmed only).
INSERT INTO campaign_awards (id, campaign_id, customer_id, order_id, amount, status, created_at, confirmed_at, paid_at, voided_at, notified_status) VALUES
  (20, 'trungthu2026', '1000000000000000003', '260913CCCC0003', 20000, 'held', '2026-09-20T09:05:00+07:00', NULL, NULL, NULL, 'held');
