# Cashback — bot hoàn tiền Shopee

Khách gửi link sản phẩm Shopee qua Zalo, bot trả lại link tiếp thị liên kết
kèm số tiền hoàn ước tính. Khi Shopee duyệt đơn và trả hoa hồng, bot báo
lại và chủ bot chuyển tiền cho khách.

> **Quy mô:** nghề tay trái, mục tiêu ~1 triệu đồng/tháng. Không theo đuổi
> tư cách đối tác chính thức của Shopee.

---

## Chạy được ngay trong 5 phút

```bash
# 1. Cài
uv sync

# 2. Cấu hình
cp .env.example .env          # điền ZALO_BOT_TOKEN
uv run cashback setup-token   # sinh khoá nối bot <-> extension

# 3. Tạo sổ
uv run cashback init

# 4. Mở trình duyệt riêng cho bot (đăng nhập Shopee một lần)
powershell scripts/start-browser.ps1

# 5. Chạy
uv run cashback serve
```

Chi tiết từng bước: [docs/03-operations/installation.md](docs/03-operations/installation.md)

---

## Hệ thống gồm bốn phần

```
   Khách (Zalo)                                    Shopee
        │                                             ▲
        │ gửi link                                    │ điều khiển
        ▼                                             │ trình duyệt thật
  ┌───────────┐      ┌──────────┐      ┌──────────────┴──────┐
  │ messaging │─────▶│  worker  │─────▶│  shopee             │
  │  (Zalo)   │      │ (gom lô) │      │  (link + hoa hồng)  │
  └─────┬─────┘      └──────────┘      └──────────┬──────────┘
        │                                          │
        │            ┌──────────┐                  │
        └───────────▶│  ledger  │◀─────────────────┘
                     │  (sổ)    │
                     └──────────┘
```

| Tầng | Việc |
|---|---|
| `core` | Quy tắc tiền, mã định danh, cấu hình, log, dấu vết |
| `ledger` | Sổ: ai được bao nhiêu, đã trả chưa, tài khoản nào đáng ngờ |
| `shopee` | Mọi thứ chạm tới Shopee: tạo link, tra hoa hồng, đối soát |
| `messaging` | Nói chuyện với khách trên Zalo |
| `worker` | Gom yêu cầu theo cửa sổ rồi chạy trình duyệt một lượt |
| `cli` | Lệnh cho người vận hành |

Kiến trúc đầy đủ: [docs/02-architecture/overview.md](docs/02-architecture/overview.md)

---

## Vì sao phải điều khiển trình duyệt thay vì gọi API

Shopee có Open API, nhưng **đã khoá** từ 4/8/2023 — chỉ mở cho KOC có nhân
viên Shopee chăm sóc riêng. Tài khoản này **đã bị từ chối bằng email**.

Gọi thẳng API nội bộ của dashboard cũng không được: mỗi request phải kèm
chữ ký thiết bị do một SDK sinh ra. Thử 5 lần là **cả phiên bị bắt giải
captcha**.

Nên hệ thống dùng **trình duyệt thật đã đăng nhập** và để trang tự gửi
request của nó. Toàn bộ quá trình điều tra, kể cả những đường đã thử và
thất bại: [docs/04-reference/shopee-api-findings.md](docs/04-reference/shopee-api-findings.md)

---

## Ba quy tắc không được phá

Ba điều này là lý do hệ thống không trả nhầm tiền. Chúng được ép trong code,
không phải quy ước:

1. **Chỉ trả theo hoa hồng Shopee ĐÃ DUYỆT**, không bao giờ theo số ước tính
   đã hiện cho khách lúc tạo link.
2. **Đơn đã có `paid_at` thì không bao giờ xử lý lại.** Đối soát chạy chồng
   kỳ; thiếu chốt này là trả hai ba lần.
3. **Không xoá được khách còn đang nợ tiền** — trừ khi ép bằng `--force`.

Chi tiết: [docs/02-architecture/ledger-and-reconciliation.md](docs/02-architecture/ledger-and-reconciliation.md)

---

## Lệnh hay dùng

```bash
cashback serve                    # chạy bot (Zalo + tạo link)
cashback payouts                  # đơn đã duyệt, chờ chuyển tiền
cashback pay O0001                # đánh dấu đã chuyển
cashback reconcile --file r.csv   # đối soát báo cáo Shopee
cashback metrics                  # ba chỉ số quan trọng
cashback audit --scan             # tài khoản đáng soi lại
cashback audit --customer C0001   # lịch sử một khách
cashback audit --archive          # nén log tháng đã đóng
```

Đầy đủ: [docs/04-reference/cli-commands.md](docs/04-reference/cli-commands.md)

---

## Tài liệu

| Thư mục | Nội dung |
|---|---|
| [`docs/01-business/`](docs/01-business/) | Mô hình kinh doanh, con số, kế hoạch, chi phí |
| [`docs/02-architecture/`](docs/02-architecture/) | Kiến trúc, sổ sách, đối soát, tạo link |
| [`docs/03-operations/`](docs/03-operations/) | Cài đặt, vận hành hằng ngày, xử lý sự cố |
| [`docs/04-reference/`](docs/04-reference/) | Lệnh, lược đồ CSDL, tin nhắn, kết quả điều tra API |
| [`docs/diagrams/`](docs/diagrams/) | Use case, sequence, máy trạng thái |

---

## Quy ước của dự án

- **Code bằng tiếng Anh**, kể cả comment và tên biến. **Tài liệu bằng tiếng Việt.**
- **Không có chữ tiếng Việt nào trong code.** Mọi câu gửi cho khách nằm ở
  `resources/messages.vi.json`.
- Bí mật (`.env`, `extension/background/base_url.js`) không bao giờ commit.

Hướng dẫn cho người và AI cùng làm tiếp: [CLAUDE.md](CLAUDE.md)
