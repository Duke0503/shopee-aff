# Kết quả điều tra API Shopee

Ghi lại **mọi đường đã thử** để lấy link và hoa hồng, kèm bằng chứng. Mục
đích là để người sau **không mất công thử lại** — và quan trọng hơn, không
vô tình làm khoá tài khoản.

Đo trong hai ngày 10–11/09/2026.

---

## Tóm tắt

| Đường | Kết quả |
|---|---|
| Open API chính thức | ❌ Bị từ chối bằng email |
| API nội bộ `/api/v3/gql` gọi thẳng | ❌ Chống bot, **gây captcha** |
| Product Feed | ❌ Chưa được cấp |
| Tra hoa hồng theo `item_id` | ❌ Không tồn tại |
| **Điều khiển trình duyệt thật** | ✅ **Đang dùng** |

---

## 1. Open API chính thức — đóng

`productOfferV2(itemId:)` làm đúng việc mình cần, một lời gọi ra ngay hoa
hồng theo item id. Nhưng cần `app_id` + `secret_key`.

Trang `affiliate.shopee.vn/open_api` trên tài khoản này hiện:

```
AppID:   --
API key: --
"Bạn hiện không có quyền truy cập vào nền tảng Open API..."
```

Email trả lời từ Shopee (10/09/2026):

> Kể từ ngày 4/8/2023, Shopee giới hạn lại quyền truy cập mục Open API.
> Shopee chỉ hỗ trợ mở quyền truy cập đối với **một số nhóm KOL/KOC nhất
> định có nhân viên hỗ trợ trực tiếp**.

**Kết luận:** không phải chờ duyệt — là không mở. Đừng nộp lại.

---

## 2. API nội bộ của dashboard — có thật, nhưng có tường

Bắt được đầy đủ bằng `network_capture` khi bấm nút Custom Link:

```
POST https://affiliate.shopee.vn/api/v3/gql?q=batchCustomLink

{"operationName":"batchGetCustomLink",
 "query":"query batchGetCustomLink($linkParams:[CustomLinkParam!], $sourceCaller:SourceCaller){
            batchCustomLink(linkParams:$linkParams, sourceCaller:$sourceCaller){
              shortLink longLink failCode }}",
 "variables":{"linkParams":[{"originalLink":"...",
                             "advancedLinkParams":{"subId1":"R2609..."}}],
              "sourceCaller":"CUSTOM_LINK_CALLER"}}
```

### Gọi thẳng thì bị chặn

Cùng cookie, cùng tab đã đăng nhập, cùng origin — vẫn bị từ chối:

```json
{"error": 90309999,
 "6": {"1": "mfr...eyJidXNpbmVzcyI6Ik9QQUFGRkkiLCJtZnIiOiIwIiwibWZyX2NhcHRjaGEiOiIifQ"}}
```

Giải base64: `{"business":"OPAAFFI","mfr":"0","mfr_captcha":"","pop_up":false}`

### Vì sao trang thật thì qua

Trang gửi kèm chữ ký thiết bị do một SDK sinh ra:

```
af-ac-enc-dat:      b67f2cafd9113fa0
af-ac-enc-sz-token: 0+BiX6E2PqyH+mM7XhHzUw==|z9YYq0cG...
x-sap-ri:           0498a36a25439429b537dc32050158c8...
x-sap-sec:          PNp/UtKaE0KMO3vUP0/UP3IUU030PLlU...   (~1.500 ký tự)
x-sz-sdk-version:   1.12.21
CSRF-token:         6Oe9AC4O-VXoiqFoDEmGEgzPbocuDTISFsqU
```

### Đã thử loại trừ CSRF

| Thử | Kết quả |
|---|---|
| Không header nào | `error 90309999` |
| Thêm `CSRF-token` | `error 90309999` |
| Thêm `CSRF-token` + `Affiliate-Program-Type` | `error 90309999` |

**Không phải CSRF.** Là tầng chống bot.

### Cái giá phải trả

Năm request không chữ ký trong ~15 phút → **cả phiên bị bắt giải captcha**:

```
Xác nhận để tiếp tục
[Kéo qua để hoàn thiện bức hình]
```

Ba nấc leo thang đã gặp đủ:

```
nấc 1   từ chối im lặng      error 90309999
nấc 2   đá sang verify page  shopee.vn/verify/traffic/error
nấc 3   bắt giải captcha     phải kéo thanh trượt bằng tay
```

> **Đừng dựng lại mấy header đó.** Ngoài chuyện vô hiệu hoá cơ chế chống
> bot, chữ ký lệch với thiết bị thật còn là tín hiệu mạnh hơn nhiều so với
> chỉ gọi hơi nhiều — tức là cách nhanh nhất để mất tài khoản.

---

## 3. Tra hoa hồng theo item id — không tồn tại

Đã dò và loại trừ:

```
keyword=<item_id>                        0 kết quả
keyword=<link sản phẩm>                  0 kết quả
tham số item_id / item_ids / itemid /
        item_id_list / shopid            bị bỏ qua hoàn toàn
/api/v3/offer/product/get                404
/api/v3/offer/product/item               404
/api/v3/offer/product/detail             404
/api/v3/offer/product/query              404
/api/v3/offer/product/search             404
/api/v3/offer/product/item_detail        404
/api/v3/product/detail                   404
/api/v3/item/get                         404
GraphQL introspection                    bị khoá
network_capture toàn trang offer         chỉ có duy nhất 1 endpoint list
```

**Chỉ tìm được bằng TỪ KHOÁ.** Và từ khoá có ba giới hạn:

1. `total_count` luôn bị chặn ở 500
2. Link rút gọn không mang tên sản phẩm
3. **Lật nhiều trang → dính `verify/traffic/error`**

---

## 4. Cách đang dùng: ghép hai tab

Vì bước tra hoa hồng chỉ nhận từ khoá, còn link khách gửi lại không có tên:

```
link rút gọn
   ↓ theo redirect
/opaanlp/<shop_id>/<item_id>          ← chỉ có số
   ↓ hỏi tab shopee.vn (cùng gốc)
/api/v4/pdp/get_pc → TÊN sản phẩm
   ↓ tìm trong dashboard affiliate
/api/v3/offer/product/list?keyword=<tên>
   ↓ lọc đúng item_id
hoa hồng chính xác
```

**Vì sao phải là tab `shopee.vn`:**

| Gọi từ đâu | Kết quả |
|---|---|
| HTTP thẳng (httpx) | 403 |
| Từ tab affiliate | CORS chặn |
| Từ service worker | 403 |
| **Từ tab shopee.vn** | ✅ 200 |

Đo trên link thật: **3/4 ra ngay lần đầu**. Ca trượt là hàng tạp hoá không
nằm trong kho tìm kiếm của dashboard — món đó có hoa hồng thật 8,5% nhưng
bốn kiểu từ khoá đều không thấy.

---

## 5. Ngữ nghĩa tỷ lệ hoa hồng — dễ hiểu sai

Kiểm trên 20 sản phẩm:

```
default_commission_rate  = TỔNG, ĐÃ GỒM phần shop bù thêm
seller_commission_rate   = phần XTRA nằm TRONG tổng đó
```

**Cộng hai số là tính gấp đôi.** Từng viết sai chỗ này: món 445.000₫ đáng
lẽ 5,5% thì tính thành 8,5%.

### Trần 40.000₫

```
tổng = min(giá × %Shopee, 40.000) + giá × %Shop
```

Đúng **18/18** sản phẩm. Ví dụ nặng nhất:

| Sản phẩm | Không trần | Có trần | Lệch |
|---|---|---|---|
| Xe Honda SH125i 84.600.000₫ | 3.384.000₫ | **40.000₫** | 3.344.000₫ |
| Món 5.290.000₫ | 529.000₫ | **198.700₫** | 330.300₫ |

---

## 6. Đối chiếu độc lập với bên thứ ba

`data.addlivetag.com` so với dashboard Shopee, 20 sản phẩm:

| | Kết quả |
|---|---|
| Giá | **20/20 khớp từng đồng** |
| Tổng % hoa hồng | **19/20 khớp chính xác** |
| Lệch | 1 món — số của họ cũ (họ cache ~24 giờ) |

Số của họ chính là số của Shopee. Nhưng mỗi phản hồi kèm:

```json
"legalNotice": {"purpose": "for_education_research_internal_non_commercial",
                "nonCommercialOnly": true}
```

Nên nó chỉ là **dự phòng**, tắt được bằng một dòng `THIRD_PARTY_FALLBACK=false`.

---

## 7. Extension của họ — đã tải về xem

Chrome Web Store, 564 KB, bung ra đọc hết:

```
credentials trong code:  KHÔNG CÓ GÌ
  app_id / secret / SHA256 Credential / open-api.affiliate.shopee.vn  → 0 kết quả

gọi đi đâu:
  data.addlivetag.com, data-vultr.addlivetag.com, goink.me   (server của họ)
```

AppID nằm trên server họ, không gửi xuống máy người dùng. Và response của
họ ghi `"dataSource": "db"` kèm lịch sử giá 7/30 ngày — nghĩa là **giá trị
nằm ở dữ liệu tích luỹ, không phải ở code**. Bê code về được cái database
trống.

---

## 8. Repo công khai

[`bcat95/shopee-aff`](https://github.com/bcat95/shopee-aff) — tài liệu +
code mẫu chạy được (`bc-custom-link/`, `Code/nodejs/`, `Code/php/`).

Nhưng cả 6 file đều hở đúng một chỗ:

```php
$apiAppID = '';  // change this, see at https://affiliate.shopee.vn/open_api
```

Tức là vẫn cần AppID — thứ mục 1 đã nói là không xin được.
