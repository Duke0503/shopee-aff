# Mẫu tin nhắn bot — bản viết lại

> Ngày: 09/09/2026
> Cài đặt đang dùng: **hoàn 70%** *(có tháng lên 80%)* · **trả sau khi Shopee duyệt đơn**
> Đi kèm: [Phân tích mô hình](./shopee-cashback-bot-analysis.md)

---

## Nguyên tắc của bản này

Khách đọc xong **phải biết đúng 3 điều**, không cần hỏi lại:

1. **Tôi được bao nhiêu tiền?** — bằng đồng, không bằng phần trăm
2. **Khi nào tôi nhận được?** — bằng ngày, không nói chung chung
3. **Khi nào tôi KHÔNG được?** — nói trước, không đợi khách hỏi

Ba cái đã sửa so với bản cũ:

| Bản cũ | Bản mới | Vì sao |
|---|---|---|
| Số to nhất là **hoa hồng của bạn** (₫36.750) | Số to nhất là **tiền khách nhận** (₫25.725) | Khách đang tưởng họ được 36.750₫ → chờ 2 tháng nhận 25.725₫ → nghĩ bị ăn bớt |
| Không nói khi nào trả | **"Khoảng 50–70 ngày sau khi đơn hoàn tất"** | Không nói = khách tự đoán là vài ngày = chắc chắn cãi nhau |
| Không nói khi nào mất | **Ghi rõ 4 trường hợp không được hoàn** | Nói trước là điều kiện. Nói sau là bào chữa |
| *"Tắt app Shopee chạy ngầm / KHÔNG vào Live-Video"* | **Đã gỡ** | Đây là dạy khách né hệ thống Shopee. Bot bạn gửi, Shopee lưu log |

---

## 1️⃣ Tin nhắn chính — khi trả link

```
✅ Link của bạn đây ạ!

🔗 https://s.shopee.vn/9zxbhjyJYu

━━━━━━━━━━━━━━━━━━━━━━
💵 BẠN ĐƯỢC HOÀN: ~25.725₫
━━━━━━━━━━━━━━━━━━━━━━

📅 Nhận khi nào?
   Sau khi Shopee duyệt đơn
   → khoảng 50–70 ngày kể từ lúc đơn hoàn tất

📌 Cách nhận: đơn duyệt xong bot tự nhắn bạn,
   lúc đó bạn gửi số tài khoản là được chuyển.

⚠️ 4 trường hợp KHÔNG được hoàn:
   1. Bạn huỷ đơn hoặc trả hàng
   2. Bạn bấm link hoàn tiền của nhóm khác sau link này
      (Shopee chỉ tính link bấm sau cùng)
   3. Shopee không ghi nhận đơn
   4. Shop đó không tham gia chương trình hoa hồng

💡 Để chắc ăn:
   • Bấm link xong mua luôn, đừng để mai
   • Mua trên đúng máy/điện thoại vừa bấm link
   • Đừng bấm thêm link hoàn tiền nào khác cho đơn này

ℹ️ Số 25.725₫ là ước tính (70% hoa hồng 36.750₫).
   Số cuối cùng tính theo mức Shopee duyệt —
   nếu bạn dùng thêm voucher, giá giảm thì tiền
   hoàn cũng giảm theo.
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
