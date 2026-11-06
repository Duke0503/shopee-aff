-- When the Shopee queue last met a captcha and when one was last cleared (AD-4 owner: linking; D69), so a
-- waiting `bridge_captcha` can be judged at send time. A later hold of any reason leaves them alone.
--   last_captcha_at     the moment of the latest captcha, written on every captcha hold
--   captcha_cleared_at  when a captcha was last cleared: the bridge saw the tab leave the verification
--                       page, or the owner's resume lifted a captcha hold
-- Nothing is backfilled: until the next captcha, a waiting alert is judged by its own raised_at.
ALTER TABLE link_queue_state ADD COLUMN last_captcha_at TEXT;
ALTER TABLE link_queue_state ADD COLUMN captcha_cleared_at TEXT;
