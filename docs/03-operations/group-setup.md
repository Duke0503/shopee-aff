# Dựng nhóm và chạy một ngày

Tài liệu này đi **từ đầu đến cuối một lượt**: khách vào nhóm thấy gì, gõ
gì, bot trả gì, admin bấm gì. Chữ trong khung là chữ thật, copy dán thẳng
vào Zalo được.

Chữ gửi khách nằm ở [`resources/messages.vi.json`](../../resources/messages.vi.json).
Hai tin ghim dưới đây **không** nằm trong đó — Zalo không cho bot ghim, nên
admin phải tự đăng và tự ghim.

---

## 0. Trước khi mời ai vào nhóm

```bash
uv run cashback status          # đọc được cấu hình chưa
uv run cashback review          # còn dòng nào kẹt không
```

`status` phải ra `Shopee: browser (real links...)` và `Zalo: live`. Nếu ra
`Zalo: STDOUT (no token)` thì bot chưa có token, chưa mời ai được.

Bot phải đang chạy: xem [runbook](./runbook.md) mục bật/tắt.

---

## 1. Hai tin ghim trong nhóm

Admin đăng hai tin này rồi ghim cả hai. Tin 1 là thứ người mới đọc, tin 2
là thứ để chỉ vào khi có tranh cãi.

### 📌 Ghim 1 — Bắt đầu thế nào

```
📌 HOÀN TIỀN SHOPEE — ĐỌC TRƯỚC KHI MUA

Mua qua link của bot thì được hoàn lại tiền. Giá vẫn y hệt,
bạn không mất thêm đồng nào.

📌 Ví dụ: đơn 200.000đ, hoa hồng 8% → bạn nhận 12.800đ

━━━━━━ LÀM 3 BƯỚC ━━━━━━

1️⃣ MỞ CHAT RIÊNG VỚI BOT  (chỉ làm 1 lần)

   📱 Điện thoại: bấm tên "Bot DP Shopee Affiliate" ở đầu nhóm
      → bấm "Nhắn tin" → gõ: hi

   💻 Máy tính: gõ ngay trong nhóm này
      @Bot DP Shopee Affiliate hi
      → bot sẽ nhắn riêng lại cho bạn

2️⃣ GỬI LINK SẢN PHẨM  (gửi trong CHAT RIÊNG, đừng gửi trong nhóm)

   Shopee → Chia sẻ → Sao chép link → dán cho bot
   ⚠️ Bấm dấu ✕ xoá khung ảnh xem trước rồi MỚI gửi,
      không bot đọc không được link

   → Khoảng 1 phút bot trả lại link hoàn tiền + số tiền bạn được

3️⃣ BẤM LINK BOT GỬI RỒI MUA LUÔN

   Mua trên đúng máy vừa bấm link.
   Đừng bấm thêm link hoàn tiền của nơi khác cho đơn đó.

━━━━━━━━━━━━━━━━━━━━━━

Gõ /huongdan để bot chỉ lại từng bước.
```

### 📌 Ghim 2 — Tiền về khi nào, và khi nào không có

```
📌 TIỀN VỀ KHI NÀO — ĐỌC ĐỂ KHỎI PHẢI HỎI

💵 Bạn nhận 80% hoa hồng Shopee trả cho đơn của bạn.
   (Tháng nào Shopee giữ thuế thu nhập 10% thì bạn nhận 70%.)

📅 Shopee duyệt đơn xong mới có tiền — khoảng 30-70 ngày
   kể từ lúc đơn hoàn tất. Bot tự nhắn bạn, không cần hỏi.

🔎 Gõ /sodu bất cứ lúc nào để xem bạn đang có bao nhiêu:
   đã duyệt · đang chờ Shopee · đã chuyển cho bạn.

━━━━━━ 4 TRƯỜNG HỢP KHÔNG ĐƯỢC HOÀN ━━━━━━

❌ Bạn huỷ đơn hoặc trả hàng
❌ Bạn bấm link hoàn tiền của nhóm khác SAU link của bot
   (Shopee chỉ tính link bấm sau cùng)
❌ Shopee không ghi nhận đơn
❌ Shop đó không tham gia chương trình hoa hồng
   (bot sẽ báo trước lúc gửi link nếu gặp shop này)

ℹ️ Số tiền bot báo lúc gửi link là ƯỚC TÍNH theo giá lúc đó.
   Số cuối cùng tính theo mức Shopee duyệt.

Gõ /dieukien để xem đầy đủ • /coche để hiểu bot lấy tiền ở đâu ra.
```

---

## 2. Khách đi từ đầu đến cuối

Mười một bước dưới đây là chữ bot trả thật, chạy qua `conversation.handle`.

### Bước 1 — Khách tag bot trong nhóm

Khách gõ: `@Bot DP Shopee Affiliate hi`

Bot trả **hai** tin cùng lúc — một vào nhóm, một vào chat riêng. Tin riêng
là thứ tạo ra khung chat ở phía khách, kể cả khách dùng máy tính (Zalo trên
PC không có nút "Nhắn tin" với bot, nên không có bước này thì khách PC
không bao giờ mở được chat riêng).

| Vào | Tin |
|---|---|
| Nhóm | `welcome` — lời chào + mức hoàn + ví dụ bằng đồng |
| Chat riêng | `first_touch` — "từ giờ nhắn thẳng vào đây" + nhắc xoá khung ảnh |

### Bước 2 — Khách dán link sản phẩm (chat riêng)

Bot trả `received`: *"Đã nhận link rồi nhé! Mình đang tạo link cho bạn,
khoảng 1 phút nữa gửi lại."*

Yêu cầu vào hàng đợi. Vòng `link_loop` gom theo từng khách, tối đa 5 link
một lần submit.

### Bước 3 — Bot gửi link về (thực tế ~4 giây)

`link_ready` — có link, số tiền khách nhận in đậm, giá, hoa hồng tách
Shopee/shop, điều khoản thuế, và nhắc "bấm xong mua luôn".

Ba nhánh khác:

- không tra được hoa hồng → `link_ready_no_estimate` (vẫn có link)
- shop không tham gia hoa hồng → `link_ready_no_commission` (nói thẳng
  không hoàn được đồng nào)
- tra mãi không ra → `link_failed` (xin lỗi, mời gửi lại)

### Bước 4 — Khách mua, đối soát ghi sổ

Trong vòng **60 phút** (`RECONCILE_INTERVAL_MINUTES`) vòng đối soát đọc
báo cáo Shopee, khớp `sub_id1` về khách, ghi đơn vào sổ.

Bot nhắn `order_recorded`: tên sản phẩm, link, dự kiến hoàn, mã đơn, và
"giờ chờ Shopee duyệt, khoảng 30-70 ngày".

### Bước 5 — Khách gõ `/sodu`

Ba con số: đã duyệt chờ chuyển · đang chờ Shopee duyệt · đã chuyển. Cộng
một dòng nói đang ở đâu trong quy trình.

**Luôn trả vào chat riêng**, kể cả khi khách gõ trong nhóm — số tiền của
một người không phải việc của cả nhóm.

### Bước 6-7 — Shopee duyệt

`order_approved` báo số tiền, rồi tuỳ đã có số tài khoản chưa:

| Có STK | Đuôi tin | Nói gì |
|---|---|---|
| rồi | `payout_note_ready` | đọc lại STK, *"chuyển xong mình nhắn ngay"* |
| chưa | `payout_note_ready_need_bank` | xin STK theo mẫu |

**Không hứa ngày.** Chuyển lúc nào là quyết định của anh; khách biết tiền
đã đi khi anh bấm nút, không phải trước đó. Số tài khoản cũng chỉ hỏi từ
đây trở đi — trước lúc có đơn được duyệt thì chưa có đồng nào, hỏi số tài
khoản của người lạ lúc đó không khác gì lừa đảo.

### Bước 8 — Khách gửi số tài khoản

`STK: VCB - 0123456789 - NGUYEN VAN A` → bot lưu và xác nhận `bank_saved`.

Nhận cả khi khách gõ trong nhóm, nhưng **trả lời riêng**, và trong sổ chỉ
lưu vân tay của số tài khoản vào nhật ký, không lưu số trần.

### Bước 9 — Admin mở trang chuyển tiền

<http://127.0.0.1:8899> — mỗi khách một thẻ, có mã QR VietQR điền sẵn số
tiền và nội dung `Hoan tien Shopee C0001`.

Tên ngân hàng không khớp chắc chắn với ngân hàng nào trong danh sách NAPAS
thì **không** ra QR, mà hiện cảnh báo để chuyển tay — đoán ở đây là gửi
tiền cho nhầm người.

### Bước 10 — Admin quét QR, bấm "Đã chuyển"

Bot nhắn `order_paid`: số tiền, gồm mấy đơn, vào tài khoản nào, nội dung
chuyển khoản là gì.

**Một tin cho một lần chuyển**, không phải một tin mỗi đơn — admin quét một
mã QR cho ba đơn, ba tin sẽ đọc thành đã được trả ba lần.

### Bước 11 — Khách gõ `/sodu` lại

`Đã chuyển cho bạn: 53.410đ` và *"Bạn không còn khoản nào chờ. Gửi link
sản phẩm tiếp là mình làm luôn."*

---

## 3. Admin gõ lệnh ở đâu

**Bot không có lệnh admin.** Không tag bot trong nhóm để làm việc quản trị
được — bot chỉ hiểu 6 lệnh của khách, ai gõ cũng ra kết quả như nhau.

Việc quản trị làm ở hai chỗ:

### Trang web

| Đường dẫn | Ai vào | Nội dung |
|---|---|---|
| `/` | ai cũng vào được | Trang giới thiệu: bot làm gì, hoàn bao nhiêu, khi nào **không** được hoàn |
| `/login` | khách | Đăng nhập bằng mã bot cấp (`/id`) + mật khẩu (`/matkhau`) |
| `/orders` | khách đã đăng nhập | Đơn của chính họ, trạng thái Shopee, số tiền |
| `/admin` | **chỉ máy chạy bot** | Bảng chuyển tiền: QR, nút "Đã chuyển", nút nhắn hỏi STK |

Việc hằng ngày của anh nằm ở `/admin`: <http://127.0.0.1:8899/admin>

`/api/payouts` và hai nút chuyển tiền **từ chối mọi request không đến từ
loopback**, không phải chỉ dựa vào địa chỉ bind. Nên khi anh đưa `/` và
`/orders` lên tên miền thật, phần admin không lộ theo.

### Dòng lệnh

| Khi nào | Lệnh |
|---|---|
| Mỗi tối, xem phải chuyển cho ai | `cashback payouts` |
| Có dòng Shopee trả về mà bot không dám đoán | `cashback review` |
| Vừa sửa bảng trạng thái, đẩy lại dòng kẹt | `cashback review --retry` |
| Dòng đó đã xử lý tay xong | `cashback review --resolve N` |
| Trước mỗi đợt chuyển tiền | `cashback audit --scan` |
| Xem một khách đã làm gì | `cashback audit --customer C0003` |
| Đối soát ngay, không đợi 60 phút | `cashback reconcile --live` |
| Sau 100-300 đơn thật | `cashback metrics` |
| Mỗi tháng, nén log | `cashback audit --archive` |
| Khách đòi xoá dữ liệu | `cashback forget C0003` |

`forget` từ chối nếu khách còn được nợ tiền. Muốn xoá thật thì phải trả
xong trước — xem [CLAUDE.md](../../CLAUDE.md) mục 2.

---

## 4. Ba câu khách hay hỏi và câu trả lời có sẵn

| Khách hỏi | Bảo họ gõ | Bot trả |
|---|---|---|
| "Tiền tôi đâu?" | `/sodu` | ba con số + đang thiếu bao nhiêu |
| "Sao đơn tôi không được hoàn?" | `/dieukien` | 4 trường hợp, nói trước chứ không bào chữa sau |
| "Bot lấy tiền ở đâu ra, tôi có mất gì không?" | `/coche` | Shopee trả hoa hồng, giá khách trả không đổi |

---

## 5. Những thứ nhóm KHÔNG làm được

Ghi ở đây để khỏi hứa nhầm với khách:

> Từ 25/9/2026 không còn dùng Zalo Bot API. "Bot" là tài khoản Zalo cá
> nhân chạy `zalo_assistant/`: nghe được cả nhóm, đọc được tin có khung
> ảnh xem trước. Các giới hạn cũ về @tag và khung ảnh không còn đúng.

- **Tài khoản cá nhân dùng công cụ không chính thức (`zca-js`).** Zalo khoá
  tài khoản đó là mất liên lạc với mọi khách cùng lúc. Website là kênh
  dự phòng: khách vẫn đăng nhập bằng mã DP để xem đơn.
- **Đổi tài khoản Zalo của bot là mọi người đổi UID.** Sau khi đổi phải
  chạy `cashback merge-customers`, nếu không mỗi người thành hai khách.
- **Bot không tự chuyển tiền.** Ngân hàng Việt Nam không mở API cho tài
  khoản cá nhân. QR là để admin quét, không phải để bot tự trả.
