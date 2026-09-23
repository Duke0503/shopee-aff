# KẾ HOẠCH TÍCH HỢP TIKTOK SHOP (QUA ACCESSTRADE API) VÀO HỆ THỐNG CASHBACK BOT

> **Phiên bản:** 1.0.0  
> **Ngày lập:** 2026-09-22  
> **Tác giả:** Đội ngũ Kỹ thuật & Sản phẩm (Party Mode Team: Winston, Amelia, John, Mary, Murat, Victor)  
> **Trạng thái:** Bản thảo đề xuất kỹ thuật (Approved for Roadmap)  

---

## 1. TỔNG QUAN VÀ MỤC TIÊU DỰ ÁN

### 1.1. Bối cảnh
Hệ thống hiện tại đang vận hành mô hình Hoàn tiền Shopee tự động (80% hoa hồng cho khách, 20% cho admin) thông qua:
- Tạo link affiliate: Chrome Extension Automation (CDP).
- Đối soát đơn hàng: Báo cáo Conversion Report CSV từ Shopee Affiliate Portal.

Nhu cầu mở rộng sang **TikTok Shop** là cực kỳ cấp thiết do lưu lượng mua sắm cảm xúc (Impulse Buying) qua video/livestream tăng trưởng mạnh. Tuy nhiên, qua phân tích kỹ thuật:
- TikTok Shop Creator cá nhân không hỗ trợ API tự động tạo link ngoài app và không trả SubID trong báo cáo.
- **Giải pháp tối ưu nhất:** Tích hợp thông qua **AccessTrade Publisher API v2** (AccessTrade là Tier-1 TikTok Affiliate Partner - TAP chính thức tại Việt Nam).

### 1.2. Mục tiêu
1. **Hỗ trợ đa sàn (Multi-platform):** Người dùng có thể dán cả link **Shopee** lẫn **TikTok Shop** vào Website hoặc Zalo Bot.
2. **Tự động hóa 100% bằng REST API:** Sử dụng API của AccessTrade để tạo link affiliate, lấy thông tin sản phẩm và hoa hồng dự kiến trong < 500ms mà không cần chạy trình duyệt ảo Chrome CDP cho TikTok.
3. **Minh bạch đối soát SubID:** Gắn `customer_id` vào `sub1` và `request_id` vào `sub2`, đảm bảo khi AccessTrade trả dữ liệu đơn hàng về, hệ thống tự động xác định được đúng khách để trả tiền.
4. **Bảo toàn tính ổn định:** Giữ nguyên 100% luồng Shopee hiện tại, không gây ảnh hưởng hay xung đột dữ liệu cũ.

---

## 2. THIẾT KẾ KIẾN TRÚC HỆ THỐNG (ARCHITECTURE DESIGN)

### 2.1. Mô hình Provider Pattern (Adapter Pattern)
Thay vì hardcode luồng xử lý Shopee trong lõi ứng dụng, hệ thống sẽ trừu tượng hóa thành giao diện chung:

```text
                                 [NGƯỜI DÙNG]
                       (Gửi Link qua Web / Zalo Bot)
                                       │
                                       ▼
                       [URL Router & Platform Detector]
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
           (URL chứa shopee.vn)                 (URL chứa tiktok.com)
                    │                                     │
                    ▼                                     ▼
        ┌────────────────────────┐            ┌────────────────────────┐
        │     ShopeeProvider     │            │  TikTokAccessTradeProv │
        ├────────────────────────┤            ├────────────────────────┤
        │ • Link Gen: Chrome CDP │            │ • Link Gen: AT REST API│
        │ • Scraping / Cache     │            │ • Instant Name / Image │
        │ • Report: Shopee CSV   │            │ • Ingestion: AT API/WH │
        └────────────────────────┘            └────────────────────────┘
                    │                                     │
                    └──────────────────┬──────────────────┘
                                       │
                                       ▼
                     [Core Cashback Engine & Ledger]
                      (Bảng orders, link_requests,
                       Quy tắc chia 80:20, Payout)
```

### 2.2. Interface `BaseAffiliateProvider`
```python
class BaseAffiliateProvider(ABC):
    @abstractmethod
    def can_handle(self, url: str) -> bool:
        """Kiểm tra URL có thuộc sàn này hay không."""
        pass

    @abstractmethod
    async def preview_product(self, url: str) -> ProductPreview:
        """Lấy thông tin tên, ảnh, giá, hoa hồng dự kiến."""
        pass

    @abstractmethod
    async def create_affiliate_link(
        self, url: str, customer_id: str, request_id: str
    ) -> AffiliateLinkResult:
        """Tạo link tracking kèm sub_ids."""
        pass

    @abstractmethod
    async def sync_orders(self, from_date: datetime, to_date: datetime) -> list[RawOrder]:
        """Kéo danh sách đơn hàng đã phát sinh để đối soát."""
        pass
```

---

## 3. THIẾT KẾ CƠ SỞ DỮ LIỆU (DATABASE SCHEMA MIGRATION)

Cần cập nhật các bảng trong SQLite (`cashback.db`) để hỗ trợ thuộc tính nền tảng:

### 3.1. Bảng `orders`
Thêm cột:
- `platform TEXT NOT NULL DEFAULT 'shopee'` (giá trị: `'shopee'` | `'tiktok'`)
- `network TEXT DEFAULT 'direct'` (giá trị: `'direct'` cho Shopee, `'accesstrade'` cho TikTok)

### 3.2. Bảng `link_requests`
Thêm cột:
- `platform TEXT NOT NULL DEFAULT 'shopee'` (giá trị: `'shopee'` | `'tiktok'`)
- `network_request_id TEXT` (mã định danh giao dịch của AccessTrade nếu có)

### 3.3. Bảng `products_cache`
Trừu tượng hóa các cột hoa hồng sàn:
- Đổi cách hiểu hoặc bổ sung `platform TEXT DEFAULT 'shopee'`
- Bổ sung `commission_rate REAL` (thay vì chỉ có `shopee_rate` + `seller_rate`)

---

## 4. CHI TIẾT TÍCH HỢP ACCESSTRADE TIKTOK SHOP API

### 4.1. Thông tin cấu hình (Environment Variables)
Lưu vào `.env` hoặc file cấu hình bí mật:
```env
ACCESSTRADE_API_KEY=Token your_accesstrade_token_here
ACCESSTRADE_BASE_URL=https://api.accesstrade.vn
ACCESSTRADE_TIKTOK_CREATE_LINK_PATH=/v2/tiktokshop_product_feeds/create_link
```

### 4.2. Luồng tạo Link (Link Generation)
- **Endpoint:** `POST https://api.accesstrade.vn/v2/tiktokshop_product_feeds/create_link`
- **Headers:**
  ```http
  Authorization: Token {ACCESSTRADE_API_KEY}
  Content-Type: application/json
  ```
- **Payload:**
  ```json
  {
    "product_url": "https://vt.tiktok.com/ZSBKCcJrf/",
    "sub1": "2459968487621956719",
    "sub2": "R26092212345",
    "utm_source": "cashback_bot",
    "utm_medium": "zalo_web"
  }
  ```
- **Xử lý Response:**
  - `status == true`:
    - `aff_short_url`: Link trả về cho khách bấm mua.
    - `product_name`: Tên sản phẩm TikTok Shop.
    - `product_image`: Link ảnh sản phẩm.
    - `product_price.amount`: Giá sản phẩm.
    - `product_commission.amount`: Hoa hồng AccessTrade trả về (VND).
  - Ghi ngay vào `link_requests` và lưu cache vào `products_cache`.

### 4.3. Nhận diện định dạng URL TikTok
Hỗ trợ các dạng link người dùng thường copy:
- Link rút gọn trên app: `https://vt.tiktok.com/{id}/` hoặc `https://vm.tiktok.com/{id}/`
- Link web TikTok Shop: `https://shop.tiktok.com/view/product/{product_id}`
- Link video có gắn giỏ hàng: `https://www.tiktok.com/@{user}/video/{video_id}`

---

## 5. CƠ CHẾ ĐỐI SOÁT & ĐỒNG BỘ ĐƠN HÀNG (RECONCILIATION)

Có 2 hình thức nhận dữ liệu đơn hàng từ AccessTrade:

### 5.1. Hình thức 1: Polling Order API (Chủ động, tin cậy cao)
- **Endpoint:** `GET https://api.accesstrade.vn/v1/orders` (hoặc `v2/orders`)
- **Tần suất chạy:** Chạy định kỳ 30 phút - 1 tiếng/lần thông qua cronjob worker.
- **Dữ liệu đối soát:**
  - `sub1` -> Khớp với `customer_id`.
  - `sub2` -> Khớp với `request_id`.
  - `order_id` -> Mã đơn hàng TikTok.
  - `commission` -> Số tiền hoa hồng thực nhận.
  - `order_status` -> 
    - `0` / `pending`: Chờ đối soát (lưu trạng thái `awaiting_approval`).
    - `1` / `approved`: Đơn thành công, tiền về ví AccessTrade (lưu `approved`).
    - `2` / `rejected`: Hủy đơn, trả hàng (lưu `rejected`).

### 5.2. Hình thức 2: Postback / Webhook (Tức thời - Realtime)
- Thiết lập URL Webhook trên trang quản trị AccessTrade: `https://hoantiendp.com/api/webhooks/accesstrade`
- Khi khách hoàn tất đơn hàng, AccessTrade bắn HTTP POST dữ liệu đơn về server.
- Bot ngay lập tức gửi tin nhắn Zalo thông báo: *"Đơn hàng TikTok của bạn trị giá xxxđ đã được ghi nhận!"*.

---

## 6. LỘ TRÌNH THỰC HIỆN TỪNG BƯỚC (ROADMAP)

| Giai đoạn | Nội dung công việc | Phụ trách | Thời gian dự kiến |
| :--- | :--- | :--- | :--- |
| **Giai đoạn 1** | **Chuẩn bị & Thẩm định tài khoản AccessTrade**<br>- Đăng ký chiến dịch TikTok Shop trên Publisher Dashboard.<br>- Lấy API Token và kiểm tra quyền gọi API. | Admin & Mary | 0.5 ngày |
| **Giai đoạn 2** | **Refactor Database & Kiến trúc Provider**<br>- Migration thêm cột `platform` trong DB SQLite.<br>- Tạo module trừu tượng `BaseAffiliateProvider`.<br>- Gom luồng Shopee hiện tại thành `ShopeeProvider`. | Winston & Amelia | 1 ngày |
| **Giai đoạn 3** | **Xây dựng module TikTokAccessTradeProvider**<br>- Viết client HTTP gọi endpoint `create_link`.<br>- Bổ sung Regex nhận diện link TikTok.<br>- Viết Unit Test & Mock API test. | Amelia & Murat | 1 ngày |
| **Giai đoạn 4** | **Tích hợp Đối soát đơn hàng (Order Ingestion)**<br>- Xây dựng hàm kéo danh sách đơn từ AccessTrade API.<br>- Map trạng thái đơn và tính toán 80% cashback theo chính sách.<br>- Xử lý đơn hoàn/hủy. | Amelia & John | 1 ngày |
| **Giai đoạn 5** | **Nâng cấp Giao diện Web & Zalo Bot**<br>- Web frontend: Cho phép dán link TikTok, hiển thị badge sàn (Shopee / TikTok).<br>- Admin Console: Thêm bộ lọc nền tảng trong danh sách đơn hàng.<br>- Zalo Bot: Phản hồi link TikTok tự động. | Sally & Amelia | 1 ngày |
| **Giai đoạn 6** | **Chạy thử nghiệm (Staging Test) & Đưa vào hoạt động**<br>- Mua thử 2-3 đơn thật trên TikTok Shop qua link bot.<br>- Theo dõi đối soát thực tế trên AccessTrade.<br>- Khởi chạy chính thức cho cộng đồng. | Toàn đội ngũ | 1-2 ngày |

---

## 7. ĐÁNH GIÁ VÀ QUẢN TRỊ RỦI RO (RISK MANAGEMENT)

1. **Rủi ro hoa hồng thấp hơn trực tiếp:**
   - *Phân tích:* Do AccessTrade giữ lại khoảng 15-20% phí nền tảng TAP.
   - *Giải pháp:* Truyền thông minh bạch: Khách hàng luôn nhận **80% trên hoa hồng thực tế hệ thống nhận được từ nền tảng**.
2. **Tỷ lệ hủy/hoàn đơn (RTO) cao trên TikTok:**
   - *Phân tích:* Khách mua cảm xúc dễ hủy đơn khi hàng đang giao.
   - *Giải pháp:* Chỉ duyệt chi trả hoàn tiền khi đơn chuyển sang trạng thái **`approved`** (đã qua kỳ đối soát 21-30 ngày và không hoàn trả), tuyệt đối không thanh toán khi đơn còn ở mức ước tính.
3. **Rủi ro nghẽn API AccessTrade:**
   - *Phân tích:* API AccessTrade có thể chậm hoặc lỗi mạng tạm thời.
   - *Giải pháp:* Sử dụng timeout 10 giây, retry 2 lần, bổ sung tham số `?minify=true` để giảm tải thời gian phản hồi.

---

## 8. KẾT LUẬN

Việc tích hợp **TikTok Shop qua AccessTrade API** là hướng đi khả thi, an toàn và chuyên nghiệp nhất cho dự án ở thời điểm hiện tại. Giải pháp này giúp hệ thống:
- Tránh được rủi ro bị chặn bởi các cơ chế chống bot gắt gao của TikTok.
- Có đầy đủ cơ chế định danh `sub_id` để hoàn tiền tự động chính xác cho từng khách hàng.
- Tiết kiệm tài nguyên máy chủ (không cần chạy thêm trình duyệt Chrome automation).

*Tài liệu này được lưu trữ tại `docs/tiktok-accesstrade-integration-plan.md` làm kim chỉ nam kỹ thuật cho đợt triển khai tiếp theo.*
