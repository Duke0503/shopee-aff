-- The 72-hour no-payout window after the cutover (AD-4 owner: payouts; AD-24, D40; Story 8.8).
-- While `window_ends_at` is set, payout confirm is refused, so nothing is paid twice while a
-- rollback to the live system is still possible. The cutover import opens it; the owner closes it
-- by command once the window has ended. Every change is audited.
CREATE TABLE payout_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  window_ends_at TEXT,
  changed_at TEXT,
  changed_by TEXT
);
INSERT INTO payout_settings (id) VALUES (1);
