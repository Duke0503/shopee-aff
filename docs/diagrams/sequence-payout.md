# Sequence — từ lúc khách mua tới lúc nhận tiền

Đoạn này kéo dài **30–70 ngày**. Chỗ dễ mất khách nhất không phải kỹ thuật
mà là **im lặng**: nếu suốt hai tháng bot không nói gì, khách kết luận là
bị lừa.

```mermaid
sequenceDiagram
    autonumber
    actor K as Khách
    participant S as Shopee
    actor O as Chủ bot
    participant R as shopee<br/>reconciliation
    participant L as ledger<br/>repository
    participant Z as messaging<br/>conversation

    K->>S: bấm link, mua hàng
    Note over S: Shopee ghi nhận đơn,<br/>gắn sub_id = request_id

    Note over O,S: vài ngày sau

    O->>S: tải báo cáo chuyển đổi (CSV)
    O->>R: cashback reconcile --file r.csv
    activate R
    R->>R: khớp sub_id → request_id → customer_id
    R->>L: add_order(awaiting_approval)
    deactivate R

    Z->>L: notify_order_changes()
    L-->>Z: đơn có status ≠ notified_status
    Z->>Z: audit: order.recorded
    Z-->>K: "Shopee đã ghi nhận đơn! Dự kiến hoàn ~X"
    Note over Z,K: ĐÂY là tin chống<br/>bảy mươi ngày im lặng

    Note over S: 30-70 ngày sau

    O->>R: reconcile lần nữa (báo cáo mới)
    R->>L: mark_approved(approved_commission, cashback_amount)
    Note over R,L: cashback tính từ hoa hồng ĐÃ DUYỆT,<br/>KHÔNG phải số ước tính

    Z->>L: notify_order_changes()
    alt Khách đã gửi số tài khoản
        Z-->>K: "Đã duyệt! Bạn nhận X. Chuyển vào VCB - 012..."
    else Chưa có số tài khoản
        Z-->>K: "Đã duyệt! Bạn được hoàn X. Cho mình xin số tài khoản"
        Note over Z,K: Xin tài khoản ĐÚNG LÚC NÀY,<br/>khi màn hình đang hiện số tiền thật
    end

    O->>L: cashback payouts
    L-->>O: danh sách đơn chờ chuyển
    O->>O: cashback audit --scan
    Note over O: soi tài khoản đáng ngờ<br/>TRƯỚC khi tiền rời đi
    O->>K: chuyển khoản
    O->>L: cashback pay O0001
    Note over L: paid_at được ghi →<br/>đơn này không bao giờ xử lý lại
```

---

## Vì sao xin số tài khoản muộn như vậy

Bản đầu xin ngay ở tin nhắn chào. Ba người dùng thật đọc thử và đều dừng ở
cùng một chỗ:

> *"Tôi mới gõ mỗi chữ 'hi'. Chưa mua gì. Chưa có đồng nào. Mà nó đã đòi số
> tài khoản."*
>
> *"Xin tài khoản để trả một khoản chưa tồn tại — tự nghe lại câu đó đi."*

Người lạ + tin nhắn đầu + xin số tài khoản = đúng kịch bản lừa đảo.

Nên bot **không bao giờ tự hỏi trước**. Nó hỏi đúng lúc màn hình đang hiện
*"Bạn được hoàn 6.484đ"* — lúc đó khách đưa ngay. Muốn chủ động gửi thì gõ
`/nganhang`.

---

## Máy trạng thái đơn hàng

```mermaid
stateDiagram-v2
    [*] --> awaiting_approval: reconcile thấy đơn
    awaiting_approval --> approved: Shopee duyệt hoa hồng
    awaiting_approval --> rejected: huỷ / trả hàng / không ghi nhận
    approved --> paid: chủ bot chuyển tiền
    rejected --> [*]
    paid --> [*]

    note right of approved
        cashback_amount tính từ
        approved_commission,
        KHÔNG từ số ước tính
    end note

    note right of paid
        paid_at đã ghi →
        không bao giờ xử lý lại,
        dù đối soát chạy chồng kỳ
    end note
```

Mọi lần chuyển trạng thái đều ghi vào `state_history` — **chỉ thêm, không
bao giờ ghi đè**. Đó là thứ dùng để trả lời *"đơn này đã đi qua những đâu"*
khi có tranh cãi.

---

## Máy trạng thái yêu cầu link

```mermaid
stateDiagram-v2
    [*] --> pending: khách gửi link
    pending --> pending: tạo hỏng, thử lại (< 3 lần)
    pending --> failed: hỏng đủ 3 lần
    pending --> expired: quá hạn ghi nhận
    failed --> [*]: đã xin lỗi khách
    expired --> [*]

    note right of failed
        MAX_LINK_ATTEMPTS = 3.
        Trước khi có bộ đếm này,
        link hỏng bị thử lại vô hạn
        và khách không bao giờ
        được báo.
    end note
```
