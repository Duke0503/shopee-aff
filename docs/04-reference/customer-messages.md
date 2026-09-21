# Mẫu tin nhắn bot — bản viết lại

> Ngày viết: 09/09/2026 · Cập nhật: 18/09/2026
> Cài đặt đang dùng: **hoàn 80% dự kiến** *(chốt thực tế theo quyết toán sau voucher và thuế)*
> · **hoàn sau khi Shopee chốt kỳ đối soát** · **không mức tối thiểu**
>
> ⚠️ Câu chữ đang chạy thật nằm ở [`resources/messages.vi.json`](../../resources/messages.vi.json), và danh sách lệnh ở [mục cuối file này](#lệnh-khách-gõ-được).
> Đi kèm: [Phân tích mô hình](../01-business/business-model.md)

---

## Nguyên tắc của bản này

Khách đọc xong **phải biết đúng 3 điều**, không cần hỏi lại:

1. **Tôi được bao nhiêu tiền?** — bằng đồng, ghi rõ là con số dự kiến 80%
2. **Khi nào tôi nhận được?** — sau khi Shopee duyệt và chốt kỳ đối soát (30–70 ngày)
3. **Khi nào tôi KHÔNG được?** — nói trước, không đợi khách hỏi

---

## 1️⃣ Tin nhắn chính — khi trả link

```
✅ Link hoàn tiền của bạn

🔗 https://s.shopee.vn/9zxbhjyJYu

📦 Bỉm Tã Quần Bobby Size L
💵 Giá: 350.000₫
💰 Hoa hồng Shopee (dự kiến): 35.000₫
🎁 Bạn nhận về (80% dự kiến): 28.000₫
ℹ️ Số tiền thực nhận sẽ thay đổi theo mã giảm giá và sau khi khấu trừ thuế theo quyết toán thực tế từ Shopee.

👉 Để được ghi nhận hoàn tiền:
• Bấm đúng link trên rồi đặt hàng trên Shopee
• Nên mua ngay sau khi bấm link trên cùng thiết bị
• Hạn chế bấm thêm link Affiliate khác trước khi mua

⚡ Tiền hoàn sẽ tự động chuyển khoản sau khi Shopee hoàn tất kỳ đối soát!
🌐 Tra cứu & cài đặt tài khoản nhận tiền tại: https://hoantiendp.com
❓ Gõ /huongdan xem cách dùng • /coche xem cơ chế
```

**Vì sao đặt thứ tự như vậy:** tiền của khách → thời gian → điều kiện mất → mẹo → ghi chú. Khách đọc 2 dòng đầu là đã có thứ họ cần. Phần sau dành cho người đọc kỹ.

---

## 2️⃣ Khi Shopee đã ghi nhận đơn *(gửi sau vài giờ – 1 ngày)*

```
📥 Đơn của bạn đã được Shopee ghi nhận.

   Mã đơn: #XXXXXXXX
   Dự kiến hoàn: ~25.725₫

⏳ Giờ chờ Shopee duyệt.
   Bot sẽ nhắn lại khi có tiền — bạn không cần hỏi.

   Lưu ý: nếu bạn trả hàng thì đơn này sẽ bị huỷ hoàn.
```

> **Tin nhắn này quan trọng hơn nó trông.** Nó là bằng chứng bạn không quên khách. Phần lớn tiếng xấu của các nhóm hoàn tiền đến từ chỗ khách chờ 2 tháng trong im lặng rồi tưởng bị lừa.

---

## 3️⃣ Khi đơn đã duyệt — báo có tiền

```
🎉 Đơn #XXXXXXXX đã được Shopee duyệt!

💵 Bạn nhận: 25.725₫

Gửi mình số tài khoản theo mẫu:
   Ngân hàng – Số TK – Tên chủ TK

Mình chuyển trong 24h ạ. Cảm ơn bạn đã tin tưởng 🙏
```

---

## 4️⃣ Khi đơn KHÔNG được duyệt

```
😔 Đơn #XXXXXXXX không được Shopee ghi nhận hoa hồng.

Lý do: [huỷ đơn / trả hàng / Shopee không ghi nhận /
        shop không có hoa hồng]

Nên lần này mình không hoàn được, mong bạn thông cảm.
Đơn sau bạn cứ gửi link, mình làm tiếp nhé.
```

> **Luôn gửi tin này.** Im lặng khi đơn hỏng là cách nhanh nhất để bị gọi là lừa đảo. Một tin nhắn báo tin xấu vẫn tốt hơn không có tin nào.

---

## 5️⃣ Tin ghim / lệnh `/luatchoi` — giải thích một lần cho tất cả

```
📖 CÁCH NHÓM NÀY HOẠT ĐỘNG

Bạn gửi link → mình tạo link riêng → bạn mua qua link đó
→ Shopee trả hoa hồng cho mình → mình chia lại cho bạn.

💰 Bạn nhận: 70% hoa hồng.
   Tháng nào Shopee không giữ thuế thì bạn được 80%.

📅 Khi nào nhận:
   Shopee trả tiền cho mình sau 50–70 ngày kể từ khi
   đơn hoàn tất. Mình chỉ chuyển được sau khi có tiền
   thật — không ứng trước.

   → Bot tự nhắn bạn khi tiền về. Không cần hỏi.

❌ Không hoàn trong các trường hợp:
   • Huỷ đơn / trả hàng
   • Bấm link hoàn tiền khác sau link của mình
   • Shopee không ghi nhận đơn
   • Shop không tham gia chương trình hoa hồng

📊 Số hiển thị lúc tạo link là ƯỚC TÍNH.
   Số thật tính theo mức Shopee duyệt.

Có gì thắc mắc cứ nhắn, mình trả lời thật.
```

---

## 6️⃣ Bản rút gọn — nếu thấy tin nhắn chính dài quá

```
✅ Link đây ạ!
🔗 https://s.shopee.vn/9zxbhjyJYu

💵 Bạn được hoàn: ~25.725₫
📅 Nhận sau khi Shopee duyệt (~50–70 ngày kể từ khi đơn hoàn tất)
❌ Huỷ/trả hàng hoặc bấm link khác → không được hoàn

💡 Bấm link xong mua luôn, cùng máy, đừng bấm link nào khác nữa.

Gõ /luatchoi để xem chi tiết.
```

**Khuyến nghị:** dùng bản rút gọn cho khách quen, bản đầy đủ cho khách lần đầu.

---

## ⚠️ Hai dòng đã gỡ — và vì sao đừng đưa lại

Bản cũ có:

> *"Xoá giỏ cũ, **tắt app Shopee chạy ngầm**"*
> *"**KHÔNG vào Live/Video để mua**"*

Bạn nghĩ đó là mẹo giúp khách giữ hoa hồng. Shopee đọc nó ra thế này:

> *"Người này đang dạy khách né hệ thống ghi nhận của chúng ta, để giành công khỏi kênh Live/Video của chính chúng ta."*

Đoạn đó **do bạn soạn, bot bạn gửi, mấy trăm lần mỗi ngày, và Shopee lưu log hết**. Trong toàn bộ hệ thống, đây là thứ duy nhất tự khai bạn cố ý can thiệp.

**Mấy mẹo giữ lại thì hoàn toàn bình thường** — bấm link rồi mua luôn, mua cùng thiết bị, đừng bấm link khác. Đó là cách hoạt động của mọi chương trình tiếp thị liên kết, ai cũng hướng dẫn vậy. Chỉ hai dòng nhắm thẳng vào kênh của Shopee mới là vấn đề.

---

## 🔧 Cần thay số gì khi dùng

| Chỗ | Thay bằng |
|---|---|
| `~25.725₫` | 70% × hoa hồng ước tính của đơn đó |
| `36.750₫` | Hoa hồng ước tính Shopee/shop trả |
| `50–70 ngày` | Kiểm lịch thanh toán thật trong tài khoản Shopee Affiliate của bạn |
| `#XXXXXXXX` | Mã đơn |
| `/luatchoi` | Tên lệnh bạn muốn đặt |

**Một điều nên làm ngay:** đo xem thực tế Shopee trả tiền cho bạn sau bao nhiêu ngày. Nếu là 55 ngày thì viết 55, đừng viết "50–70". **Con số càng cụ thể, khách càng ít hỏi và càng ít nghĩ bạn câu giờ.** Cách đo: xem lịch sử thanh toán trong tài khoản, đối chiếu ngày đơn hoàn tất với ngày tiền về.


---

## Lệnh khách gõ được

Định nghĩa ở `COMMAND_*` trong `src/cashback/messaging/conversation.py`.
Gõ không dấu, không phân biệt hoa thường, và gõ trống chữ (không có dấu `/`)
vẫn nhận — `sodu` cũng chạy như `/sodu`.

| Lệnh | Tên gọi khác | Trả lời gì | Gửi ở đâu |
|---|---|---|---|
| `/huongdan` | `/help` `/batdau` `/start` `/cachdung` | 4 bước dùng bot | nơi khách gõ |
| `/coche` | `/chinhsach` | tiền ở đâu ra, bao nhiêu, khi nào có | nơi khách gõ |
| `/dieukien` | `/dieukhoan` `/khinao` | 4 trường hợp không được hoàn + điều khoản thuế | nơi khách gõ |
| `/sodu` | `/tien` `/kiemtra` | số dư của khách: đã duyệt / đang chờ / đã trả | **luôn riêng tư** |
| `/nganhang` | `/taikhoan` `/stk` | xem hoặc gửi số tài khoản | **luôn riêng tư** |
| `/xoathongtin` | `/xoadulieu` | xoá số tài khoản đã lưu | **luôn riêng tư** |

Lệnh không có trong danh sách thì bot nói thẳng là không có, kèm danh sách
lệnh đúng — thay vì im lặng trả lời chuyện khác.

### Vì sao có `/sodu`

Ngưỡng chuyển tiền là **50.000₫ mỗi khách** (`payouts.MIN_PAYOUT_VND`).
Hoa hồng một đơn thường chỉ vài nghìn, nên khách bình thường phải mua nhiều
đơn mới đủ. Trước khi có lệnh này, khách nghe *"bạn nhận 6.484₫"* rồi im
lặng hàng tháng — từ phía họ không phân biệt được với việc bị quỵt, và cách
duy nhất để biết là nhắn hỏi người thật.

Ba chỗ nói về ngưỡng, và phải nói **trước** khi nó chặn tiền:

1. `/coche` và `/dieukien` — dòng `payout_threshold_line`
2. Tin báo đơn được duyệt — `payout_note_short`, nói rõ còn thiếu bao nhiêu
3. `/sodu` — khách tự tra bất cứ lúc nào

### Tin báo đơn được duyệt có 4 dạng

Phụ thuộc **hai** điều kiện cùng lúc, không phải một:

| Số dư | Có STK chưa | Nói gì |
|---|---|---|
| đủ 50.000₫ | rồi | `payout_note_ready` — đọc lại STK, báo sắp chuyển |
| đủ 50.000₫ | chưa | `payout_note_ready_need_bank` — xin STK |
| chưa đủ | rồi | `payout_note_short` — còn thiếu bao nhiêu |
| chưa đủ | chưa | `payout_note_short_need_bank` — còn thiếu, chưa xin STK vội |

**Không được gộp bốn dạng này lại.** Bản cũ nói *"Mình chuyển vào tài khoản
này nhé"* trên **mọi** đơn được duyệt, kể cả đơn 6.484₫ — khách canh app
ngân hàng cả tuần rồi kết luận là bị lừa. Và cũng không xin số tài khoản khi
tiền chưa đủ để chuyển: hỏi số tài khoản của người lạ để trả một khoản chưa
tồn tại thì không khác gì lừa đảo.
