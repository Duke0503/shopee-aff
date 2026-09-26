# Tài liệu dự án

## Đọc theo thứ tự nào

**Mới tiếp nhận dự án?** Đọc đúng bốn file này, theo thứ tự:

1. [`../README.md`](../README.md) — hệ thống làm gì, chạy thế nào
2. [`../CLAUDE.md`](../CLAUDE.md) — **quy ước và những bẫy đã dính**
3. [`diagrams/sequence-link-request.md`](diagrams/sequence-link-request.md) — luồng chạy nhiều nhất
4. [`02-architecture/overview.md`](02-architecture/overview.md) — các tầng và ranh giới

**Sắp mở nhóm cho khách?** Đọc
[`03-operations/group-setup.md`](03-operations/group-setup.md) — có sẵn hai
tin ghim copy dán thẳng vào Zalo.

**Chỉ cần vận hành, không sửa code?** Đọc
[`03-operations/runbook.md`](03-operations/runbook.md) và
[`04-reference/cli-commands.md`](04-reference/cli-commands.md).

**Muốn hiểu bài toán kinh doanh?**
[`01-business/business-model.md`](01-business/business-model.md).

---

## Mục lục

### 01 — Kinh doanh

| File | Nội dung |
|---|---|
| [`business-model.md`](01-business/business-model.md) | Mô hình, con số đã kiểm chứng, rủi ro, thuế |
| [`rollout-plan.md`](01-business/rollout-plan.md) | Kế hoạch triển khai theo bước, đo trước xây sau |
| [`accounts-and-costs.md`](01-business/accounts-and-costs.md) | Tài khoản cần có, chi phí từng nền tảng |

### 02 — Kiến trúc

| File | Nội dung |
|---|---|
| [`overview.md`](02-architecture/overview.md) | Sáu tầng, hướng phụ thuộc, vì sao SQLite |
| [`ledger-and-reconciliation.md`](02-architecture/ledger-and-reconciliation.md) | Sổ sách, đối soát, ba quy tắc tiền |

### 03 — Vận hành

| File | Nội dung |
|---|---|
| [`runbook.md`](03-operations/runbook.md) | Hệ thống chạy thế nào, làm gì hằng ngày |
| [`group-setup.md`](03-operations/group-setup.md) | Dựng nhóm: tin ghim, 11 bước của khách, admin bấm gì |
| [`deploy.md`](03-operations/deploy.md) | Dựng server trên máy mới, chuyển máy, cập nhật bản chạy thật |

### 04 — Tham chiếu

| File | Nội dung |
|---|---|
| [`cli-commands.md`](04-reference/cli-commands.md) | Mọi lệnh và tham số *(sinh từ code)* |
| [`database-schema.md`](04-reference/database-schema.md) | Bảng, cột, quan hệ *(sinh từ DDL)* |
| [`customer-messages.md`](04-reference/customer-messages.md) | Mẫu tin nhắn gửi khách |
| [`shopee-api-findings.md`](04-reference/shopee-api-findings.md) | **Mọi đường đã thử với Shopee, kèm bằng chứng** |

### Sơ đồ

| File | Nội dung |
|---|---|
| [`use-cases.md`](diagrams/use-cases.md) | Ai làm gì, luồng chính và luồng phụ |
| [`sequence-link-request.md`](diagrams/sequence-link-request.md) | Khách gửi link → nhận link |
| [`sequence-payout.md`](diagrams/sequence-payout.md) | Khách mua → nhận tiền, kèm máy trạng thái |

---

## Quy ước tài liệu

- **Tài liệu tiếng Việt, code tiếng Anh.** Không trộn.
- Tên file tiếng Anh, kebab-case, thư mục đánh số theo thứ tự nên đọc.
- Hai file trong `04-reference` được **sinh từ code** — sửa code rồi sinh
  lại, đừng sửa tay:

  ```bash
  uv run python scripts/generate-reference.py
  ```

- Sơ đồ dùng Mermaid, xem được thẳng trên GitHub và trong VS Code.
- Mỗi khẳng định về Shopee phải kèm **bằng chứng đo được**, không phải
  phỏng đoán. Đó là lý do `shopee-api-findings.md` dài như vậy.
