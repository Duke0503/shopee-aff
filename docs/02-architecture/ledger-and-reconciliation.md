# Kiến trúc cuốn sổ + đối soát

> Ngày: 10/09/2026
> Cài đặt: hoàn **80%** · trả **sau khi Shopee duyệt**
> Đi kèm: [Kế hoạch](./ke-hoach-trien-khai.md) · [Tài khoản](./danh-sach-tai-khoan.md) · [Mẫu tin nhắn](./mau-tin-nhan-bot.md)

---

## 🔑 Điều quan trọng nhất — đọc trước khi làm bất cứ gì

Shopee trả về báo cáo đơn hàng **của tài khoản bạn**. Báo cáo đó nói: *"có đơn 350k, hoa hồng 13.800₫, đã duyệt"*.

**Nó KHÔNG nói đơn đó của khách nào.**

Không biết của ai thì không trả tiền cho ai được. Cuốn sổ vô nghĩa.

### Lời giải: `sub_id`

Khi tạo link, Shopee cho bạn gắn kèm **tối đa 5 mã tự đặt** vào link. Bạn nhét **mã khách** vào đó. Báo cáo sau này trả về **kèm nguyên cái mã**.

```
Tạo link cho chị Vân   →   subId1 = "K0042"
                                ↓
                       (50–70 ngày sau)
                                ↓
Báo cáo Shopee trả về  →   đơn #88213 · 13.800₫ · đã duyệt · subId1 = "K0042"
                                ↓
                       → của chị Vân → hoàn 11.040₫
```

> ### ⚠️ Quên gắn `sub_id` ở đơn đầu tiên là hỏng vĩnh viễn.
>
> Link đã tạo rồi **không gắn lại được**. Những đơn đó bạn **mãi mãi không biết của ai** — và chỉ phát hiện ra sau 2 tháng.
>
> **Kể cả tuần đầu chạy tay 10 đơn, vẫn phải điền `sub_id`.** Không thì 10 đơn đó vứt đi.

### Quy ước đặt mã

| Ô | Đựng gì | Ví dụ |
|---|---|---|
| `subId1` | **Mã khách** | `K0042` |
| `subId2` | **Mã lần tạo link** | `R260910-0187` |
| `subId3` | Kênh | `nhom1` / `rieng` |

Giữ mã **ngắn và không dấu**. ⚠️ *Chưa xác minh Shopee giới hạn bao nhiêu ký tự — thử trên trang explorer trước.*

**Đừng nhét tên thật, số điện thoại hay bất cứ gì nhận dạng được vào `sub_id`** — nó nằm trong đường link, ai cũng nhìn thấy.

---

## 1. Cuốn sổ gồm 3 bảng

### Bảng 1 — `KHACH`

Mỗi người một dòng. Ghi một lần, dùng mãi.

| Cột | Nội dung | Ghi chú |
|---|---|---|
| `ma_khach` | `K0042` | Chính là `subId1` |
| `zalo_id` | Mã người dùng Zalo | Từ tin nhắn gửi tới bot |
| `chat_id_rieng` | Mã khung chat riêng | ⚠️ Chỉ có **sau khi khách nhắn riêng cho bot ít nhất 1 lần**. Không có thì không nhắn riêng được |
| `ten_hien_thi` | Tên trên Zalo | |
| `ngan_hang`, `so_tk`, `ten_chu_tk` | Thông tin nhận tiền | Thu **một lần** lúc khách vào |
| `ngay_dong_y` | Ngày khách đồng ý cho lưu thông tin | Bắt buộc — Luật Bảo vệ dữ liệu cá nhân hiệu lực 01/01/2026 |
| `trang_thai` | `hoat_dong` / `da_roi` | |

### Bảng 2 — `LAN_TAO_LINK`

Mỗi lần khách gửi link là một dòng. **Không phải mỗi dòng đều thành đơn.**

| Cột | Nội dung |
|---|---|
| `ma_lan` | `R260910-0187` (chính là `subId2`) |
| `ma_khach` | `K0042` |
| `thoi_diem` | Lúc tạo link |
| `link_goc` | Link khách gửi |
| `link_aff` | Link đã tạo |
| `hoa_hong_uoc_tinh` | Số hiển thị cho khách lúc đó |
| `trang_thai` | `dang_cho` → `co_don` / `het_han` |

**Vì sao cần bảng này riêng:** khách bấm link nhưng không mua thì sao? Sau **7 ngày** (thời gian Shopee lưu link) mà không có đơn nào → chuyển `het_han`.

Không tách ra thì bạn không bao giờ biết **cứ 100 link thì bao nhiêu ra đơn** — con số đó quyết định bạn có nên làm tiếp không.

### Bảng 3 — `DON` ⭐ *(cuốn sổ chính)*

| Cột | Nội dung | Ghi chú |
|---|---|---|
| `ma_don` | Mã đơn từ Shopee | |
| `ma_khach` | Lấy từ `subId1` trong báo cáo | |
| `ma_lan` | Lấy từ `subId2` | |
| `gia_don` | Giá trị đơn | |
| `hoa_hong_uoc_tinh` | Số đã báo khách | |
| **`hoa_hong_thuc`** | **Số Shopee thật sự duyệt** | ⭐ **Phải là cột RIÊNG.** Luôn lệch với ước tính |
| `tien_hoan` | = `hoa_hong_thuc` × 80% | **Chỉ tính khi đã duyệt** |
| `trang_thai` | xem dưới | |
| `ngay_ghi_nhan` / `ngay_duyet` / `ngay_chuyen_tien` | Mốc thời gian | |
| `ly_do_hong` | Nếu đơn hỏng | Để nhắn khách |

> **Ước tính và số thật phải là hai cột riêng.** Chúng luôn lệch — khách dùng thêm voucher, giá đổi, shop tắt hoa hồng. Trả tiền theo **số thật**, không bao giờ theo ước tính.

---

## 2. Vòng đời một đơn

```
        khách gửi link
              │
              ▼
      ┌───────────────┐
      │   dang_cho    │  link đã tạo, chưa biết có mua không
      └───────┬───────┘
              │
      ┌───────┴────────┐
      │                │
 7 ngày trôi qua   Shopee ghi nhận đơn
      │                │
      ▼                ▼
 ┌─────────┐    ┌─────────────┐
 │ het_han │    │  cho_duyet  │  ← nhắn khách "đã ghi nhận đơn"
 └─────────┘    └──────┬──────┘
                       │
              ┌────────┴────────┐
              │                 │
        Shopee duyệt      huỷ / trả hàng
              │                 │
              ▼                 ▼
      ┌──────────────┐    ┌─────────┐
      │   da_duyet   │    │  hong   │ ← nhắn khách báo tin
      └──────┬───────┘    └─────────┘
             │  ← nhắn khách + chuyển tiền
             ▼
      ┌──────────────┐
      │   da_tra     │  KẾT THÚC
      └──────────────┘
```

### 🔒 Bốn luật sắt

| # | Luật | Vì sao |
|---|---|---|
| 1 | **Không bao giờ chuyển tiền khi chưa ở `da_duyet`** | Ở mức hoàn 80%, trả sớm là **lỗ chắc chắn** về mặt toán học |
| 2 | **Một đơn chỉ trả MỘT lần** | Đã có `ngay_chuyen_tien` thì bỏ qua, không xử lý lại |
| 3 | **Trả theo `hoa_hong_thuc`, không theo ước tính** | Ước tính luôn cao hơn |
| 4 | **Trạng thái chỉ đi một chiều, không sửa đè** | Mọi thay đổi ghi thêm dòng lịch sử, không ghi đè |

**Luật số 2 quan trọng hơn nó trông:** việc đối soát chạy đi chạy lại trên các khoảng thời gian chồng nhau. Không có khoá này thì **một đơn bị trả tiền hai, ba lần**.

---

## 3. Việc đối soát

### 3.1 — Lịch của Shopee, và lịch của bạn

Shopee chia 2 đợt mỗi tháng:

```
Đơn ngày 16 → cuối tháng T-1   →  Shopee mở đối soát từ ngày 11 tháng T
Đơn ngày  1 → 15 tháng T       →  Shopee mở đối soát từ ngày 24 tháng T
```

**Nên việc đối soát của bạn chạy ngày 12 và ngày 25** — sau Shopee một ngày cho chắc.

```
   T-1                            T
 ├──────┬──────┤            ├──────┬──────┤
 1     15     30            1     15     30
        └── đơn ────┐        │      │
                    └────────┤      │
                    Shopee mở│      │
                    đối soát ▼      │
                          ngày 11   │
                          ┌─────────┘
                bạn chạy ▼
                     NGÀY 12

                    đơn 1–15 tháng T ──┐
                                       ▼
                            Shopee mở ngày 24
                            bạn chạy NGÀY 25
```

### 3.2 — Hai việc chạy tự động, khác nhau hẳn

| | **Việc HÀNG NGÀY** | **Việc ĐỐI SOÁT** |
|---|---|---|
| Chạy lúc nào | Mỗi ngày 1 lần | Ngày **12** và **25** |
| Làm gì | Tìm đơn **mới ghi nhận** | Cập nhật đơn **đã duyệt / hỏng** |
| Đổi trạng thái | `dang_cho` → `cho_duyet`<br>`dang_cho` → `het_han` *(quá 7 ngày)* | `cho_duyet` → `da_duyet` / `hong` |
| Nhắn khách | "Đơn đã được ghi nhận" | "Đã duyệt, chuyển tiền" / "Đơn hỏng" |

**Việc hàng ngày quan trọng hơn nó trông.** Nó là thứ báo cho khách biết bạn không quên họ, trong suốt 2 tháng im lặng.

### 3.3 — Hai đường lấy dữ liệu, cùng một cách khớp

Tuỳ vào việc tài khoản bạn có `conversionReport` hay không:

```
┌─────────────────────────┐     ┌─────────────────────────┐
│  CÓ conversionReport    │     │  KHÔNG có               │
│  → gọi API lấy đơn      │     │  → tải file từ trang    │
│                         │     │    affiliate, đọc lên   │
└───────────┬─────────────┘     └───────────┬─────────────┘
            │                               │
            └───────────┬───────────────────┘
                        ▼
            ┌───────────────────────┐
            │  KHỚP BẰNG sub_id     │  ← phần này DÙNG CHUNG
            │  cập nhật cuốn sổ     │
            └───────────────────────┘
```

> **Thiết kế sao cho phần "khớp và cập nhật sổ" tách rời khỏi phần "lấy dữ liệu ở đâu".**
>
> Hôm nay tải file tay, mai xin được API thì chỉ thay phần lấy dữ liệu — không phải viết lại cuốn sổ.

### 3.4 — Các bước của một lần đối soát

```
1. Lấy danh sách đơn trong khoảng thời gian của đợt này
2. Với mỗi đơn:
     - đọc subId1  → biết khách nào
     - đọc subId2  → biết lần tạo link nào
3. Đơn chưa có trong sổ?           → thêm mới, trạng thái cho_duyet
4. Đơn đã có, Shopee báo ĐÃ DUYỆT?
     - đã có ngay_chuyen_tien?      → BỎ QUA (luật số 2)
     - chưa?                        → ghi hoa_hong_thuc
                                    → tien_hoan = hoa_hong_thuc × 80%
                                    → chuyển da_duyet
                                    → xếp hàng chờ nhắn khách
5. Đơn đã có, Shopee báo HUỶ/TRẢ?  → chuyển hong, ghi lý do, xếp hàng nhắn khách
6. Đơn có subId lạ / không đọc được → cho vào MỤC CẦN XEM TAY
7. Ghi log: xử lý bao nhiêu đơn, đổi bao nhiêu trạng thái, lỗi gì
```

**Bước 6 bắt buộc phải có.** Sẽ luôn có đơn không khớp — link tạo tay quên điền `sub_id`, khách bấm nhầm, mã bị cắt. **Đừng để chương trình tự đoán. Để đó cho người xem.**

---

## 4. Ba con số phải theo dõi

Cuốn sổ không chỉ để trả tiền — nó là chỗ duy nhất trả lời được ba câu này:

| Con số | Tính thế nào | Vì sao quan trọng |
|---|---|---|
| **Tỷ lệ ra đơn** | số `co_don` ÷ tổng số lần tạo link | 100 link ra mấy đơn? Thấp quá thì khách chỉ hỏi cho vui |
| **Tỷ lệ hỏng** | số `hong` ÷ (`da_duyet` + `hong`) | Đang đoán 12%. Nếu thật là 25% thì thu nhập giảm một phần tư |
| **Hoa hồng trung bình thật** | tổng `hoa_hong_thuc` ÷ tổng `gia_don` | ⭐ Con số quan trọng nhất. Đang đoán 4,5% |

**Chỉ cần 30 đơn đầu là ba con số này đã có ý nghĩa.** Lúc đó [bảng thu nhập](./shopee-cashback-bot-analysis.md#32--bảng-thu-nhập-theo-số-đơn) thành số của bạn, không còn là ước lượng.

### Còn một con số nữa — và nó là lựa chọn đạo đức

**Tỷ lệ khách bỏ quên:** đơn ở `da_duyet` mà khách không đòi.

Với luồng cũ (đơn duyệt xong mới hỏi số tài khoản) thì con số này khá cao — và **đó chính là nguồn lãi ẩn của phần lớn nhóm hoàn tiền**.

Với luồng mới (thu số tài khoản một lần lúc vào nhóm, duyệt xong tự chuyển) thì gần như bằng 0.

> **Hai lựa chọn, nói thẳng:**
> - **Tự động chuyển** → mất phần lãi từ khách quên, được lòng tin và khách quay lại
> - **Chờ khách đòi** → giữ được phần đó, nhưng bạn đang kiếm tiền từ việc khách quên
>
> Đây không phải câu hỏi kỹ thuật. Cuốn sổ hỗ trợ cả hai — chọn cái nào là việc của bạn.

---

## 5. Nên dùng gì để làm

Nguyên tắc: **chọn thứ chán nhất chạy được.**

| Giai đoạn | Cuốn sổ | Bot | Việc chạy định kỳ |
|---|---|---|---|
| **10 đơn đầu** | Google Sheet | Không có — gõ tay | Tự mở Sheet xem ngày 12 và 25 |
| **~30 đơn/ngày** | Google Sheet hoặc SQLite | 1 tiến trình | Hẹn giờ chạy 1 lần/ngày |
| **Sau nữa** | SQLite / PostgreSQL | Vẫn 1 tiến trình | Như trên |

Ở mức 30 đơn/ngày = **900 dòng/tháng**. Google Sheet chịu được **nhiều năm**. Đừng dựng cơ sở dữ liệu vội.

### Đừng làm sớm

| Đừng | Vì sao |
|---|---|
| Nhiều máy chủ, hàng đợi, microservice | 900 dòng/tháng |
| Giao diện web quản trị | Google Sheet đã là giao diện rồi |
| Tự động chuyển khoản qua ngân hàng | Rủi ro cao, tiết kiệm vài phút. Chuyển tay đi |
| Hỗ trợ nhiều sàn cùng lúc | Chưa chạy nổi một sàn |

---

## 6. Ba chỗ dễ vỡ nhất

### ⚠️ 1. Đối soát chạy hai lần → trả tiền hai lần

Việc đối soát chạy đi chạy lại trên khoảng thời gian chồng nhau. Nếu chỉ kiểm *"đơn này đã duyệt chưa"* mà không kiểm *"đã trả tiền chưa"* thì **trả trùng**.

**Cách chặn:** trước khi chuyển tiền, luôn kiểm `ngay_chuyen_tien` **đã có giá trị chưa**. Có rồi thì dừng.

### ⚠️ 2. Tin nhắn Zalo tối đa 2.000 ký tự

[Mẫu tin nhắn chính](./mau-tin-nhan-bot.md) hiện đang dài. Trên Zalo Bot API sẽ bị cắt.

**Cách xử lý:** dùng bản rút gọn làm mặc định, chi tiết để trong lệnh `/luatchoi`.

### ⚠️ 3. Không nhắn riêng được cho khách chưa nhắn bot

Bot chỉ nhắn riêng được cho ai **đã nhắn bot ít nhất một lần**.

**Cách xử lý:** bắt buộc bước "nhắn `/batdau` cho bot" ngay khi vào nhóm — lấy `chat_id_rieng` và số tài khoản luôn ở bước đó. Chưa có `chat_id_rieng` thì **không nhận đơn**.

Không làm bước này thì 2 tháng sau đơn duyệt xong **không có cách nào báo cho khách**.

---

## 7. Thứ tự làm

| # | Việc | Xong thì có gì |
|---|---|---|
| 1 | **Google Sheet 3 bảng + quy ước `sub_id`** | Chạy tay được ngay hôm nay |
| 2 | **Chạy tay 10 đơn, luôn điền `sub_id`** | Có dữ liệu thật, biết chỗ nào vướng |
| 3 | **Phần khớp `sub_id` + cập nhật sổ** | Lõi của cả hệ thống. Chạy trên file tải tay cũng được |
| 4 | **Việc đối soát ngày 12 và 25** | Hết phải dò tay |
| 5 | **Nối bot Zalo — nhận link, trả tin nhắn** | Hết phải gõ tay |
| 6 | **Tự tạo link qua API** | Hết phải bấm nút |
| 7 | **Việc hàng ngày + tin nhắn tự động** | Khách hết phải hỏi |

> **Để ý:** phần tạo link tự động — thứ ai cũng nghĩ tới đầu tiên — nằm ở **vị trí thứ 6**.
>
> Vì nó chỉ tiết kiệm 30 giây mỗi đơn. Còn cuốn sổ và việc đối soát là thứ giữ cho bạn **không quỵt khách suốt 50–70 ngày**.
