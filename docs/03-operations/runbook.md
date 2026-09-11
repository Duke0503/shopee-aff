# Hệ thống chạy thế nào

> Ngày: 10/09/2026 · Viết cho người chưa đụng vào code bao giờ
>
> Cấu hình đã chốt: **hoàn 70%** *(có tháng lên 80%)* · **user chịu phần thuế** (`user_absorbs`) · trả **sau khi Shopee duyệt**

---

## 1. Dùng framework gì?

**Không dùng cái nào cả.** Chỉ đúng ba thứ:

| Thứ | Là gì | Phải cài không? |
|---|---|---|
| **Python** | Ngôn ngữ lập trình | Có, cài một lần |
| **SQLite** | Chỗ lưu dữ liệu | **Không** — có sẵn trong Python |
| **httpx** | Thư viện gọi API (Shopee, Zalo) | Tự cài khi chạy lệnh đầu tiên |

### Vì sao không dùng framework?

Framework (Django, Laravel, NestJS...) sinh ra để làm **website nhiều người truy cập cùng lúc**. Bạn không có website. Bạn có:

- một con bot nghe tin nhắn
- một cuốn sổ
- một việc chạy định kỳ mỗi tháng hai lần

Ở mức 30 đơn/ngày = **900 dòng dữ liệu một tháng**. Dùng framework cho việc này giống như thuê xe tải để chở một thùng mì.

> **Nguyên tắc: chọn thứ chán nhất mà chạy được.** Càng ít thứ thì càng ít thứ hỏng lúc 2 giờ sáng.

---

## 2. Database là gì, để ở đâu?

**SQLite — nói cho dễ hiểu: cuốn sổ của bạn là MỘT FILE trên máy.**

```
C:\Project\mmo\cashback.db     ← toàn bộ dữ liệu nằm trong đây
```

| Câu hỏi | Trả lời |
|---|---|
| Có phải cài MySQL / PostgreSQL không? | **Không** |
| Có phải chạy server nền không? | **Không** |
| Sao lưu thế nào? | **Copy cái file đó ra chỗ khác.** Xong |
| Xem dữ liệu thế nào? | Tải **DB Browser for SQLite** (miễn phí) → mở file → nhìn như Excel |
| Chứa được bao nhiêu? | Hàng triệu dòng. Bạn có 900 dòng/tháng |
| Khi nào phải đổi sang thứ khác? | Khi có nhiều máy cùng ghi một lúc. Còn lâu mới tới |

### Trong file đó có 6 bảng

| Bảng | Chứa gì |
|---|---|
| `customers` | Danh sách khách: mã, tên, số tài khoản, ngày đồng ý cho lưu |
| `link_requests` | Mỗi lần khách gửi link là một dòng |
| `orders` | ⭐ **Cuốn sổ chính** — mỗi đơn hàng một dòng |
| `state_history` | Nhật ký: đơn nào đổi trạng thái lúc nào. **Chỉ ghi thêm, không sửa đè** |
| `manual_review` | Đơn không khớp được — để đó cho người xem, máy không đoán |
| `reconciliation_runs` | Mỗi lần chạy đối soát ghi một dòng: đọc bao nhiêu đơn, đổi bao nhiêu trạng thái, lỗi gì |

---

## 3. Có ba thứ chạy, độc lập với nhau

Đây là chỗ dễ nhầm nhất. **Không phải một chương trình duy nhất.** Ba thứ riêng biệt, cùng đọc ghi một file:

```
        NGƯỜI DÙNG                  MÁY CỦA BẠN                    SHOPEE

  khách gửi link  ──────►  ┌────────────────────┐
  trong nhóm Zalo          │  ① BOT             │ ─── tạo link ──►  Open API
                           │  chạy liên tục     │ ◄── link + % ───
  ◄───── trả link ─────────│  24/7              │
                           └─────────┬──────────┘
                                     │ ghi
                                     ▼
                           ┌────────────────────┐
                           │   cashback.db      │   ← MỘT FILE
                           │   (cuốn sổ)        │
                           └─────────▲──────────┘
                              đọc    │    ghi
                           ┌─────────┴──────────┐
  ◄─ "đã ghi nhận đơn" ────│  ② VIỆC HÀNG NGÀY  │
                           │  chạy 1 lần/ngày   │
                           └─────────┬──────────┘
                                     │
                           ┌─────────┴──────────┐
  ◄─ "duyệt rồi, chuyển ───│  ③ VIỆC ĐỐI SOÁT   │ ── đơn nào duyệt? ──►  Open API
      tiền nhé"            │  ngày 12 và 25     │ ◄── danh sách đơn ───
                           └────────────────────┘
```

| | Chạy lúc nào | Làm gì |
|---|---|---|
| **① Bot** | Liên tục | Nhận link → tạo link tiếp thị → trả cho khách → ghi vào sổ |
| **② Việc hàng ngày** | 1 lần/ngày | Tìm đơn mới Shopee ghi nhận · hết hạn link quá 7 ngày · nhắn khách "đã ghi nhận đơn" |
| **③ Việc đối soát** | Ngày **12** và **25** | Hỏi Shopee đơn nào đã duyệt → cập nhật sổ → nhắn khách → xếp hàng chờ chuyển tiền |

**Vì sao ngày 12 và 25?** Vì Shopee mở đối soát ngày 11 và ngày 24. Chạy sau một ngày cho chắc.

---

## 4. Một đơn hàng đi qua hệ thống — kể từ đầu đến cuối

Ví dụ: chị Vân mua cái áo 300.000₫.

```
NGÀY 0 ─────────────────────────────────────────────────────
  Chị Vân gửi link vào nhóm, tag bot
      │
      ▼ ① BOT
  Gọi Shopee tạo link, gắn kèm sub_id = "C0042"
  Ghi vào bảng link_requests:  trạng thái = pending
  Nhắn lại: "Link đây ạ. Bạn được hoàn khoảng 25.725₫..."

NGÀY 1 ─────────────────────────────────────────────────────
  Chị Vân bấm link, đặt hàng
      │
      ▼ ② VIỆC HÀNG NGÀY
  Thấy Shopee đã ghi nhận đơn #D8821, sub_id = "C0042"
  → à, của chị Vân
  Ghi vào bảng orders:  trạng thái = awaiting_approval
  link_requests → converted
  Nhắn: "Đơn đã được Shopee ghi nhận, đang chờ duyệt"

NGÀY 7 ─────────────────────────────────────────────────────
  Chị Vân nhận hàng, không trả lại

NGÀY 12 hoặc 25 ────────────────────────────────────────────
      ▼ ③ VIỆC ĐỐI SOÁT
  Hỏi Shopee: đơn nào duyệt rồi?
  Shopee trả: #D8821 · hoa hồng duyệt 27.000₫ · sub_id "C0042"

  ⚠️ Để ý: lúc tạo link bot báo 36.750₫. Shopee duyệt 27.000₫.
     LUÔN tính theo 27.000₫ — số ước tính chỉ để khách biết trước.

  cashback = 27.000 × 80% − thuế 10% = 18.900₫
  orders → approved
  Nhắn: "Đơn duyệt rồi, chuyển 18.900₫ cho bạn nhé"

CHUYỂN TIỀN ────────────────────────────────────────────────
  Bạn xem danh sách:   cashback payouts
  Chuyển khoản bằng tay
  Đánh dấu:            cashback pay D8821
  orders → paid   ✅ KẾT THÚC
```

### Nếu đơn hỏng

```
NGÀY 12 hoặc 25 ────────────────────────────────────────────
  Shopee trả: #D8821 bị huỷ / trả hàng
  orders → rejected
  Nhắn: "Đơn này Shopee không ghi nhận hoa hồng, mong bạn thông cảm"

  → Bạn KHÔNG mất đồng nào, vì chưa chuyển tiền.
     Đây chính là lý do chọn "trả sau khi duyệt".
```

### Nếu khách bấm link mà không mua

```
NGÀY 7 ─────────────────────────────────────────────────────
      ▼ ② VIỆC HÀNG NGÀY
  link_requests quá 7 ngày, không có đơn nào
  → trạng thái = expired

  Để làm gì? Để biết: cứ 100 link thì bao nhiêu ra đơn.
  Con số đó nói cho bạn biết khách có mua thật hay chỉ hỏi cho vui.
```

---

## 5. Sáu file code làm gì

```
src/cashback/
    policy.py     Luật chia tiền: hoa hồng duyệt → khách bao nhiêu, mình bao nhiêu.
                  Chứa 3 hằng số có nguồn: phí 0,98% · thuế 10% · ngưỡng 2 triệu.

    ledger.py     ⭐ CUỐN SỔ. Tạo bảng, thêm khách, thêm đơn, đổi trạng thái.
                  Ba luật sắt nằm ở đây (xem mục 6).

    metrics.py    Ba chỉ số phải đo. Tự từ chối khi chưa đủ 100 đơn.

    config.py     Đọc file .env. Thiếu khoá thì tự chuyển sang chế độ giả lập.

    cli.py        Các lệnh gõ trong terminal.

    __init__.py   File đánh dấu đây là một gói. Gần như trống.
```

**Chưa có, sẽ viết sau khi anh mở tài khoản:**

```
    shopee.py     Gọi Shopee API (ký chữ ký, tạo link, lấy báo cáo)
    reconcile.py  Khớp sub_id, cập nhật sổ
    zalo.py       Nhận và gửi tin nhắn Zalo
```

*Chưa viết vì phải biết báo cáo Shopee trả về cột `sub_id` tên gì. Đoán rồi viết thì viết hai lần.*

---

## 6. Ba luật sắt nằm trong code, không phải trong đầu

Đây là ba chỗ mà nếu sai thì mất tiền thật. Chúng được **chặn cứng trong `ledger.py`**, không phải "nhớ mà làm":

| Luật | Chặn ở đâu | Nếu không có thì sao |
|---|---|---|
| **1. Chỉ trả tiền khi đơn đã `approved`** | `mark_paid()` từ chối mọi trạng thái khác | Trả tiền cho đơn sau đó bị huỷ → mất trắng |
| **2. Một đơn chỉ trả MỘT lần** | Kiểm `paid_at` đã có giá trị chưa | Đối soát chạy chồng nhau → **trả tiền 2–3 lần cho cùng một đơn** |
| **3. Tính theo hoa hồng DUYỆT, không theo ước tính** | `cashback_amount` chỉ ghi khi có `approved_commission` | Bot báo 36.750₫, Shopee duyệt 27.000₫ → trả thừa 7.800₫/đơn |

Đã chạy thử:
```
approve lần 2  →  False   (luật 2 chặn)
pay lần 2      →  False   (luật 2 chặn)
cashback       =  18.900₫  (từ 27.000 đã duyệt, không phải 36.750 ước tính)
```

---

## 7. Các lệnh gõ trong terminal

```
cashback init            Tạo cuốn sổ (chạy một lần đầu tiên)
cashback status          Xem đang ở chế độ gì, cấu hình ra sao
cashback check-policy    So hai chính sách thuế bằng tiền thật
cashback metrics         Ba chỉ số + cảnh báo khi chưa đủ 100 đơn
cashback payouts         Danh sách đơn đã duyệt, chờ chuyển tiền
cashback pay D8821       Đánh dấu đã chuyển khoản cho đơn D8821
cashback expire          Hết hạn các link quá 7 ngày
```

---

## 8. Chạy được ngay bây giờ, chưa cần tài khoản nào

```
cashback status
→ Shopee: SIMULATED (no credentials)  |  Zalo: STDOUT (no token)
```

Chưa có khoá Shopee → hệ thống dùng dữ liệu giả lập.
Chưa có token Zalo → tin nhắn in ra màn hình thay vì gửi đi.

**Cuốn sổ, luật chia tiền, ba chỉ số — tất cả đều chạy thật.** Cắm khoá vào là chuyển sang chạy thật, không phải sửa gì.

---

## 9. Sau này chạy 24/7 ở đâu?

| Cách | Chi phí | Phù hợp khi |
|---|---|---|
| Máy tính ở nhà | 0₫ | Giai đoạn đầu — nhưng phải bật liên tục |
| VPS rẻ | 50.000 – 100.000₫/tháng | Khi đã chạy ổn định |

Việc định kỳ (ngày 12 và 25) thì dùng **Task Scheduler** trên Windows hoặc **cron** trên Linux — hẹn giờ gọi lệnh, không cần code thêm.

**Chưa cần nghĩ tới ở giai đoạn chạy tay 10 đơn.**
