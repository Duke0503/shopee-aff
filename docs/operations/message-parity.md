# Message parity with the live system

Owner requirement (2026-11-02, overrides earlier copy decisions): every customer Zalo message and
every owner Telegram alert reads and looks exactly like the live system's: same words, line
breaks, emoji, bold parts and refusals. This page maps every new label to its old source.

## Sources

- `zalo_assistant/assistant_worker.js`, `config.js`, `friends.js` on `main`: the chat replies,
  the group welcome, the commands, the refusals, and the bold parts (`styles` with `st: "b"`, the
  only style the live bot used).
- `resources/messages.vi.json` and `src/cashback/messaging/notifications.py`: the backend's notices
  (`/donhang`, order recorded, approved, rejected, failed link), sent as plain text.
- `src/cashback/web/dashboard.py` 3037-3064: the payout message.
- `src/cashback/core/telegram_alerts.py` `report_bug`: the owner's Telegram alerts (HTML).

## How the look is kept

- Labels mark bold with `**...**` (`apps/assistant/src/styled-text.ts`). The markup is read before
  placeholders are filled, so a product or person name never toggles bold. Ranges are UTF-16 offsets,
  as zca-js and the live bot (`indexOf`, `.length`) count them. A group reply's `@Name` line is a
  mention, and the bold ranges move past it.
- The session port's `sendText` takes `styles`; the zca-js adapter passes them in both chats beside
  the mentions. The relay adapter sends plain text: the live `/api/broadcast` reads no styles.
- The live bot bolded the first occurrence of each target (all occurrences in the group welcome); the
  labels mark exactly those runs. Overlapping live ranges are merged into one run (same look).
- Telegram: `parse_mode: HTML`, the live header by severity (`🚨🔴 [BUG CRITICAL - KHẨN CẤP]`,
  `⚠️🟠 [BUG HIGH - QUAN TRỌNG]`, `⚠️🟡 [CẢNH BÁO HỆ THỐNG - WARNING]`), source, time
  `HH:MM:SS - DD/MM/YYYY` (Vietnam time, when the alert was raised), details and action, every text
  HTML-escaped. A repeat count adds one line in the same format (new-only).

## Tests

- `apps/assistant/tests/fixtures/old-messages.json` is generated from the live code itself (37 cases:
  link replies, refusals, commands, `/donhang`, notices, payout, the 3 group welcomes with 1-3
  members). `apps/assistant/tests/message-parity.test.ts` renders each from the same facts: same
  string, same bold code units, same mentions.
- `apps/server/tests/fixtures/old-telegram-alerts.json` is rendered by the live `telegram_alerts.py`
  at a fixed time; `owner-alerts.test.ts` checks the new text is the same string.
- `apps/server/tests/fixtures/old-telegram-order-notices.json` is rendered the same way from the
  live order notices; `order-business-notices.test.ts` checks the new text is the same string.

## Deliberate differences and gaps (owner to confirm)

1. `notice_order_recorded`: the live text read "khoảng khoảng 30–70 ngày" (template `khoảng {days}`
   with a window that already starts with "khoảng"). The doubled word is removed.
2. `payout_recorded`: the live line "👤 User: @<name>" and the campaign breakdown are not sent.
3. Account numbers are shown as `···1234` (the live bot showed the full number in the private chat)
   and the holder line is dropped: SECURITY_MODEL forbids the number, the server does not send the holder.
4. `/matkhau`: the live assistant sent the bare password only. The label is the older bot's
   `password_issued` message. Say if the bare password is wanted.
5. Live texts kept word for word that break D11 or money rule 11 (80% without an amount, "30 - 70
   ngày"): `welcome`, `group_welcome_1..3`, `link_ready_no_estimate`, `link_ready_shopeefood`,
   `link_network_unsupported`, `command_id`, `command_help`, `command_policy`. They are listed as
   exceptions in `apps/assistant/tests/order-notifications.test.ts`.
6. `/web`, `/chinhsach` and `/ping` are answered again with the live texts. `/topdeal`, the voucher
   commands and the "unknown command" reply are not. `/help` (live) does not list `/donhang`.
7. Not sent because the new facts lack them: the campaign hint under a link, the ShopeeFood
   group-order tip, the product/link block in order notices, the balance total in the approved
   notice. Old natural-language bank messages ("STK: ...") are not read, so their instructions are dropped.
8. Telegram: the live new-member notice of the business group has no counterpart in the new platform.
   The four order notices are back (D62), see "Telegram order notices" below.

## Server facts added for the old formats

Additive contract fields: the link reply's commission parts and cap; `/sodu`'s customer code and
payout account (bank, last four, held); each `/donhang` order's amount, record time and "today", and
today's total; the recorded notice's estimated cashback (`estimate`); the payout notice's total paid
(`totalPaid`) and time (`paidAt`). A payout queued before this change is sent without those two lines.

## Mapping
Counts (messages.json, 98 keys): 12 adapted, 45 identical, 34 new-only, 7 not-zalo.

| Key | Status | Old source | Note |
|---|---|---|---|
| `friend_request_greeting` | identical | resources/messages.vi.json `friend_request`; zalo_assistant/assistant_worker.js:169-175 |  |
| `welcome` | adapted | zalo_assistant/config.js:114-122 (PRIVATE_WELCOME_TEMPLATES[0]) | A line with the customer code added (the live bot had no first-message welcome; ENABLE_PRIVATE_WELCOME was off). `{name}` is the Zalo name, `Bạn` without one. |
| `group_welcome_1` | identical | zalo_assistant/config.js:108 + assistant_worker.js:299-366 | Bold on every occurrence of the live boldTargets. Tags `@A, @B & @C` with mentions. |
| `group_welcome_2` | identical | zalo_assistant/config.js:109 + assistant_worker.js:299-366 | As above. |
| `group_welcome_3` | identical | zalo_assistant/config.js:110 + assistant_worker.js:299-366 | As above; one of the three is picked at random, as live. |
| `member_fallback_name` | identical | assistant_worker.js:319 |  |
| `group_default_name` | identical | assistant_worker.js:279 (getGroupName) | The Dev group was named `Dev Internal DP` live; the new assistant names every group `Hoàn Tiền Shopee`. |
| `sender_fallback_name` | identical | assistant_worker.js:911 |  |
| `link_ready` | identical | assistant_worker.js:749-810 | Shopee with figures. The server now sends the commission parts (Shopee rate and part, shop XTRA rate and part, cap). Bold as live. The price is not shown (the live reply did not show it). The campaign hint (live 825-853) is not sent: the new reply facts carry no campaign offer. |
| `link_ready_no_estimate` | identical | assistant_worker.js:811-822 | TikTok Shop and Shopee without figures. TikTok Shop always takes this branch now: the new server has no AccessTrade figures for a reply. |
| `link_ready_shopeefood` | identical | assistant_worker.js:723-748 | The group-order tip (live 736-738) is not sent: the new facts do not say whether it is a group order. |
| `link_product_line` | identical | assistant_worker.js:804 (formatShortTitle, 60 characters) | Fragment. |
| `link_store_line` | identical | assistant_worker.js:731 | Fragment; the generic names are filtered as live. |
| `link_commission_line_shopee` | identical | assistant_worker.js:769-776 | Fragment. |
| `link_commission_line_seller` | identical | assistant_worker.js:777-781 | Fragment. |
| `link_commission_line_pending` | identical | assistant_worker.js:787 | Fragment; used when an older server sent no parts. |
| `link_commission_cap_note` | identical | assistant_worker.js:770-772 | Fragment. |
| `platform_shopee` | identical | assistant_worker.js:588 | Fragment. |
| `platform_accesstrade` | identical | assistant_worker.js:588 | Fragment (TikTok Shop). |
| `shopeefood_generic_store` | identical | assistant_worker.js:727 | Fragment (a name that is not shown). |
| `link_on_its_way` | identical | resources/messages.vi.json `received` | The live assistant waited 52 s and then sent its busy message; the new one says the link follows by message, in the old bot's `received` words. |
| `link_network_unsupported` | identical | assistant_worker.js:580-584 |  |
| `link_not_in_affiliate` | identical | assistant_worker.js:606-612 (platformLabel TikTok Shop) | The only network that reports it. |
| `link_failed` | identical | resources `link_failed`, sent by notifications.py:545-546 |  |
| `link_url_too_long` | new-only |  |  |
| `link_tiktok_unavailable` | new-only |  |  |
| `link_customer_disabled` | new-only |  |  |
| `link_contact_admin` | new-only |  |  |
| `link_day_full` | new-only |  |  |
| `link_try_later` | new-only |  | Not sent by the assistant today; kept for the server's refusal set. |
| `send_a_link` | adapted | resources `not_a_link` | The live text promoted this very assistant and listed /coche /dieukien /nganhang, which do not exist here: that paragraph is dropped and the last line names /huongdan /chinhsach /web. The live assistant itself stayed silent on text without a link or command. |
| `command_id` | identical | assistant_worker.js:1305-1315 |  |
| `command_id_from_group` | identical | assistant_worker.js:1279-1289 | Sent privately after /id in the group, as live. |
| `command_password_from_group` | identical | assistant_worker.js:1266-1271 | Sent privately after /matkhau in the group, as live. |
| `command_balance` | identical | assistant_worker.js:1350-1365 | The server now sends the customer code and the payout account (bank and last four). |
| `balance_line_payable` | identical | assistant_worker.js:1359 | Fragment. |
| `balance_line_payable_deducted` | new-only |  | The live line with the clawback deduction added. |
| `balance_line_owed` | new-only |  |  |
| `balance_bank_set` | identical | assistant_worker.js:1352-1353 | Fragment. |
| `balance_bank_held` | new-only |  | An account saved on the website waits for /stk xacnhan (Story 7.5). |
| `balance_bank_none` | identical | assistant_worker.js:1354 | Fragment. |
| `command_orders_today` | identical | notifications.py:625-638 with resources orders_today_header, orders_today_total, orders_link_footer | The server now sends each order's amount, record time and whether it is today's, and today's total. |
| `command_orders_recent` | identical | notifications.py:639-650 with resources orders_no_orders_today, orders_recent_header | At most five, as live. |
| `command_orders_none` | identical | notifications.py:588-593 |  |
| `command_orders_line_today` | identical | resources `order_item_today` | Campaign lines (live _with_campaign) are not sent. |
| `command_orders_line_recent` | identical | resources `order_item_recent` |  |
| `command_bank_saved` | adapted | assistant_worker.js:1110-1126 | The number is shown as ···last four (the live bot showed it in full in the private chat; SECURITY_MODEL forbids it) and the holder line is dropped (the server does not send the holder). |
| `command_bank_held` | new-only |  |  |
| `command_bank_none` | adapted | assistant_worker.js:1127-1143 | The "or write it naturally (STK: ...)" part is dropped: the new assistant reads /stk and quoted replies only. |
| `bank_unnamed` | identical | dashboard.py:3022 (`bank_name or "Ngân hàng"`) | Fragment. |
| `command_private_only` | identical | assistant_worker.js:1225-1261 | Also used for /stk in the group (live answered /stk there with the masked account). |
| `command_orders_private_only` | identical | resources `orders_in_group`; assistant_worker.js:1211-1223 |  |
| `command_not_registered` | new-only |  |  |
| `command_contact_admin` | new-only |  |  |
| `command_help` | identical | assistant_worker.js:1400-1464 | Lists /chinhsach and /web, which are answered again (below). It never listed /donhang or /help. |
| `command_password` | adapted | resources `password_issued` | The live assistant (assistant_worker.js:1330-1332) sent the bare password and nothing else; this is the older bot's password message from resources, which also gives the login code and says other sign-ins end. Owner to choose. |
| `command_web` | identical | assistant_worker.js:1577-1609 | Answered again (it had no reply in the new assistant). |
| `command_policy` | identical | assistant_worker.js:1610-1657 | Answered again for /chinhsach. Names "30 - 70 ngày" and 80% without an amount (D11 and money rule 11 exception, owner requirement). |
| `command_ping` | identical | assistant_worker.js:1396-1399 | Answered again; names the main group. |
| `bank_saved` | adapted | assistant_worker.js:1077-1105 | Number as ···last four, holder line dropped (as command_bank_saved). |
| `bank_changed` | new-only |  |  |
| `bank_choose` | new-only |  |  |
| `bank_choice_line` | new-only |  | Fragment. |
| `bank_rule_format` | adapted | assistant_worker.js:1190-1201 | The "or send STK: ..." form is dropped. |
| `bank_rule_number` | new-only |  |  |
| `bank_rule_holder` | new-only |  |  |
| `bank_rule_bank` | new-only |  |  |
| `bank_changed_website` | new-only |  |  |
| `bank_erased` | new-only |  |  |
| `bank_confirmed` | new-only |  |  |
| `bank_confirm_mismatch` | new-only |  |  |
| `merge_claim_noted` | new-only |  |  |
| `notice_order_recorded` | adapted | notifications.py:430-440, resources `order_recorded` | Live rendered "khoảng khoảng 30–70 ngày" (the template says khoảng {days} and payout_window starts with khoảng): the doubled word is removed. The product/link block ({identity}) is not sent: the notice has no product facts. The estimate now comes from the server (`estimate`), else "sẽ tính khi sàn duyệt đơn" as live. |
| `notice_order_approved` | adapted | notifications.py:450-482, resources `order_approved` + `payout_note_ready` | The note drops "Tổng bạn đang có" and the account line: the notice carries neither. |
| `notice_order_approved_add_bank` | adapted | resources `order_approved` + `payout_note_ready_need_bank` | Total dropped; "gửi STK: <ngân hàng> - ..." became the /stk form the new assistant reads. |
| `notice_order_approved_bank_held` | new-only |  | The live approved message with a new note. |
| `notice_order_rejected` | identical | notifications.py:483-486, resources `order_rejected` | Also sent for a reversal, as live. The reason is now the reason code in words (rejection_reason_*). |
| `notice_order` | new-only |  | Fallback for a legacy queued row of another status. |
| `cashback_unknown` | identical | resources `cashback_unknown` | Fragment. |
| `payout_recorded` | adapted | dashboard.py:3037-3064 | The last line "👤 User: @<name>" is dropped (a notification carries no name) and so is the campaign breakdown. The server now sends the total paid and the time. |
| `payout_recorded_basic` | adapted | dashboard.py:3037-3064 | For payouts queued before this change: without total and date. |
| `payout_voided` | new-only |  |  |
| `clawback_opened` | new-only |  | Unchanged new text: docs/operations/status-flows.md quotes it. |
| `clawback_commission_dropped` | new-only |  | Unchanged new text. |
| `amount_dong` | identical | notifications.py:107-116 (`_vnd`), assistant_worker.js:1351 | Fragment: 1.234.567đ. |
| `value_missing` | new-only |  | Fragment: a dash where a value is missing. |
| `order_recorded` | not-zalo |  | Status sentence for the website (status registry); no longer sent in Zalo. |
| `order_frozen` | not-zalo |  | As above. |
| `order_approved` | not-zalo |  | As above. |
| `order_reversed` | not-zalo |  | As above. |
| `order_paid` | not-zalo |  | As above (used only for a legacy queued row). |
| `order_rejected` | not-zalo |  | As above. |
| `link_shopeefood_per_shop` | not-zalo |  | Server key for the share page; the chat sends link_ready_shopeefood. |
| `rejection_reason_order_cancelled` | new-only |  | Fragment: the reason in the rejected notice. |
| `rejection_reason_all_items_cancelled` | new-only |  | Fragment. |
| `rejection_reason_commission_zero` | new-only |  | Fragment. |
| `rejection_reason_not_eligible` | new-only |  | Fragment. |
| `rejection_reason_other` | new-only |  | Fragment. |

### New-only texts (owner review)

- `link_url_too_long`: ⚠️ Link bạn gửi quá dài nên hệ thống chưa đọc được.<br><br>👉 Bạn hãy gửi link sản phẩm Shopee hoặc TikTok Shop ngắn hơn (bấm Chia sẻ → Sao chép link) giúp mình nhé!
- `link_tiktok_unavailable`: ⚠️ Hiện tại hệ thống tạm thời chưa tạo được link hoàn tiền TikTok Shop.<br><br>👉 Bạn hãy gửi link sản phẩm Shopee giúp mình, hoặc thử lại TikTok Shop sau nhé!
- `link_customer_disabled`: ⚠️ Tài khoản của bạn đang tạm khoá nên hệ thống chưa tạo được link hoàn tiền.<br><br>👉 Bạn nhắn chủ nhóm giúp mình nhé!
- `link_contact_admin`: ⚠️ Tài khoản của bạn chưa tạo được link hoàn tiền.<br><br>👉 Bạn nhắn chủ nhóm giúp mình nhé!
- `link_day_full`: ⚠️ Hôm nay hệ thống đã nhận quá nhiều yêu cầu tạo link.<br><br>👉 Bạn gửi lại link này vào ngày mai giúp mình nhé!
- `link_try_later`: ⚠️ Hệ thống chưa nhận được link này.<br><br>👉 Bạn gửi lại sau ít phút giúp mình nhé!
- `balance_line_payable_deducted`: 💵 Đã tích lũy sẵn sàng nhận: {payable} (đã trừ {deducted} của đơn bị sàn hủy sau khi đã chuyển tiền)
- `balance_line_owed`: ➖ Còn trừ vào lần chuyển sau: {owed}<br>
- `balance_bank_held`: ⏳ STK ({bank} - ···{lastFour}) đang chờ bạn xác nhận (Nhắn /stk xacnhan {lastFour} để xác nhận nhé)
- `command_bank_held`: 🏦 THÔNG TIN TÀI KHOẢN NGÂN HÀNG CỦA BẠN<br><br>👤 Khách hàng: {name}<br>🏦 Ngân hàng: {bank}<br>🔢 Số tài khoản: ···{lastFour}<br><br>⏳ Tài khoản này đang chờ bạn xác nhận nên chưa dùng để chuyển tiền.<br>👉 Để xác nhận, bạn nhắn mình: /stk xacnhan {lastFour}
- `command_not_registered`: ⚠️ Bạn chưa có Mã Khách Hàng.<br><br>👉 Bạn hãy bấm vào ảnh đại diện của mình và **NHẮN TIN RIÊNG** (inbox 1-1) cho mình một tin bất kỳ để nhận Mã Khách Hàng nhé!
- `command_contact_admin`: ⚠️ Tài khoản của bạn chưa có Mã Khách Hàng.<br><br>👉 Bạn nhắn chủ nhóm giúp mình nhé!
- `bank_changed`: ⚠️ TÀI KHOẢN NHẬN TIỀN VỪA ĐƯỢC THAY ĐỔI<br><br>🏦 Ngân hàng: {bank}<br>🔢 Số tài khoản: ···{lastFour}<br><br>Nếu không phải bạn đổi, bạn báo chủ nhóm ngay nhé!
- `bank_choose`: ⚠️ Tên ngân hàng bạn gửi khớp với nhiều ngân hàng:<br>{banks}<br><br>👉 Bạn gửi lại theo cú pháp, ghi đúng một tên ở trên:<br>/stk <Số_tài_khoản> <Tên_ngân_hàng> <Tên_chủ_tài_khoản>
- `bank_choice_line`: • {bank}
- `bank_rule_number`: ⚠️ SỐ TÀI KHOẢN CHƯA ĐÚNG<br><br>Số tài khoản phải có từ 4 đến 30 chữ cái hoặc chữ số (khoảng trắng và dấu gạch ngang được bỏ qua). Bạn kiểm tra rồi gửi lại theo cú pháp:<br>👉 /stk <Số_tài_khoản> <Tên_ngân_hàng> <Tên_chủ_tài_khoản><br><br>Ví dụ: /stk 0123456789 MB NGUYEN VAN A
- `bank_rule_holder`: ⚠️ TÊN CHỦ TÀI KHOẢN CHƯA ĐÚNG<br><br>Tên chủ tài khoản chỉ gồm chữ cái, ghi đúng như ngân hàng in trên thẻ. Bạn gửi lại theo cú pháp:<br>👉 /stk <Số_tài_khoản> <Tên_ngân_hàng> <Tên_chủ_tài_khoản><br><br>Ví dụ: /stk 0123456789 MB NGUYEN VAN A
- `bank_rule_bank`: ⚠️ KHÔNG TÌM THẤY NGÂN HÀNG<br><br>Bạn ghi tên ngân hàng như Vietcombank, MB, Techcombank rồi gửi lại theo cú pháp:<br>👉 /stk <Số_tài_khoản> <Tên_ngân_hàng> <Tên_chủ_tài_khoản><br><br>Ví dụ: /stk 0123456789 MB NGUYEN VAN A
- `bank_changed_website`: ⚠️ TÀI KHOẢN NHẬN TIỀN VỪA ĐƯỢC ĐỔI TRÊN WEBSITE<br><br>🏦 Ngân hàng: {bank}<br>🔢 Số tài khoản: ···{lastFour}<br><br>Mình chỉ chuyển tiền vào tài khoản này sau khi bạn xác nhận.<br>👉 Để xác nhận, bạn nhắn mình: /stk xacnhan {lastFour}<br><br>Nếu không phải bạn đổi, bạn đừng xác nhận và báo chủ nhóm ngay nhé!
- `bank_erased`: ⚠️ TÀI KHOẢN NHẬN TIỀN VỪA BỊ XOÁ TRÊN WEBSITE<br><br>🏦 Ngân hàng: {bank}<br>🔢 Số tài khoản: ···{lastFour}<br><br>Mình chưa chuyển tiền được cho bạn cho đến khi bạn cài tài khoản mới (gõ /stk để xem cú pháp).<br>Nếu không phải bạn xoá, bạn báo chủ nhóm ngay nhé!
- `bank_confirmed`: ✅ **ĐÃ XÁC NHẬN TÀI KHOẢN NGÂN HÀNG THÀNH CÔNG!**<br><br>🏦 **Ngân hàng:** {bank}<br>🔢 **Số tài khoản:** ···{lastFour}<br><br>🎁 **Cảm ơn bạn!** Tiền hoàn của các đơn hàng thành công sẽ được hệ thống tự động chuyển về tài khoản ngân hàng này khi đến kỳ đối soát nhé.
- `bank_confirm_mismatch`: ⚠️ Tài khoản đang chờ bạn xác nhận có 4 số cuối là {lastFour}.<br><br>👉 Nếu đúng là tài khoản của bạn, bạn nhắn mình: /stk xacnhan {lastFour}<br><br>Nếu không phải tài khoản của bạn, bạn đừng xác nhận và báo chủ nhóm ngay nhé!
- `merge_claim_noted`: 📝 Mình đã ghi nhận Mã Khách Hàng {claimedCode} bạn gửi.<br><br>👉 Chủ nhóm sẽ kiểm tra rồi gộp mã này với tài khoản Zalo bạn đang nhắn, để tiền hoàn của bạn nằm ở một chỗ nhé!
- `notice_order_approved_bank_held`: 🎉 Đơn của bạn đã được duyệt!<br><br>💵 Bạn nhận: {cashback}<br>Mã đơn: {orderId}<br><br>Tài khoản ngân hàng bạn vừa lưu đang chờ bạn xác nhận trong Zalo. Mình chỉ chuyển tiền vào tài khoản đó sau khi bạn xác nhận.<br><br>Cảm ơn bạn đã tin tưởng 🙏
- `notice_order`: 📦 Cập nhật đơn {orderId}: {state}.
- `payout_voided`: ⚠️ HỦY GHI NHẬN THANH TOÁN<br><br>💰 Số tiền: {amount}<br><br>Mình ghi nhận nhầm lần chuyển khoản này nên đã hủy ghi nhận. Biên lai của lần đó nay hiện "Đã hủy ghi nhận"; số dư của bạn đã được tính lại.<br><br>Gõ /sodu để xem số dư mới nhé.
- `clawback_opened`: Đơn {orderId} bị sàn huỷ sau khi mình đã chuyển tiền, mình sẽ trừ {amount} vào lần chuyển sau.
- `clawback_commission_dropped`: Sàn giảm hoa hồng đơn {orderId} sau khi mình đã chuyển tiền, mình sẽ trừ {amount} vào lần chuyển sau.
- `value_missing`: –
- `rejection_reason_order_cancelled`: sàn báo đơn đã bị huỷ
- `rejection_reason_all_items_cancelled`: mọi sản phẩm trong đơn đã bị huỷ hoặc trả hàng
- `rejection_reason_commission_zero`: sàn không trả hoa hồng cho đơn này
- `rejection_reason_not_eligible`: đơn không đủ điều kiện hoàn tiền
- `rejection_reason_other`: xem chi tiết trên hoantiendp.com

### Telegram alert kinds

| Kind | Status | Title |
|---|---|---|
| `assistant_down` | new-only, in the report_bug format | Trợ Lý Zalo Mất Kết Nối |
| `assistant_session_conflict` | adapted (notify_zalo_websocket_conflict: details and step 1 name the new assistant; no reconnect count) | Zalo Bot Tranh Chấp WebSocket / Văng Kết Nối |
| `backup_failed` | new-only, in the report_bug format | Sao Lưu Hằng Ngày Thất Bại |
| `backup_offsite_failed` | new-only, in the report_bug format | Không Chép Được Bản Sao Lưu Lên Google Drive |
| `backup_offsite_too_large` | new-only, in the report_bug format | Bản Sao Lưu Quá Lớn Để Gửi Lên Google Drive |
| `bridge_captcha` | identical (telegram_alerts.py notify_shopee_captcha, CRITICAL badge kept) | Shopee dính Captcha Xác Minh (Slider/Traffic) |
| `bridge_login_lost` | identical (notify_shopee_session_expired) | Shopee Hết Phiên Đăng Nhập / Đã Bị Đăng Xuất |
| `bridge_page_error` | new-only, in the report_bug format | Trang Shopee Báo Lỗi Khi Tạo Link |
| `bridge_short_link_unresolved` | new-only, in the report_bug format | Không Mở Được Link Rút Gọn |
| `customer_sign_in_burst` | new-only, in the report_bug format | Nhiều Lần Đăng Nhập Sai Trên Website |
| `link_queue_stuck` | new-only, in the report_bug format | Hàng Đợi Link Bị Kẹt |
| `link_undeliverable` | new-only, in the report_bug format | Không Gửi Được Link Cho Khách |
| `notification_daily_cap` | new-only, in the report_bug format | Chạm Giới Hạn Tin Nhắn Zalo Trong Ngày |
| `notification_undeliverable` | new-only, in the report_bug format | Tin Nhắn Zalo Không Gửi Được |
| `order_frozen` | new-only, in the report_bug format | Đơn Hàng Bị Tạm Giữ Để Kiểm Tra Lại |
| `order_reversed` | new-only, in the report_bug format | Đơn Đã Duyệt Bị Sàn Hủy |
| `reconciliation_failed` | new-only, in the report_bug format | Đối Soát Thất Bại |
| `reconciliation_page_cap` | new-only, in the report_bug format | Báo Cáo Đối Soát Vượt Giới Hạn Trang |
| `reconciliation_source_stale` | new-only, in the report_bug format | Nguồn Báo Cáo Đối Soát Đã Cũ |
| `restore_drill_due` | new-only, in the report_bug format | Đến Hạn Diễn Tập Khôi Phục Sao Lưu |
| `shopee_payout_record_failed` | new-only, in the report_bug format | Không Đọc Được Trang Thanh Toán Shopee |
| `shopee_payout_record_unavailable` | new-only, in the report_bug format | Trang Thanh Toán Shopee Chưa Có Dữ Liệu |
| `shopee_payout_record_unreadable` | new-only, in the report_bug format | Trang Thanh Toán Shopee Đổi Dạng |
| `shopee_payout_status_refused` | new-only, in the report_bug format | Trạng Thái Thanh Toán Shopee Lạ |
| `web_link_safety_cap` | new-only, in the report_bug format | Website Chạm Giới Hạn An Toàn Tạo Link |

### Telegram order notices (DP Business group, D62)

Wording in `packages/labels/vi/order-notices.json`.

| Event | Live function | Status | Differences |
|---|---|---|---|
| `recorded` | `notify_new_order_received` | adapted | The cashback line is the estimated cashback the customer is told (after the fee and withheld tax), labelled "Hoàn tiền tạm tính" without "(80%)" (owner decision 2026-11-05). A guest's order has no cashback line. A frozen order's status line says "Đang kiểm tra lại". |
| `approved` | `notify_order_approved` | identical | |
| `rejected` | `notify_order_rejected` | adapted | The reason is the reason code in words; live's default sentence when there is none. |
| `reversed` | `notify_order_rejected` | new-only | Same text as rejected, with its own reason label. Live did not tell a reversal apart. |
| `paid` | `notify_order_paid` | adapted | The live note line is not sent (the new platform has no note on a payout step). |

In all of them the last time line is when the step was taken, not when the message left, and every
value is HTML-escaped (live left the order id and the platform as they were).
