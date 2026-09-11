# Bot hoàn tiền Shopee — Nghề tay trái, cần biết gì

> Ngày: 10/09/2026 · **Bản v7** — đã sửa theo bản rà soát v8 của team
>
> **Cách chạy đã chốt:** hoàn **80%** · trả **sau khi Shopee duyệt**
>
> Đi kèm: [Kiến trúc sổ](./kien-truc-so-va-doi-soat.md) · [Tài khoản](./danh-sach-tai-khoan.md) · [Kế hoạch](./ke-hoach-trien-khai.md) · [Mẫu tin nhắn](./mau-tin-nhan-bot.md)

---

## 🔻 Đọc trước tiên: tài liệu này KHÔNG cho bạn con số thu nhập

Bản trước có bảng *"30 đơn/ngày → 750.000₫/tháng"*. **Đã bỏ.**

Lý do: nó dựng trên ba con số đoán mò — hoa hồng 4,5%, đơn trung bình 230.000₫, huỷ/trả 12%. **Không con số nào là của bạn.** Shopee nói rõ tỷ lệ hoa hồng thay đổi theo thời điểm, ngành hàng, sản phẩm, kênh, đối tượng và điều kiện đơn.

> **Thu nhập của bạn do đúng ba con số quyết định, và cả ba chỉ có được bằng cách chạy thật rồi đo:**
>
> ```
> Effective Commission Rate  =  tổng hoa hồng được duyệt ÷ tổng GMV đơn được duyệt
> Valid Rate                 =  số đơn được duyệt ÷ tổng đơn phát sinh
> AOV approved               =  tổng GMV đơn được duyệt ÷ số đơn được duyệt
> ```
>
> Đo sau **100–300 đơn đầu**. Trước đó, mọi con số thu nhập đều là bịa.

Hệ thống đã tính sẵn ba số này — chạy `hoantien chi-so`.

---

## 1. Ba con số CHẮC theo nguồn chính thức

Chỉ ba thứ này là chắc. Mọi thứ khác phải đo.

### 1.1 — Phí dịch vụ **0,98%**

Nguồn: [Shopee Help 174381](https://help.shopee.vn/portal/10/article/174381)

- Tính trên **tổng giá trị Đối tác được thụ hưởng** từ chương trình Affiliate
- **Đã bao gồm VAT** — nguyên văn: *"Phí Dịch Vụ này đã bao gồm thuế giá trị gia tăng theo quy định hiện hành"*
- Shopee cấn trừ trực tiếp vào kỳ đối soát hàng tháng
- Áp dụng từ **kỳ đối soát 16/7/2025 – 31/7/2025**

⚠️ Nhân 0,98% cho từng đơn chỉ là cách **phân bổ để tính**. Chốt sổ tháng thì lấy phí **thực tế trên đối soát**.

### 1.2 — Khấu trừ TNCN **10%**

Nguồn: [Shopee Help 163104](https://help.shopee.vn/portal/10/article/163104)

- **10%** với khoản chi **từ 2.000.000₫/lần trở lên**
- Đây là **nộp trước tại nguồn** — **không phải** nghĩa vụ thuế cuối cùng của cả năm

### 1.3 — Thời điểm chốt tỷ lệ hoa hồng

Nguồn: [Shopee Help 122941](https://help.shopee.vn/portal/10/article/122941)

Hoa hồng tính theo tỷ lệ **tại thời điểm người mua ĐẶT ĐƠN** — không phải lúc bạn tạo link.

> **Nghĩa là % bot báo chỉ là ước tính.** Tiền hoàn phải tính trên **hoa hồng được duyệt**.

---

## 2. Hoa hồng ghép từ hai phần, và không có trần chung

```
Tổng hoa hồng  =  Hoa hồng Shopee  +  Hoa hồng XTRA  (+ thưởng khác nếu có)
                  (Shopee chi)         (Người bán/Thương hiệu chi)
```

Nhìn lại ảnh bot của bạn:
```
🔶 Shopee: 7% (... Max: 40.000₫)   ← trần này thuộc CẤU PHẦN SHOPEE
🔶 Shop:   5% (...)                 ← XTRA, Shopee mô tả là KHÔNG bị giới hạn
```

> ### ❌ Bản trước sai chỗ này — đã sửa
>
> Bản trước viết *"trần tổng hoa hồng 70.000₫/đơn"*. **Không đủ căn cứ.**
>
> Chữ **"Max 40.000₫"** trong ảnh nằm ở **cấu phần Shopee**, không phải trần tổng. Còn hoa hồng thương hiệu/XTRA thì Shopee mô tả là **không bị giới hạn**.
>
> **Quy tắc:** trần nào hiện trên Dashboard/offer của chính sản phẩm đó thì áp đúng cho cấu phần đó. **Không tự suy ra một trần chung.**

### Vì sao hoa hồng có thể thấp hơn bạn tưởng

Shopee trả khác nhau cho **khách mới** (chưa từng mua Shopee) và **khách đã từng mua** — khách mới cao hơn nhiều. Bảng tham khảo cho thấy khách cũ chỉ khoảng 1–3%, khách mới 5–13%.

⚠️ **Đây là cơ chế đáng biết, KHÔNG phải quy luật để tính tiền.** Bản trước biến bảng tham khảo này thành *"khách cũ chỉ 1,1–2,8%"* và *"khách cashback gần như 100% là khách cũ"* — **cả hai đều là suy đoán, đã bỏ.**

Cơ chế này chỉ để bạn hiểu **vì sao** Effective Commission Rate đo được có thể thấp. Con số thật vẫn phải đo.

---

## 3. Tiền chia thế nào — và một quyết định phải chốt trước

### 3.1 — Công thức

```
C = hoa hồng gộp ĐƯỢC SHOPEE DUYỆT cho đơn đó
F = phí dịch vụ       = 0,98% × C
T = thuế phân bổ      = 10% × C   (0 nếu kỳ đó không bị khấu trừ)
B = cashback danh nghĩa = 80% × C
U = tiền user thực nhận
M = bạn giữ, TRƯỚC chi phí vận hành
```

### 3.2 — Hai chính sách, khác nhau gấp đôi

| | **A. Chủ chịu thuế** | **B. Trừ thuế vào cashback của user** |
|---|---|---|
| User thực nhận | **80% × C** — ổn định | **70% × C** khi bị khấu trừ |
| Bạn giữ trước vận hành | **~9,02% × C** | **~19,02% × C** |
| Quảng cáo trung thực là | "hoàn 80%" | **"hoàn 70%"** |

**Ví dụ — đơn 300.000₫, Shopee duyệt hoa hồng 27.000₫:**

| | Chủ chịu | User chịu |
|---|---|---|
| User nhận | 21.600₫ (80,0%) | **18.900₫ (70,0%)** |
| Bạn giữ | 2.435₫ (9,02%) | **5.135₫ (19,02%)** |

### 3.3 — 🚩 Cảnh báo về chính sách B

Chính sách B cho biên gấp đôi. Nhưng có một chỗ phải nhìn thẳng:

> **Ở quy mô 30 đơn/ngày, hoa hồng của bạn khoảng 8–10 triệu/tháng — LUÔN vượt mốc 2 triệu.**
>
> Nghĩa là **kỳ nào cũng bị khấu trừ**, nghĩa là **user KHÔNG BAO GIỜ nhận 80%. Luôn luôn là 70%.**

**Vậy quảng cáo "hoàn 80%" là con số không bao giờ xảy ra.**

Bản rà soát v8 tự viết ở mục 6: *"không nên ghi với user rằng user là người nộp thuế — điều đó không đúng bản chất"*. Nhưng chính sách B **làm đúng điều đó về mặt kinh tế**, chỉ là không nói ra.

Còn một vấn đề nữa: nếu tháng nào đó không vượt mốc 2 triệu, cashback nhảy lên 80%. **Khách không nhìn thấy, không kiểm soát, không đoán được biến này** — nó là tổng doanh thu tháng của bạn. Hai khách mua giống hệt nhau sẽ nhận khác nhau.

**Chọn một, đừng đứng giữa:**

| | Quảng cáo | User nhận | Bạn giữ |
|---|---|---|---|
| ✅ **A** | "hoàn 70%" | 70% ổn định | ~19% |
| ✅ **B** | "hoàn 80%" | 80% ổn định | ~9% |
| ❌ **C** | "hoàn 80%" | thực ra 70% | ~19% |

**70% vẫn nằm trong vùng thị trường (70–90%)**, ổn định, và bạn nói đúng những gì bạn làm. Cách C là thứ đẻ ra mấy thread *"cú lừa bot hoàn tiền"* trên diễn đàn.

*(Hệ thống hỗ trợ cả hai — đổi bằng `CHINH_SACH_THUE` trong `.env`. Chọn `user_chiu` thì chương trình tự in cảnh báo này ra.)*

### 3.4 — 19,02% CHƯA phải lợi nhuận

Con số đó mới chỉ trừ cashback và phí Shopee. **Chưa trừ:** máy chủ, phí chuyển khoản, giới thiệu, marketing, hỗ trợ khách, đối soát sai, và nghĩa vụ thuế cuối năm nếu còn phát sinh.

```
Lợi nhuận thật = Hoa hồng duyệt × 19,02%  −  toàn bộ chi phí vận hành
```

---

## 4. Thuế cuối năm

### 4.1 — Cái bẫy vẫn còn nguyên

> **Thuế tính trên hoa hồng GỘP — kể cả phần bạn đã cho khách.**

Tiền chuyển cho một nick Zalo không có hợp đồng, không hoá đơn → về mặt thuế **khoản đó không tồn tại**. Bạn cho đi rồi mà vẫn chịu thuế trên nó.

### 4.2 — Số 2026 *(đã sửa)*

Luật Thuế TNCN **109/2025/QH15**, áp dụng cho kỳ tính thuế 2026:

```
Giảm trừ bản thân:        15,5 triệu/tháng  =  186 triệu/năm
Giảm trừ người phụ thuộc:  6,2 triệu/tháng/người
```

> ❌ **Bản trước ghi 132 triệu/năm — sai.** Đó là mức cũ (11 triệu/tháng). Mức mới cao hơn **54 triệu/năm**.

### 4.3 — Đừng tính tiền hoàn thuế vào lợi nhuận

10% Shopee giữ là **nộp trước**, không phải nghĩa vụ cuối cùng. Cuối năm có thể được hoàn hết, hoàn một phần, không được hoàn, **hoặc còn phải nộp thêm** — tuỳ tổng thu nhập và kết quả quyết toán.

> ❌ **Bản trước ghi "cuối năm gần như lấy lại hết" — đã bỏ.** Không thể kết luận trước khi biết toàn bộ thu nhập.

**Nguyên tắc:** trong báo cáo tháng, **không tính "thuế có thể được hoàn" vào lợi nhuận**. Có kết quả quyết toán thật mới ghi nhận.

### 4.4 — Nếu chọn chính sách B, phải chốt thêm một điều

Trong năm user đã bị giảm cashback vì phần 10%. Cuối năm nếu bạn được hoàn lại một phần thì sao?

- **Cách A** — khoản hoàn thuế thuộc về bạn. Đơn giản về vận hành.
- **Cách B** — hoàn bổ sung cho user. Minh bạch hơn, nhưng phải lưu phần thuế phân bổ theo từng đơn từng user và chi bổ sung sau quyết toán.

**Không định làm cách B thì điều khoản phải nói rõ ngay từ đầu.**

---

## 5. Rủi ro — nói đúng mức, không hù cũng không chủ quan

> ❌ **Bản trước ghi "rủi ro duy nhất là Shopee khoá tài khoản" — quá tuyệt đối, đã bỏ.**

### 5.1 — Trường hợp sạch mà hệ thống nên giữ

```
User tự gửi link
  → hệ thống tạo link bằng phương thức được phép
  → user tự bấm, tự đặt, tự thanh toán
  → không click ảo, không đơn ảo, không đặt hộ
  → không dùng công cụ tự động trái phép để đăng nhập/thao tác/thu thập dữ liệu Shopee
  → chỉ trả tiền khi hoa hồng ĐƯỢC DUYỆT
```

**Không được kết luận** *"có bot là chắc chắn bị ban"*. Cũng **không được kết luận** *"bot chỉ đổi link nên chắc chắn Shopee cho phép"*.

Nếu chạy nghiêm túc, phải bảo đảm **cách tạo link và lấy dữ liệu đúng điều khoản hiện hành**. Xem [Chính sách chống gian lận](https://help.shopee.vn/portal/10/article/199468) — 27 nhóm hành vi bị cấm, phạt tới 10.000.000₫ **mỗi lần, cộng dồn**.

### 5.2 — 🚩 Thứ tự chuốc vạ nhất, đã gỡ

Mẫu tin nhắn cũ có: *"tắt app Shopee chạy ngầm"* và *"KHÔNG vào Live/Video để mua"*.

Đó là hướng dẫn khách né hệ thống ghi nhận của Shopee, **do bot bạn gửi, Shopee lưu log**. ✅ Đã gỡ khỏi [mẫu mới](./mau-tin-nhan-bot.md).

### 5.3 — Các rủi ro khác vẫn còn

| Rủi ro | Ghi chú |
|---|---|
| Shopee đổi tỷ lệ hoa hồng | Tỷ lệ chốt lúc khách đặt đơn, không phải lúc tạo link |
| XTRA hết chiến dịch | Phần lớn hoa hồng đến từ đây, và nó tắt lúc nào cũng được |
| Đối thủ hoàn cao hơn | Khách trung thành với con số, không với bạn |
| Đối soát sai / đơn không khớp | Phải có mục **cần xem tay**, đừng để máy tự đoán |
| Dữ liệu cá nhân | Bạn giữ số tài khoản của khách — Luật BVDL cá nhân hiệu lực 01/01/2026 |
| Giữ tiền hộ khách | Đừng làm "ví" chờ đủ mức mới rút — có thể phải xin phép NHNN |

---

## 6. Thời gian đối soát và thanh toán

Nguồn: [Shopee Help 123042](https://help.shopee.vn/portal/10/article/123042)

| Đợt | Đơn hợp lệ trong | Đối tác kiểm tra | Shopee **dự kiến** thanh toán |
|---|---|---|---|
| **1** | Ngày 16 → cuối tháng T-1 | 5 ngày làm việc kể từ ngày **11** tháng T | Trong **30 ngày làm việc** kể từ khi nhận đủ chứng từ hợp lệ |
| **2** | Ngày 1 → 15 tháng T | 5 ngày làm việc kể từ ngày **24** tháng T | Như trên |

**Ghi nhận đơn:** khách phải đặt hàng thành công trong vòng **7 ngày** sau khi bấm link. Sau đó đơn vẫn phải đáp ứng điều kiện chương trình mới được công nhận hợp lệ.

### ❌ Đừng nói với khách "chắc chắn 50–70 ngày"

Bản trước ghi vậy. **50–70 ngày chỉ là ước lượng bảo thủ** (cộng thời gian chờ kỳ đối soát + 30 ngày làm việc). Đó **không phải cam kết** của Shopee.

**Nên ghi:**

> *"Cashback được thanh toán sau khi Shopee duyệt/đối soát hoa hồng. Thời gian phụ thuộc kỳ đối soát và thời điểm Shopee thanh toán thực tế."*

---

## 7. Đo cái gì, khi nào

### Ba chỉ số bắt buộc — đo sau 100–300 đơn đầu

| Chỉ số | Công thức | Ý nghĩa |
|---|---|---|
| **Effective Commission Rate** | tổng hoa hồng duyệt ÷ tổng GMV đơn duyệt | ⭐ Quan trọng nhất |
| **Valid Rate** | số đơn duyệt ÷ **tổng đơn phát sinh** | Thay cho "12% huỷ/trả" đã bỏ |
| **AOV approved** | tổng GMV đơn duyệt ÷ số đơn duyệt | Thay cho "230k" đã bỏ |

```
Đơn approved     = Đơn phát sinh × Valid Rate
Approved GMV     = Đơn approved × AOV approved
Hoa hồng gộp     = Approved GMV × Effective Commission Rate
Bạn giữ trước ops = Hoa hồng gộp × (9,02% hoặc 19,02%, tuỳ chính sách)
```

⚠️ **Valid Rate không bao giờ bằng 100%.** Đừng mô hình hoá bằng 100% — không sàn nào có 0% huỷ đơn. Chạy 85% / 90% / 95% cạnh nhau để nhìn độ nhạy.

### Bốn chỉ số nên xem hàng tháng

```
Đơn approved mỗi ngày
Effective Commission Rate
AOV approved
Số đơn trên mỗi user hoạt động mỗi tháng
```

10.000 user mà 20 đơn approved/ngày thì vẫn nhỏ. 2.000 user mà 100 đơn approved/ngày thì đáng giá hơn nhiều. **Đừng nhìn số user.**

---

## 8. Checklist trước khi chạy thật

```
[ ] Bot chỉ ghi "hoa hồng DỰ KIẾN", không hứa đó là số cuối cùng
[ ] Cashback chỉ chốt trên hoa hồng ĐƯỢC DUYỆT
[ ] Điều khoản ghi rõ cashback = bao nhiêu %, tính theo công thức nào
[ ] CHỐT chính sách thuế: chủ chịu (quảng cáo 80%) hay user chịu (quảng cáo 70%)
[ ] Nếu user chịu → chốt luôn: cuối năm được hoàn thuế thì xử lý sao
[ ] Không hard-code 4,5% / 7% / 12% thành tỷ lệ cố định
[ ] Không dùng trần 40k/70k như trần tổng
[ ] Không nói với khách "chắc chắn 50–70 ngày"
[ ] Đo Effective Commission Rate / Valid Rate / AOV approved sau 100–300 đơn
[ ] Chốt sổ tháng bằng phí dịch vụ THỰC TẾ trên đối soát, không phải 0,98% phân bổ
[ ] Không dùng công cụ tự động trái phép để thao tác/thu thập dữ liệu Shopee
[ ] Không click ảo, đơn ảo, đặt hộ
[ ] KHÔNG trả tiền trước khi hoa hồng được duyệt
```

---

## 9. Những gì đã sửa so với bản v6

| Đã bỏ / sửa | Vì sao |
|---|---|
| ~~"Hoa hồng trung bình 4,5%"~~ | Không có dữ liệu hệ thống thật |
| ~~"Đơn trung bình 230.000₫"~~ | AOV thị trường ≠ AOV của bạn |
| ~~"12% đơn huỷ/trả"~~ | Không có dữ liệu case thật → dùng **Valid Rate** đo được |
| ~~"Khách cũ chỉ 1,1–2,8%"~~ | Bảng tham khảo, không phải quy luật |
| ~~"Khách cashback gần như 100% là khách cũ"~~ | Suy đoán hành vi |
| ~~"Trần tổng 70.000₫/đơn"~~ | Trần thuộc cấu phần Shopee; XTRA không bị giới hạn |
| ~~"Phí 0,98% chưa xác minh, từ 16/5/2025"~~ | **Đã xác minh** — Help 174381, đã gồm VAT, từ kỳ **16/7/2025** |
| ~~"Giảm trừ 132 triệu/năm"~~ | **186 triệu/năm** theo Luật 109/2025/QH15 |
| ~~"Cuối năm gần như lấy lại hết thuế"~~ | Không thể kết luận trước quyết toán |
| ~~"Chắc chắn 50–70 ngày"~~ | Là ước lượng, không phải cam kết Shopee |
| ~~"Trần 300 USD/tháng cho tài khoản mới"~~ | Không có nguồn chính thức Shopee VN |
| ~~"Rủi ro duy nhất là bị khoá tài khoản"~~ | Quá tuyệt đối |
| ~~Bảng "30 đơn/ngày → 750.000₫"~~ | Dựng trên ba số đoán mò |
| **Thêm mới** | Cảnh báo chính sách 80%→70% (§3.3) |
| **Thêm mới** | Valid Rate không được mô hình hoá bằng 100% (§7) |

---

## Nguồn chính thức

**Shopee**
- [Phí dịch vụ Affiliate 0,98%](https://help.shopee.vn/portal/10/article/174381)
- [Thuế TNCN với Shopee Affiliate](https://help.shopee.vn/portal/10/article/163104)
- [Quy trình thanh toán & đối soát hoa hồng](https://help.shopee.vn/portal/10/article/123042)
- [Cách ghi nhận hoa hồng](https://help.shopee.vn/portal/10/article/122941)
- [Cách xem tỷ lệ hoa hồng KOL/KOC](https://help.shopee.vn/portal/10/article/123037)
- [Tìm hiểu hoa hồng KOL/KOC](https://help.shopee.vn/portal/10/article/190646)
- [Hoa hồng XTRA là gì](https://help.shopee.vn/portal/10/article/123085)
- [Chính sách chống hành vi gian lận](https://help.shopee.vn/portal/10/article/199468)
- [Điều khoản chương trình Affiliate](https://help.shopee.vn/portal/10/article/122944)

**Pháp luật**
- [Luật Thuế TNCN 109/2025/QH15 — giảm trừ gia cảnh 2026](https://xaydungchinhsach.chinhphu.vn/noi-dung-chinh-cua-luat-thue-thu-nhap-ca-nhan-so-109-2025-qh15-119260123144204743.htm)
- [Nghị định 117/2025 về quản lý thuế thương mại điện tử](https://www.meinvoice.vn/tin-tuc/35149/nghi-dinh-117-2025-nd-cp-ve-thue-thuong-mai-dien-tu/)
