-- Representative live rows for the cutover import tests (Story 2.1, 2.2), applied on top of
-- live-schema.sql. Every person, id, phone and bank number here is fake.
-- Time values use the three forms the live writers produce (see apps/server/src/cutover/time-table.ts):
--   ISO +07:00 from repository.py now(), ISO +00:00 from accounts.py _stamp(), naive UTC from datetime('now').
-- Edge cases: a merged customer with an old Zalo id and a retired code as aliases, HOUSE, staff
-- without codes, an erased-like row with no personal fields and an unparseable created_at, bank
-- accounts with missing fields, codes with gaps (DP00002 retired, DP00004/6/8 never seen), an alias
-- whose customer row is gone, and a naive value in a column whose writers never wrote one.

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
