# Hướng dẫn cho người tiếp nhận dự án

Đọc file này trước khi sửa bất cứ dòng nào. Nó ghi những thứ **không đọc ra
được từ code**: vì sao chọn cách này, đã thử cách nào và thất bại ra sao.

---

## 1. Quy ước ngôn ngữ — không thương lượng

| Chỗ | Ngôn ngữ |
|---|---|
| Code, comment, tên biến, tên cột CSDL, biến `.env` | **Tiếng Anh** |
| Tài liệu trong `docs/`, `README.md` | **Tiếng Việt** |
| Câu chữ gửi cho khách | **`resources/messages.vi.json`** |

**Không được có chữ tiếng Việt nào trong code**, kể cả comment, kể cả chữ
`đ` của tiền. Ký tự tiền nằm ở khoá `currency` trong file tin nhắn.

Kiểm nhanh:

```bash
uv run python -c "
import pathlib, unicodedata
bad = [(f.name, i) for f in pathlib.Path('src/cashback').rglob('*.py')
       for i, l in enumerate(f.read_text(encoding='utf-8').splitlines(), 1)
       for c in l if ord(c) > 127 and 'LATIN' in unicodedata.name(c, '')]
print(bad or 'sach')"
```

---

## 2. Ba quy tắc tiền — ép trong code, đừng gỡ

Nằm ở `core/policy.py` và `ledger/repository.py`:

1. **Cashback tính từ hoa hồng Shopee ĐÃ DUYỆT**, không bao giờ từ số ước
   tính đã hiện cho khách. Số ước tính chỉ để tham khảo.
2. **Đơn đã có `paid_at` thì không xử lý lại.** Đối soát chạy chồng kỳ;
   thiếu chốt này là trả tiền hai ba lần cho một đơn.
3. **Không xoá khách còn nợ tiền.** `forget_customer()` từ chối, trừ khi
   `force=True`.

**Trần hoa hồng 40.000₫** (`SHOPEE_COMMISSION_CAP_VND`): Shopee giới hạn
phần của *họ* ở 40.000₫ mỗi đơn, phần shop bù thêm (XTRA) thì không.

```
tổng = min(giá × %Shopee, 40.000) + giá × %Shop
```

Kiểm trên 18 sản phẩm, đúng 18/18. **Bỏ quên trần này là hứa gấp gần 3 lần
số thật** — một chiếc xe 84,6 triệu sẽ được báo hoàn 2.368.800₫ thay vì
28.000₫.

**Làm tròn tiền phải nửa-lên**, dùng `round_dong()`. `round()` của Python
làm tròn về số chẵn: `round(9262.5) = 9262`, trong khi mọi công cụ khác
trong thị trường hiện 9263.

---

## 3. Những đường đã thử và ĐÃ CHẾT — đừng thử lại

| Đường | Kết quả | Bằng chứng |
|---|---|---|
| Shopee Open API (`productOfferV2`) | Bị từ chối bằng email 10/9/2026 | Khoá từ 4/8/2023, chỉ mở cho KOC có nhân viên riêng |
| Gọi thẳng API nội bộ `/api/v3/gql` | **Cả phiên bị bắt giải captcha** | Thiếu `af-ac-enc-dat`, `x-sap-sec` → `error 90309999` |
| Thêm CSRF token vào request | Vẫn bị chặn y hệt | Đã thử 3 biến thể header |
| Product Feed (xuất cả kho) | "Không có dữ liệu" | Tài khoản chưa được cấp |
| Tra hoa hồng theo `item_id` | Không tồn tại | 8 đường dẫn 404, 5 tên tham số bị bỏ qua |
| Lật nhiều trang kết quả tìm kiếm | Bị đá sang `verify/traffic/error` | Phải reload tay mới chạy lại |

**Đừng dựng lại mấy header chữ ký.** Đó là vô hiệu hoá cơ chế chống bot, và
cũng là cách nhanh nhất mất tài khoản: chữ ký lệch với thiết bị thật là tín
hiệu mạnh hơn nhiều so với gọi hơi nhiều.

Đầy đủ: [`docs/04-reference/shopee-api-findings.md`](docs/04-reference/shopee-api-findings.md)

---

## 4. Những bẫy đã dính, đừng dính lại

**Tab chạy script phải đúng trang.** URL tương đối (`/api/v3/...`) sẽ hỏng
nếu tab đã bị điều hướng đi chỗ khác. Luôn kiểm `location.href` trước.

**Chỉ đọc trang 1 khi tra hoa hồng.** Lật trang để săn cho ra là đúng cái
làm dính `verify/traffic/error`.

**`sub_id` chỉ nhận `a-zA-Z0-9`.** Dấu gạch ngang làm hỏng attribution
lặng lẽ — đơn về nhưng không gắn được vào khách nào. Chặn ngay từ lúc sinh
trong `core/identifiers.py`.

**`sub_id` dùng chung cho cả 5 link trong một lần submit.** Nên **không
trộn nhiều khách trong một lần submit** — phải gom theo từng khách rồi chia 5.

**Antd là React**: gán `.value` trực tiếp thì form submit rỗng. Phải set
qua native setter rồi dispatch `input` + `change`.

**Zalo `getUpdates` là luồng trực tiếp, không phải hộp thư.** Tin nhắn chỉ
tới nếu đúng lúc đó có poll đang mở. **Bot tắt lúc nào là mất tin lúc đó,
vĩnh viễn.** Nên báo trước khi restart.

**Zalo bóc mất nội dung tin có khung ảnh xem trước** và gắn nhãn
`message.unsupported.received`. Không sửa được từ phía bot — chỉ có thể
hướng dẫn khách bấm ✕ xoá khung ảnh.

**Trong nhóm, bot chỉ nhận tin khi được @tag hoặc bị reply.** Không nghe
được cả nhóm.

**Link tiếp thị KHÔNG hết hạn.** Bảy ngày của Shopee tính từ lúc khách
**bấm** link, không phải từ lúc tạo link. Link tạo một tháng trước, hôm nay
bấm thì vẫn ăn hoa hồng, và đối soát vẫn tìm được yêu cầu gốc dù dòng đó
mang trạng thái `expired`. Trạng thái `expired` chỉ là ghi sổ.

`LINK_ATTRIBUTION_DAYS` **không phải hạn dùng của link**. Nó phân biệt
*"tôi chưa nhận được"* với *"tôi đang tìm mua lại"*: quá hạn đó thì giá và
hoa hồng đã cũ, nên tạo yêu cầu mới để lấy số mới.

**Danh sách tên miền Shopee phải nằm ở một chỗ duy nhất**
(`shopee/dashboard_lookup.py`). Đã từng có hai bản sao lệch nhau và link
`shp.ee` bị coi là tin nhắn thường suốt một buổi.

---

## 5. Trước khi bàn giao / chạy thật

- [ ] **Đổi `ZALO_BOT_TOKEN`** — token cũ đã lộ trong ảnh chụp màn hình
- [ ] Kiểm trần hoa hồng mỗi đơn trong tài khoản affiliate của chính mình
- [ ] Đo ba chỉ số sau 100–300 đơn thật (`cashback metrics`)
- [ ] Chạy `cashback audit --scan` trước mỗi đợt chuyển tiền
- [ ] `cashback audit --archive` mỗi tháng để nén log

---

## 6. Khi sửa code

**Trước khi sửa:** đọc docstring của module. Chúng ghi *vì sao*, không phải
*cái gì* — phần *cái gì* thì code đã nói rồi.

**Sau khi sửa:**

```bash
uv run python -c "
import sys; sys.path.insert(0,'src')
import importlib, pkgutil, cashback
for m in pkgutil.walk_packages(cashback.__path__, 'cashback.'):
    importlib.import_module(m.name)
print('moi module import sach')"

uv run cashback --help          # parser còn dựng được không
uv run cashback status          # cấu hình đọc được không
```

**Sửa `resources/messages.vi.json` thì phải restart bot** — tin nhắn được
cache ở lần đọc đầu tiên.

**Thêm cột CSDL** thì thêm vào `_LATER_COLUMNS` trong `ledger/repository.py`,
đừng sửa DDL — `serve` tự chạy migration khi khởi động.

---

## 7. Bật/tắt bot

```powershell
# Trình duyệt riêng cho bot (đăng nhập Shopee một lần, nhớ mãi)
powershell scripts/start-browser.ps1

# Bot, chạy tách khỏi terminal
$env:PYTHONUNBUFFERED="1"; $env:PYTHONIOENCODING="utf-8"
Start-Process uv -ArgumentList "run","cashback","serve" `
  -RedirectStandardOutput logs/console.log `
  -RedirectStandardError  logs/console.err.log -WindowStyle Hidden
```

Đừng để bot phụ thuộc trình duyệt hằng ngày: đóng nó là bot mất một chân.
`scripts/start-browser.ps1` dùng hồ sơ riêng ở `.browser-profile/` nên hai
thứ độc lập hoàn toàn.
