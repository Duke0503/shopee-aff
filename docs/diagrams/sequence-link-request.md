# Sequence — từ lúc khách gửi link tới lúc nhận link

Đây là luồng chạy nhiều nhất. Đọc kỹ cái này là hiểu được 80% hệ thống.

```mermaid
sequenceDiagram
    autonumber
    actor K as Khách (Zalo)
    participant Z as messaging<br/>conversation
    participant L as ledger<br/>repository
    participant W as worker<br/>batch_queue + runner
    participant B as shopee<br/>browser_bridge
    participant E as Extension<br/>(Chrome riêng)
    participant S as Shopee

    K->>Z: dán link sản phẩm
    activate Z
    Z->>Z: find_shopee_urls()
    Note over Z: nhận cả shopee.vn,<br/>s.shopee.vn, shp.ee, shope.ee
    Z->>L: record_link_request(pending)
    Z->>Z: audit: link.requested
    Z-->>K: "Đã nhận link rồi nhé!"
    deactivate Z

    Note over W: chờ hết cửa sổ gom lô<br/>(150s) HOẶC đủ 20 yêu cầu

    W->>L: pending_link_jobs()
    L-->>W: các yêu cầu, gom THEO TỪNG KHÁCH
    Note over W: sub_id dùng chung mỗi lần submit<br/>→ không trộn nhiều khách

    W->>B: navigate(custom_link)
    B->>E: job qua long-poll
    E->>S: mở trang thật
    S-->>E: trang Custom Link

    W->>B: blocked_by_verification()?
    alt Đang bị bắt giải captcha
        B-->>W: /verify/traffic
        W-->>W: DỪNG cả lượt
        Note over W: không tính lần thử,<br/>không báo oan cho khách
    else Bình thường
        W->>B: điền form + bấm nút
        B->>E: execute_script (native setter + input/change)
        E->>S: POST /api/v3/gql?q=batchCustomLink
        Note over E,S: TRANG tự ký request<br/>(af-ac-enc-dat, x-sap-sec)
        S-->>E: shortLink
        E-->>B: kết quả
        B-->>W: các link
        W->>L: attach_affiliate_url()
    end

    Note over Z: vòng gửi tin kế tiếp

    Z->>Z: commission.lookup()
    Z->>E: 1. tên sản phẩm từ tab shopee.vn
    Z->>E: 2. hoa hồng từ dashboard affiliate
    alt Dashboard không có
        Z->>Z: bên thứ ba (nếu bật)
    end
    Z->>L: lưu estimate + nguồn
    Z->>Z: audit: link.delivered
    Z-->>K: link + giá + hoa hồng tách khoản + số tiền hoàn
```

---

## Vì sao lại gom lô 150 giây

Ba lý do, theo thứ tự quan trọng:

1. **Giảm dấu chân.** Năm khách gửi link trong một phút → **một** lần mở
   trang, không phải năm. Đây là thứ giữ tài khoản an toàn.
2. **Trang Custom Link nhận tối đa 5 link mỗi lần submit.** Gom lại thì
   tận dụng được.
3. Mở trang mất vài giây; làm một lượt rẻ hơn nhiều lượt.

Đổi ở `.env`:

```
BATCH_WINDOW_SECONDS=150
BATCH_MAX_SIZE=20
```

---

## Chỗ dễ hiểu nhầm nhất

**Bot không gọi API Shopee.** Nó bảo trình duyệt bấm nút, rồi **trang tự
gửi request của nó** — kèm chữ ký thiết bị mà chỉ SDK của Shopee sinh ra
được.

Gọi thẳng API đó bằng cookie sẽ **bị chặn**, và thử vài lần là **cả phiên
bị bắt giải captcha**. Đã kiểm chứng, xem
[`../04-reference/shopee-api-findings.md`](../04-reference/shopee-api-findings.md).
