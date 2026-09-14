# Kiểm tra thủ công

Mấy phép thử ở đây **không chạy trong bộ test thường** vì chúng cần một
trình duyệt đã đăng nhập và chúng chạm thật vào Shopee.

Chạy tay khi nào:

| Việc | Chạy cái gì |
|---|---|
| Sau khi đổi cách điền/đọc form Custom Link | `check_submission_order.py` |
| Sau khi Shopee đổi giao diện trang Custom Link | `check_submission_order.py` |

```bash
# Phải DỪNG bot trước -- nó đang giữ cổng bridge
uv run python tests/manual/check_submission_order.py
```

## `check_submission_order.py`

`generate()` ghép link về đúng yêu cầu **theo vị trí** (`zip(chunk, links)`).
Không có gì trong trang Shopee hứa rằng thứ tự trả về khớp thứ tự gửi đi.

Phép thử gửi 3 sản phẩm rất khác nhau trong một lượt, rồi **đi theo từng
link rút gọn** xem nó thật sự dẫn tới sản phẩm nào.

**Kết quả 14/09/2026: thứ tự được giữ nguyên, 3/3 đúng.**
