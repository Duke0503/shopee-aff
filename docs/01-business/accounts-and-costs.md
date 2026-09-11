# Danh sách tài khoản cần có

> Ngày: 10/09/2026
> Đi kèm: [Kế hoạch triển khai](./ke-hoach-trien-khai.md) · [Phân tích mô hình](./shopee-cashback-bot-analysis.md)

---

## Tóm tắt: cần gì, tốn bao nhiêu

| Tài khoản | Bắt buộc? | Chi phí | Thời gian có |
|---|---|---|---|
| 1. Tài khoản Shopee cá nhân (đã xác minh) | ✅ Bắt buộc | Miễn phí | Có sẵn |
| 2. Tài khoản Shopee Affiliate | ✅ Bắt buộc | Miễn phí | **3–7 ngày duyệt** |
| 3. Khoá Open API (AppId + Secret) | ⚠️ **Quyết định tất cả** | Miễn phí *(nếu được cấp)* | Kiểm trong tài khoản |
| 4. CCCD + Mã số thuế cá nhân | ✅ Bắt buộc | Miễn phí | Có sẵn |
| 5. Tài khoản ngân hàng | ✅ Bắt buộc | Miễn phí | Có sẵn |
| 6. Telegram + Bot Token | ✅ Nên có | **Miễn phí** | 5 phút |
| 7. **Zalo Bot API** *(chính thức, chạy trong nhóm)* | ⭐ **Nên có** | **Miễn phí** | 5 phút |
| ~~Zalo OA + gói Tăng trưởng~~ | ❌ **Không cần** | ~~2.500.000₫/năm~~ | — |
| 8. Google (cho Sheet ghi sổ) | ✅ Giai đoạn đầu | Miễn phí | Có sẵn |
| 9. Chỗ chạy bot 24/7 (VPS) | Khi đã có bot | 0 – 100.000₫/tháng | 1 giờ |

**Tổng chi phí khởi động: gần như 0₫** — cả Telegram lẫn Zalo đều có bot chính thức miễn phí.

---

## 1. Tài khoản Shopee cá nhân

- **Cần gì:** đã xác minh email + số điện thoại, **không có vi phạm chính sách nào**
- **Lưu ý:** đây là tài khoản nền để đăng ký affiliate. Nếu tài khoản này từng bị cảnh cáo thì đơn đăng ký affiliate dễ bị từ chối

---

## 2. Tài khoản Shopee Affiliate

**Trang đăng ký:** `affiliate.shopee.vn`

### Điều kiện

| Đường đăng ký | Yêu cầu | Duyệt |
|---|---|---|
| **Đăng ký trực tiếp** | **500+ follower** trên Facebook / TikTok / YouTube / Instagram, **hoặc** website/blog có traffic | 3–7 ngày làm việc |
| **Dạng KOC** | Không yêu cầu follower tối thiểu | 1–3 ngày |

⚠️ **Chưa xác minh chắc phần KOC** — nguồn thứ cấp. Khi vào trang đăng ký sẽ thấy rõ các lựa chọn.

### Cần chuẩn bị sẵn

```
[ ] Họ tên, email, số điện thoại
[ ] CCCD (dùng để xác minh và đăng ký mã số thuế cá nhân)
[ ] Link kênh mạng xã hội chính (phải thật, họ có xem)
[ ] Mô tả ngắn cách bạn định quảng bá
[ ] Số tài khoản ngân hàng
```

### ⚠️ Không được làm

> **Chỉ đăng ký MỘT tài khoản.**
>
> Chính sách Shopee cấm *"vận hành nhiều tài khoản liên kết để gian lận"*. Nhiều tài khoản đứng tên người nhà cũng bị tính. Bị phát hiện là khoá hết, không riêng cái nào.

---

## 3. ⭐ Khoá Open API — thứ quyết định mọi thứ

### Nó là cái gì?

> **Không có khoá API** — bạn phải tự ra quầy. Mở trình duyệt, đăng nhập trang affiliate, dán link vào, bấm nút "Tạo link", đợi, copy ra. Mỗi khách một lần, khoảng **30 giây một đơn**.
>
> **Có khoá API** — Shopee mở cho bạn **một cái cửa sau**. Phần mềm đưa link vào, máy trả link tiếp thị ra. **Một giây, không cần ai ngồi bấm.**

Nó không phải tính năng cao siêu gì. Nó chỉ là **cho phép máy nói chuyện với máy**.

### Trông như thế nào

Là **hai chuỗi ký tự**:

```
AppId   →  một dãy số, kiểu   18345
Secret  →  một chuỗi dài, kiểu  a7f3d9...   ← đây là mật khẩu, đừng đưa ai
```

*(Có nơi gọi Secret là "API Key" — cùng một thứ.)*

### Tìm ở đâu

```
Đăng nhập affiliate.shopee.vn
→ ngay TRANG CHỦ có mục tên "Open API"
→ vào đó thấy AppId và Secret
```

**Việt Nam có được hỗ trợ.** Shopee mở Open API cho 10 nước: Brazil, Indonesia, Malaysia, Mexico, Philippines, Poland, Singapore, Taiwan, Thailand, **Việt Nam**. Địa chỉ `open-api.affiliate.shopee.vn` có thật, có cả trang thử API.

### Cần khoá đó để làm hai việc

| Việc | Tên hàm | Quan trọng cỡ nào |
|---|---|---|
| **Tạo link tiếp thị tự động** | `generateShortLink` | Tiết kiệm ~30 giây mỗi đơn |
| **Biết đơn nào Shopee đã duyệt** | `conversionReport` | ⭐ **Đây mới là mấu chốt** |

Cái thứ hai quan trọng hơn nhiều. Cuốn sổ của bạn phải theo dõi mỗi đơn qua cả kỳ đối soát và biết lúc nào Shopee duyệt để còn trả tiền khách. Có `conversionReport` thì **máy tự hỏi Shopee "đơn nào duyệt rồi?" và tự cập nhật sổ**.

Không có nó: mỗi tháng hai lần **tải file về, mở lên, dò tay**. Vẫn làm được, chỉ là làm tay.

> **Tạo link giúp bạn nhanh hơn. Đối soát mới là thứ giữ cho bạn không quỵt khách.**

### ✅ Cách thử trong 2 phút, không viết dòng code nào

```
1. Vào affiliate.shopee.vn → mục Open API → copy AppId + Secret
2. Mở  open-api.affiliate.shopee.vn/explorer/v2
3. Dán AppId + Secret vào 2 ô trên trang
4. Chạy thử generateShortLink với một link sản phẩm bất kỳ
```

**Ra được link → khoá chạy.** Lỗi → hoặc chưa được cấp, hoặc phải xin.

*(Trang đó còn tự sinh sẵn câu lệnh `cURL` — sau này chép thẳng vào code.)*

### Kết quả nghĩa là gì

| Kết quả | Nghĩa là |
|---|---|
| ✅ **Có, chạy được** | Tự động hoá được hợp lệ. Đi tiếp theo [kế hoạch](./ke-hoach-trien-khai.md) |
| ❌ **Không có** | Không tự động hoá được **một cách hợp lệ**. Chỉ còn đường chạy tay quy mô nhỏ |

**Vì sao quan trọng đến thế:** không có khoá thì cách duy nhất để tự động tạo link là **điều khiển trình duyệt tự bấm nút**. Đó đúng là hành vi *"sử dụng robot hoặc các công cụ thao tác tự động"* mà Shopee cấm — và mất tài khoản thì mất luôn cả hoa hồng chưa thanh toán (có thể là 2 tháng tiền).

**Nếu không có, còn một đường đáng hỏi:** Shopee VN cũng chạy affiliate qua một số mạng lưới trung gian (ví dụ Involve Asia). Có nơi cấp quyền dùng API dễ hơn, nhưng **hoa hồng thường thấp hơn** đăng ký trực tiếp. Chưa xác minh được điều kiện cụ thể — đáng hỏi thử.

### 📌 Mức tin cậy

| Thông tin | Độ chắc |
|---|---|
| Việt Nam nằm trong 10 nước được hỗ trợ | ✅ Nhiều nguồn khớp |
| `open-api.affiliate.shopee.vn` có thật, có trang thử API | ✅ Kiểm trực tiếp |
| Mục "Open API" nằm ở trang chủ tài khoản affiliate | ✅ 2 nguồn khớp |
| **Tự lấy được ngay, không cần xin duyệt** | ⚠️ **Chưa chắc** — tài liệu bên thứ ba nói tự lấy được, nhưng **không có tài liệu nào của chính Shopee**. Một số chương trình chỉ mở API cho đối tác lớn |

**Trả lời trung thực: rất có thể bạn có — nhưng phải tự mở ra xem.**

---

## 4. CCCD + Mã số thuế cá nhân

- **CCCD:** Shopee yêu cầu khi đăng ký affiliate
- **Mã số thuế cá nhân:** Shopee dùng CCCD để đăng ký. Bạn cần nó để **cuối năm quyết toán phần thuế đã bị giữ** (có thể được hoàn, có thể không — tuỳ tổng thu nhập)
- **Giữ lại:** tờ giấy Shopee xác nhận đã giữ tiền thuế *(chứng từ khấu trừ thuế, bản điện tử)*. Không có tờ này thì không quyết toán được

---

## 5. Tài khoản ngân hàng

Dùng cho **hai việc khác nhau**:

| Việc | Ghi chú |
|---|---|
| **Nhận hoa hồng từ Shopee** | Phải cập nhật đúng trên `affiliate.shopee.vn`. **Thiếu là tiền treo, Shopee không chuyển được** |
| **Chuyển tiền hoàn cho khách** | Dùng tài khoản cá nhân. Nhiều giao dịch nhỏ là bình thường |

⚠️ **Đừng giữ sẵn tiền của khách trong "ví" chờ đủ mức mới cho rút** — việc đó có thể bị coi là giữ tiền hộ người khác, phải xin phép Ngân hàng Nhà nước. **Duyệt xong là chuyển, chuyển xong là hết.**

---

## 6. Telegram — nên chọn cái này trước

```
[ ] Tài khoản Telegram cá nhân
[ ] Chat với @BotFather → /newbot → đặt tên → nhận Bot Token
```

- **Chi phí: 0₫**
- **Thời gian: 5 phút**
- Không cần duyệt, không cần gói dịch vụ, không giới hạn tin nhắn
- Thư viện lập trình có sẵn đầy, tài liệu tốt

---

## 7. Zalo — có 4 đường, và đường tốt nhất ít người biết

> ### ⭐ Zalo có **Bot API chính thức, miễn phí, chạy được trong nhóm**
>
> Tên: **Zalo Bot** — `bot.zaloplatforms.com` · tài liệu: `docs.zaloplatforms.com/docs/BOT`
>
> Đây là sản phẩm **tách biệt hoàn toàn với Zalo OA**. Nhiều người tưởng Zalo chỉ có OA nên hoặc bỏ 2,5 triệu/năm mua nhầm thứ, hoặc đi đường không chính thức và cược tài khoản cá nhân. **Cả hai đều không cần.**

### Cách tạo bot (5 phút, miễn phí)

```
Mở app Zalo → tìm OA tên "Zalo Bot Manager"
→ trong khung chat chọn "Tạo bot"
→ đặt tên (bắt buộc bắt đầu bằng chữ "Bot")
→ nhận Bot Token gửi thẳng qua tin nhắn Zalo
```

Token dạng `số:mã_bí_mật` — giống hệt cách lấy token Telegram từ @BotFather.

**Có sẵn:** `sendMessage`, `sendImage`, `sendFile`, `sendVideo`, `sendAudio`, `sendTemplate`, `getUpdates`, `getMe`, webhook.
**SDK:** đã có cho Python, Go, TypeScript, PHP *(bản Python cập nhật 01/2026, viết theo kiểu `python-telegram-bot`)*.

### So sánh 4 đường

| | **A. Zalo Bot API** ⭐ | **B. Zalo OA** | **C. `zca-js`** | **D. Làm tay** |
|---|---|---|---|---|
| Chính thức? | ✅ | ✅ | ❌ | ✅ |
| Chi phí | **Miễn phí** | 2.500.000₫/năm | Miễn phí | Miễn phí |
| Chạy trong nhóm | ✅ *(phải @tag bot)* | ❌ **Không** | ✅ đọc mọi tin | ✅ |
| Nhắn riêng 1-1 | ✅ *(sau khi khách nhắn bot trước)* | ✅ | ✅ *(nếu đã kết bạn)* | ✅ |
| Tự thêm thành viên | ❌ | ❌ | ✅ | — |
| Tạo nhóm | ❌ | ❌ | ✅ | — |
| Gửi ảnh / file | ✅ (~5MB) | ✅ | ✅ | ✅ |
| Bình chọn / ghim tin | ❌ | — | ✅ | ✅ |
| **Rủi ro mất tài khoản cá nhân** | **Không** | Không | ⚠️ **Có** | Không |
| Cần SIM + tài khoản riêng? | Không | Không | ✅ Bắt buộc | Không |

> **Khuyến nghị: đường A.** Chính thức, miễn phí, chạy trong nhóm, không đụng gì tới tài khoản Zalo cá nhân.
> Chỉ cân nhắc đường C nếu **bắt buộc** cần tự thêm thành viên hoặc tạo nhóm tự động — và khi đó phải dùng SIM riêng.

### ⚠️ Giới hạn của Zalo Bot API — phải biết trước

| | |
|---|---|
| Tin nhắn text | **1 – 2.000 ký tự** → [mẫu tin nhắn dài](./mau-tin-nhan-bot.md) phải cắt bớt hoặc tách làm 2 |
| File / ảnh | ~5 MB |
| `getUpdates` và webhook | **Không dùng cùng lúc** — bật webhook rồi gọi `getUpdates` là lỗi 400 |
| Không có | reaction, luồng trả lời, bình chọn, lệnh gợi ý sẵn |
| Danh sách người dùng | **Không có API liệt kê** — bot chỉ nhắn riêng được cho ai **đã nhắn bot trước** |
| Trạng thái | Nền tảng còn mới, SDK bên thứ ba đánh dấu *"thử nghiệm"* |

### ✅ Cái hạn chế cuối lại giải được một vấn đề lớn

Bot chỉ nhắn riêng được cho người đã nhắn bot trước — nghe như hạn chế, nhưng nó **thay thế đúng chỗ đang bí**: Zalo chặn nhắn riêng cho người chưa kết bạn. Giờ **không cần kết bạn nữa, chỉ cần khách nhắn cho bot một lần**.

**Luồng đề xuất:**

```
1. Khách vào nhóm bằng link mời
2. Khách nhắn riêng cho bot MỘT LẦN  →  bot có chat_id
   ↳ xin luôn số tài khoản ở bước này, lưu lại
3. Từ đó: khách gửi link trong nhóm (@tag bot), hoặc nhắn riêng cho bot
4. Đơn duyệt  →  bot nhắn RIÊNG báo tin, rồi chuyển khoản
```

Không cần kết bạn · không bắt khách đọc số tài khoản công khai · không cược tài khoản nào.

### 📌 Mức tin cậy của thông tin trên

| Thông tin | Độ chắc |
|---|---|
| Zalo Bot là sản phẩm chính thức của Zalo Platforms | ✅ Tài liệu chính thức |
| Cách tạo bot qua OA "Zalo Bot Manager", token qua tin nhắn | ✅ Tài liệu chính thức |
| Giới hạn 1–2.000 ký tự | ✅ Tài liệu chính thức |
| **Bot chạy trong nhóm, cần @tag** | ⚠️ **Nguồn thứ ba + thread diễn đàn Zalo Developers** — tài liệu chính thức chưa nói rõ phần nhóm |
| **Miễn phí** | ⚠️ Chưa thấy Zalo công bố giá — có vẻ miễn phí, **chưa xác nhận** |

> **Cách kiểm chắc chắn trong 10 phút:** tạo thử một con bot, kéo vào một nhóm test, @tag thử. Miễn phí, không mất gì.

---

## 7b. Zalo OA — chỉ đọc nếu vẫn muốn đường B

### Về đường B — `zca-js`

Có thư viện **`zca-js`** làm bot chạy trên **tài khoản Zalo cá nhân**, giả lập trình duyệt Zalo Web. Vào được nhóm, đọc và gửi tin trong nhóm bình thường.

```
631 sao · 294 fork · 662 commit · MIT · đang phát triển tích cực
Đăng nhập bằng quét QR · hỗ trợ tin nhắn nhóm
```

Đây là **công cụ nhiều sao nhất trong toàn bộ hệ sinh thái này** — gấp 48 lần repo Shopee tốt nhất. Phần mềm tốt thật.

**Nhưng chính README của nó viết:**

> *"Using this API could get your account locked or banned. We are not responsible for any issues that may happen. Use it at your own risk."*

**Và đây là chỗ phải cân nhắc kỹ — cái bị treo KHÔNG phải tài khoản Shopee:**

```
Mất tài khoản Shopee Affiliate
   → mất ~2 tháng hoa hồng, phải đăng ký lại
   → đau, nhưng làm lại được

Mất tài khoản Zalo CÁ NHÂN
   → mất liên lạc với gia đình, bạn bè, công việc
   → mất toàn bộ lịch sử tin nhắn
   → ở Việt Nam đây là kênh liên lạc chính
   → KHÔNG mua lại được bằng tiền
```

> **Cân nhắc: đem kênh liên lạc chính của mình ra cược, để kiếm ~750.000₫/tháng.**
>
> Nếu vẫn làm: **dùng một số điện thoại riêng, một tài khoản Zalo riêng** — đừng cắm tài khoản chính. Chấp nhận là tài khoản đó có thể mất bất cứ lúc nào.

### zca-js làm được những gì trong nhóm

| Việc | Zalo OA | `zca-js` |
|---|---|---|
| Bot **đọc tin trong nhóm** | ❌ | ✅ `listener.on("message")` |
| Bot **trả lời tự động trong nhóm** | ❌ | ✅ `sendMessage(..., ThreadType.Group)` |
| **Thông báo vào nhóm** | ❌ | ✅ |
| **Tự thêm thành viên vào nhóm** | ❌ | ✅ `addUserToGroup`, `inviteUserToGroups` |
| **Tạo nhóm mới** | ❌ | ✅ `createGroup` |
| Xoá thành viên | ❌ | ✅ `removeUserFromGroup` |
| Đổi tên / ảnh nhóm, đổi trưởng nhóm | ❌ | ✅ |
| Tạo bình chọn, ghi chú, ghim tin | ❌ | ✅ `createPoll`, `createNote`, `pinConversations` |
| Gửi ảnh / sticker / voice / thu hồi tin | ❌ | ✅ |
| Tìm người, gửi lời mời kết bạn | ❌ | ✅ `findUser`, `sendFriendRequest` |

Tài liệu tiếng Việt: `tdung.gitbook.io/zca-js`

### ⚠️ Ba điều bắt buộc phải biết trước khi dùng

**① `addUserToGroup` là hàm nguy hiểm nhất trong cả bộ**

Kéo người lạ vào nhóm hàng loạt chính là hành vi Zalo chống spam mạnh tay nhất.

> **Đừng dùng nó để kéo người lạ. Dùng link mời nhóm, để người ta tự bấm vào.**
> Chậm hơn, nhưng không bị treo trong tuần đầu.

**② Một tài khoản chỉ chạy được MỘT listener**

README ghi rõ: *mở Zalo trên trình duyệt là listener đang chạy bị ngắt.*

> Tài khoản chạy bot thì **không dùng Zalo Web trên đó được nữa**.
> Đây là **bắt buộc kỹ thuật**, không phải lời khuyên: phải có **SIM riêng + tài khoản Zalo riêng**.

**③ Zalo chặn nhắn riêng cho người chưa kết bạn — cái này làm hỏng luồng hiện tại**

Repo có lỗi đang mở: `"Không thể nhận tin nhắn từ bạn"`.

Nhìn lại [mẫu tin nhắn](./mau-tin-nhan-bot.md) số 3️⃣: *đơn đã duyệt → nhắn riêng xin số tài khoản*. **Bước đó có thể bị chặn.** Trong nhóm thì bot nói thoải mái, nhắn riêng người chưa kết bạn thì không.

**Ba cách xử lý:**

| Cách | Ưu | Nhược |
|---|---|---|
| Bắt kết bạn trước khi nhận đơn đầu | Đơn giản | Thêm ma sát, mất khách |
| Xử lý hết trong nhóm | Không cần kết bạn | Khách phải gửi số tài khoản **công khai** — không ai muốn |
| ⭐ **Thu số tài khoản MỘT LẦN lúc vào nhóm**, lưu lại | Sau đó không cần nhắn riêng. Đơn duyệt chỉ báo trong nhóm rồi chuyển luôn | Bạn **giữ số tài khoản của mấy trăm người** → phải nói rõ với họ và giữ cẩn thận *(Luật Bảo vệ dữ liệu cá nhân, hiệu lực 01/01/2026)* |

### Khuyến nghị theo giai đoạn

| Giai đoạn | Làm gì |
|---|---|
| **10 đơn đầu** | **Nhóm Zalo làm tay** — miễn phí, hợp lệ, không cược gì. Chậm hơn bot đúng vài chục giây/đơn |
| **Vài chục khách** | Vẫn làm tay, hoặc dựng bot Telegram song song |
| **Vài trăm khách** | Nhóm thường chỉ chứa 100 người → phải nâng **Cộng đồng** (1.000). Lúc này làm tay bắt đầu đuối, mới tính tới bot Zalo — **với tài khoản riêng** |

**Ở giai đoạn 10 đơn đầu, thứ cần đo là "khách có chịu chờ 50–70 ngày không". Câu đó không cần bot nào để trả lời.**

---

### Bảng giá Zalo OA

Từ **01/06/2026** Zalo đổi bảng giá. Muốn dùng **API hoặc chatbot** thì phải mua gói:

| Gói | Giá | Dùng API được? |
|---|---|---|
| Cơ bản | Miễn phí | ❌ **Không** |
| Tiêu chuẩn | 1.000.000₫/năm | ❌ **Không** |
| **Tăng trưởng** | **2.500.000₫/năm** *(~208.000₫/tháng)* | ✅ Có — 100 request/phút, 10 kịch bản chatbot |
| Toàn diện | 6.000.000₫/năm | ✅ Có — 2.000 request/phút |

### Vì sao khoan mua

```
Lãi mỗi tháng           ██████████████████████████████  ~750.000₫
Zalo Tăng trưởng ăn     ████████                        ~208.000₫
```

> **Zalo ăn 28% lợi nhuận, trước khi bạn có một khách nào.**

**Khuyến nghị:** chạy Telegram trước. Khi nào có **50 khách quen thật** và họ kêu muốn dùng Zalo thì mới mua. Lúc đó 208 nghìn/tháng là chi phí có căn cứ — bây giờ thì là đánh cược.

*(Nếu bắt buộc phải có Zalo ngay vì khách của bạn chỉ dùng Zalo: giai đoạn đầu cứ nhắn tay qua Zalo cá nhân. Không cần OA, không cần API, không tốn đồng nào. Chỉ tốn công.)*

---

## 8. Google — để ghi sổ giai đoạn đầu

- Một **Google Sheet** với các cột:

```
Ngày | Khách | Link gốc | Link aff | Giá đơn | Hoa hồng ước tính |
Trạng thái | Ngày Shopee duyệt | Hoa hồng thật | Tiền hoàn | Ngày đã chuyển
```

Đủ dùng trong nhiều tháng. **Đừng dựng database vội.**

---

## 9. Chỗ chạy bot 24/7 — chỉ khi đã có bot

| Lựa chọn | Chi phí |
|---|---|
| Máy tính ở nhà | 0₫ (nhưng phải bật liên tục) |
| VPS rẻ trong nước / nước ngoài | 50.000 – 100.000₫/tháng |
| Gói miễn phí của các nền tảng cloud | 0₫ (có giới hạn) |

**Chưa cần nghĩ tới ở giai đoạn chạy tay.**

---

## ✅ Việc hôm nay, theo thứ tự

```
[ ] 1. Mở tài khoản Shopee Affiliate → tìm mục Open API      ⭐ 5 phút, quyết định tất cả
[ ] 2. Nếu chưa có tài khoản affiliate → đăng ký ngay        (chờ 3–7 ngày, làm sớm)
[ ] 3. Kiểm xem đủ 500 follower chưa, hay phải đi đường KOC
[ ] 4. Cập nhật số tài khoản ngân hàng trên affiliate.shopee.vn
[ ] 5. Tạo bot Telegram qua @BotFather                        (5 phút, miễn phí)
[ ] 6. Tạo Google Sheet ghi sổ
[ ] 7. Tạo bot Zalo qua OA "Zalo Bot Manager"          (5 phút, miễn phí)
[ ] 8. KHÔNG mua gói Zalo OA — không cần
```

---

## ❌ Những tài khoản ĐỪNG tạo

| Đừng | Vì sao |
|---|---|
| Tài khoản affiliate thứ hai (kể cả đứng tên người nhà) | Vi phạm *"vận hành nhiều tài khoản liên kết"* → khoá hết |
| Mua/thuê tài khoản affiliate của người khác | Vi phạm nặng hơn |
| Gói Zalo OA 2.500.000₫/năm | **Không cần** — Zalo Bot API chính thức đã miễn phí và chạy được trong nhóm. OA thì ngược lại, **không** vào nhóm được |
| Ví điện tử riêng để giữ tiền khách | Có thể phải xin phép Ngân hàng Nhà nước |
