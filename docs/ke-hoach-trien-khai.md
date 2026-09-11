# Kế hoạch triển khai — làm gì, theo thứ tự nào

> Ngày: 10/09/2026
> Đi kèm: [Phân tích mô hình](./shopee-cashback-bot-analysis.md) · [Mẫu tin nhắn bot](./mau-tin-nhan-bot.md)

---

## Nguyên tắc xuyên suốt

> **Đo trước, xây sau. Con bot không đẻ ra khách — nó chỉ phục vụ khách đã có.**

Ở mức thu nhập ~750.000₫/tháng, mỗi giờ bỏ ra để sửa bot đều đắt. Nên thứ tự dưới đây được sắp để **bỏ ít công nhất cho tới khi biết chắc mô hình chạy được**.

---

## 🚧 BƯỚC 0 — Câu chặn cửa (5 phút, làm ngay hôm nay)

Mở tài khoản Shopee Affiliate → tìm mục **Open API** (hoặc AppID / Secret Key / Khoá API).

| Kết quả | Nghĩa là |
|---|---|
| ✅ **Có** | Tự động hoá được hợp lệ. Đi tiếp Bước 1 |
| ❌ **Không có** | **Dừng kế hoạch làm bot tự động.** Xem [Nếu không có khoá API](#-nếu-không-có-khoá-api) ở cuối |

**Vì sao đây là câu đầu tiên:** không có khoá thì cách duy nhất để tự động tạo link là **điều khiển trình duyệt tự bấm nút** trên trang affiliate. Đó đúng là hành vi *"sử dụng robot hoặc các công cụ thao tác tự động"* mà Shopee cấm — và là lý do bị khoá tài khoản.

Đừng viết dòng code nào trước khi biết câu trả lời.

---

## 📊 BƯỚC 1 — Lấy 5 con số thật (30 phút)

Vào tài khoản Shopee Affiliate, lấy đủ 5 số này. Toàn bộ tài liệu phân tích đang chạy trên số **ước lượng** — thay bằng số thật thì bảng thu nhập có thể đổi gấp đôi hoặc giảm một nửa.

| # | Con số | Đang dùng | Lấy ở đâu |
|---|---|---|---|
| 1 | **Hoa hồng trung bình thật** | 4,5% *(đoán)* | Lấy **tổng hoa hồng ÷ tổng giá trị đơn** của 100 đơn gần nhất |
| 2 | **Shopee trả sau bao nhiêu ngày** | 50–70 *(theo quy định)* | Lịch sử thanh toán — so ngày đơn hoàn tất với ngày tiền về |
| 3 | **Trần hoa hồng mỗi đơn** | 40k? 70k? *(mâu thuẫn)* | Điều khoản trong tài khoản |
| 4 | **Có hạn mức hoa hồng theo tháng không** | Chưa rõ | Nếu bị chặn ~7,8 triệu/tháng thì **trần thu nhập của bạn là ~700k** |
| 5 | **Có `conversionReport` không** | Chưa rõ | Nếu không có, phải đối soát bằng file tải tay |

**Ghi 5 số này vào đâu đó.** Mọi quyết định sau đều dựa vào chúng.

---

## ✋ BƯỚC 2 — Chạy tay 10 đơn (1–2 tuần, KHÔNG viết code)

Đây là bước dễ bị bỏ qua nhất, và là bước tiết kiệm nhiều thời gian nhất.

**Cách làm:**
1. Lấy 5–10 người quen thật
2. Họ gửi link → bạn **vào trang affiliate bấm nút tạo link bằng tay** → copy trả lại
3. Dùng đúng [mẫu tin nhắn](./mau-tin-nhan-bot.md), gõ tay cũng được
4. Ghi vào một **Google Sheet** với đúng các cột:

```
Ngày | Khách | Link gốc | Link aff | Giá đơn | Hoa hồng ước tính |
Trạng thái | Ngày Shopee duyệt | Tiền hoàn | Ngày đã chuyển
```

5. Chờ. Đúng, chờ 50–70 ngày.

**Trong lúc chờ, bạn học được thứ không code nào dạy được:**

| Câu hỏi | Vì sao quan trọng |
|---|---|
| **Khách có chịu chờ 2 tháng không?** | ⭐ Quan trọng nhất. Nếu họ bỏ đi thì bot đẹp cỡ nào cũng vô nghĩa |
| Bao nhiêu người hỏi lại giữa chừng? | Quyết định có cần tin nhắn "đã ghi nhận đơn" không |
| Bao nhiêu đơn bị huỷ/trả thật? | Đang đoán 12% |
| Mất bao nhiêu phút mỗi đơn khi làm tay? | Quyết định bao nhiêu đơn thì đáng viết bot |
| Bao nhiêu khách quên không đòi tiền? | Đây có thể là nguồn lãi thật — cần biết mình phụ thuộc bao nhiêu |

> **Điểm dừng:** nếu quá nửa số khách bỏ cuộc vì phải chờ lâu → **dừng lại, đừng viết bot.** Vấn đề không nằm ở công cụ.

---

## 🔨 BƯỚC 3 — Xây cuốn sổ trước, bot sau

Chỉ làm bước này **sau khi Bước 2 chạy được**.

### 3.1 — Vì sao xây sổ trước

Mấy repo trên GitHub chỉ giải quyết phần dễ. Nhìn lại workflow của bạn:

```
Bước 1  nhận link từ khách        ← thư viện Telegram làm, ~20 dòng
Bước 2  bóc mã sản phẩm           ← regex, ~10 dòng
Bước 3  gọi API tạo link          ← ✅ repo có sẵn (~30 dòng ký chữ ký)
Bước 4  tính hoa hồng             ← ✅ một phần
Bước 5  gửi tin nhắn              ← thư viện Telegram
──────────────────────────────────────────────────────
Bước 6  theo dõi đơn suốt 50–70 ngày  ← ❌ KHÔNG repo nào làm
        đối soát 2 đợt mỗi tháng      ← ❌
        biết đơn nào đã duyệt         ← ❌
        chuyển tiền cho khách         ← ❌
        báo khi đơn hỏng              ← ❌
```

> **Cuốn sổ theo dõi đơn chính là sản phẩm. Cái link chỉ là phần dễ.**

Phần lớn bot ngoài kia **không hoàn tiền** — chúng chỉ đăng deal. Nên không ai viết sẵn phần này cho bạn.

### 3.2 — Cuốn sổ cần đúng những gì

Mỗi đơn có **3 trạng thái, đi một chiều**:

```
   chờ duyệt  ──────►  đã duyệt  ──────►  đã trả tiền
   (pending)           (confirmed)         (paid)
       │
       └──────────►  hỏng (rejected)  → nhắn báo khách
```

**Luật sắt:** ❌ **Không bao giờ chuyển tiền khi đơn còn ở "chờ duyệt".**

Mỗi bản ghi cần: mã đơn · khách · giá đơn · hoa hồng ước tính · **hoa hồng thật khi duyệt** · trạng thái · ngày đổi trạng thái · tiền đã hoàn · ngày chuyển.

*(Ước tính và số thật phải là **hai cột riêng**. Chúng luôn lệch nhau, và khách sẽ hỏi.)*

### 3.3 — Thứ tự làm

| Thứ tự | Làm gì | Ghi chú |
|---|---|---|
| 1 | **Cuốn sổ + 4 trạng thái** | Chạy được với link tạo tay. Đây là phần lõi |
| 2 | **Việc đối soát** — chạy ngày **12** và **25** hàng tháng | Ngay sau ngày Shopee mở đối soát (11 và 24). Nếu không có `conversionReport` thì tải file về, đọc lên |
| 3 | **Nối Telegram** — nhận link, trả tin nhắn | Dùng [mẫu có sẵn](./mau-tin-nhan-bot.md) |
| 4 | **Gọi API tạo link tự động** | ~30 dòng: `SHA256(AppId + Timestamp + Payload + Secret)` → `generateShortLink` |
| 5 | **Tin nhắn tự động khi đổi trạng thái** | Đã duyệt → xin số tài khoản. Hỏng → báo ngay |

### 3.4 — Về mấy repo trên GitHub

**Kết luận: đừng fork cái nào.**

| Repo | Sao | Vấn đề |
|---|---|---|
| `snja/shopee-affiliate-openapi` | 6 | **Đóng băng 19/10/2024**, 1 commit, 2 hàm, ví dụ Indonesia |
| `RenanFR/shopee-affiliate-telegram-bot` | **0** | Chỉ đọc báo cáo click, **không tạo được link** |
| `hectorzin/botaffiumeiro` | 13 | Code tốt nhất, Docker, đang active — nhưng **không hỗ trợ Shopee** |
| `roywikan/shopee-affiliate-api-bot` | 9 | Python, có sẵn auth + database — nhưng Indonesia, gần như không có tài liệu |
| `SaulloGabryel/BlueBot` · `gregojoao/shopee-affiliate` | — | Brazil |

**Không cái nào của người Việt. Không cái nào hỗ trợ Zalo. Cái nhiều sao nhất là 13** — nghĩa là chưa ai dùng thật.

Fork một repo không ai dùng thì không tiết kiệm được gì — chỉ thừa hưởng lỗi của người lạ mà không có ai để hỏi.

**Thứ đáng lấy:** đọc `snja` và `roywikan` để hiểu **cách ký chữ ký** (~30 dòng). Chép đúng phần đó, viết phần còn lại sạch.

---

## 🚫 Những thứ ĐỪNG làm sớm

| Đừng làm | Vì sao |
|---|---|
| Xây "ví" giữ tiền của khách | Có thể phải xin phép Ngân hàng Nhà nước. Hoàn xong là xong |
| Làm giao diện web / dashboard | Chưa ai cần. Google Sheet là đủ trong nhiều tháng |
| Hỗ trợ nhiều sàn (TikTok, Lazada) | Chưa chạy nổi một sàn thì đừng thêm sàn thứ hai |
| Tự động chuyển khoản qua ngân hàng | Rủi ro cao, tiết kiệm được vài phút. Chuyển tay đi |
| Nâng mức hoàn lên 90% để hút khách | Ở 90% bạn không còn gì cả |
| Chuyển tiền trước khi Shopee duyệt | Đây là thứ đang bảo vệ bạn |

---

## ❌ Nếu không có khoá API

Nếu Bước 0 cho kết quả "không có", còn ba lựa chọn — theo thứ tự nên chọn:

**1. Chạy tay, quy mô nhỏ *(khuyên dùng)***
Vài chục đơn/ngày là hết sức người, nhưng **không vi phạm gì cả**. Với mục tiêu kiếm thêm thì vẫn đủ. Cuốn sổ Google Sheet + tin nhắn gõ tay vẫn chạy tốt.

**2. Xin qua mạng lưới trung gian**
Shopee VN cũng chạy affiliate qua một số đối tác trung gian (ví dụ Involve Asia). Có nơi cấp quyền dùng API dễ hơn — nhưng tỷ lệ hoa hồng thường **thấp hơn** đăng ký trực tiếp. Đáng hỏi thử, chưa xác minh được điều kiện.

**3. Tự động bằng cách điều khiển trình duyệt**
❌ **Không khuyên.** Đây đúng là hành vi Shopee cấm, và mất tài khoản thì mất luôn cả tiền hoa hồng chưa thanh toán.

---

## ✅ Việc hôm nay

```
[ ] 1. Mở tài khoản Shopee Affiliate → tìm mục Open API      (5 phút)
[ ] 2. Lấy 5 con số ở Bước 1, ghi lại                        (30 phút)
[ ] 3. Rủ 5–10 người quen, nói rõ luật chơi: hoàn 80%,
       chờ 50–70 ngày                                        (hôm nay)
[ ] 4. Tạo Google Sheet với đủ các cột ở Bước 2               (10 phút)
```

**Chưa viết dòng code nào.** Quay lại chuyện code sau khi có 10 đơn chạy qua tay.
